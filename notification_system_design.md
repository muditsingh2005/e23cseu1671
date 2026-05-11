# Notification System Design

Notes for the 6 design stages.

# Stage 1

REST endpoints:

```
GET    /api/v1/notifications
GET    /api/v1/notifications/unread
GET    /api/v1/notifications/unread-count
PATCH  /api/v1/notifications/{id}/read
PATCH  /api/v1/notifications/read-all
POST   /api/v1/admin/notifications/broadcast
GET    /api/v1/notifications/stream
```

All calls send `Authorization: Bearer <token>`.

Real time: SSE on `/notifications/stream`. Client connects after login, server pushes events. SSE is simpler than WebSocket since flow is mostly server -> client.

# Stage 2

Use Postgres. Strong consistency, partial indexes, partitioning.

```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY,
  notification_type VARCHAR(20) NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE student_notifications (
  id UUID PRIMARY KEY,
  student_id BIGINT NOT NULL,
  notification_id UUID NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(student_id, notification_id)
);

CREATE INDEX idx_sn ON student_notifications (student_id, is_read, created_at DESC);
```

Why split: one broadcast goes to many students, so store content once + per-student state separately.

Scaling fixes: Redis cache for unread count, partition by month, cursor pagination, archive old rows.

# Stage 3

Given:

```sql
SELECT * FROM notifications
WHERE studentID = 1042 AND isRead = false
ORDER BY createdAt DESC;
```

Slow on 5M rows because no composite index and `SELECT *` pulls everything.

Fix:

```sql
CREATE INDEX idx_n_su ON notifications (studentID, isRead, createdAt DESC);

SELECT id, message, created_at FROM notifications
WHERE studentID = 1042 AND isRead = FALSE
ORDER BY createdAt DESC LIMIT 20;
```

Don't index every column — slows writes, bloats storage, planner gets confused.

Placement in last 7 days:

```sql
SELECT DISTINCT studentID FROM notifications
WHERE notificationType = 'Placement'
  AND createdAt >= NOW() - INTERVAL '7 days';
```

# Stage 4

DB overload on page load. Fixes:

- SSE push instead of polling
- Redis cache for unread count + recent inbox
- cursor pagination
- ETag / HTTP cache
- read replicas

# Stage 5

Sequential `notify_all` loop has problems: slow at 50k, one failure blocks rest, no retry, no idempotency, no failure tracking.

Better: insert master notification, bulk insert per-student rows, push delivery jobs to queue, workers consume independently, retry with backoff, DLQ for permanent failures. Idempotency key prevents duplicates.

# Stage 6

Priority Inbox returns top `n` notifications. Default `n=10`.

Priority: Placement=3, Result=2, Event=1. Tie -> newer first.

Steps:
1. auth -> token
2. fetch `/notifications`
3. sort by (priority desc, timestamp desc)
4. slice top n

`O(m log m)` sort is fine here. Min-heap is `O(m log n)` for streams.

Output:

```json
{
  "count": 10,
  "notifications": [
    { "ID": "...", "Type": "Placement", "Message": "CSX Corporation hiring", "Timestamp": "2026-04-22 17:51:18" }
  ]
}
```
