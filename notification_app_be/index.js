require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { Log, setToken } = require('../logging_middleware');

const app = express();
app.use(cors());
app.use(express.json());

const port = process.env.PORT || 5002;
const base = process.env.API_BASE_URL;

const db = new Database(process.env.DB_FILE || 'notifications.db');
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS notifications (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    type        TEXT NOT NULL,
    message     TEXT NOT NULL,
    is_read     INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    read_at     TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_user_read_created
    ON notifications (user_id, is_read, created_at DESC);
`);

function rowToNotification(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    message: row.message,
    isRead: !!row.is_read,
    createdAt: row.created_at,
    readAt: row.read_at
  };
}

let tok;
async function getToken() {
  if (tok) return tok;
  const r = await fetch(base + '/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: process.env.EMAIL,
      name: process.env.NAME,
      rollNo: process.env.ROLL_NO,
      accessCode: process.env.ACCESS_CODE,
      clientID: process.env.CLIENT_ID,
      clientSecret: process.env.CLIENT_SECRET
    })
  });
  const d = await r.json();
  tok = d.access_token;
  return tok;
}

function score(t) {
  if (t === 'Placement') return 3;
  if (t === 'Result') return 2;
  if (t === 'Event') return 1;
  return 0;
}

app.get('/notifications/priority', async (req, res) => {
  let n = parseInt(req.query.n, 10);
  if (!n || n < 1) n = 10;
  try {
    const t = await getToken();
    const r = await fetch(base + '/notifications', { headers: { Authorization: 'Bearer ' + t } });
    const d = await r.json();
    const list = (d.notifications || []).slice();
    list.sort((x, y) => {
      const diff = score(y.Type) - score(x.Type);
      if (diff !== 0) return diff;
      return new Date(y.Timestamp) - new Date(x.Timestamp);
    });
    const top = list.slice(0, n);
    res.json({ count: top.length, notifications: top });
  } catch (e) {
    Log('backend', 'error', 'handler', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/log', async (req, res) => {
  try {
    const t = await getToken();
    const r = await fetch(base + '/logs', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/notifications', (req, res) => {
  const { userId, type, message } = req.body || {};
  if (!userId || !type || !message) {
    return res.status(400).json({ error: 'userId, type, and message are required' });
  }
  const id = crypto.randomUUID();
  db.prepare(
    'INSERT INTO notifications (id, user_id, type, message) VALUES (?, ?, ?, ?)'
  ).run(id, String(userId), String(type), String(message));
  const row = db.prepare('SELECT * FROM notifications WHERE id = ?').get(id);
  res.status(201).json(rowToNotification(row));
});

app.get('/notifications/:userId', (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC'
  ).all(req.params.userId);
  res.json({
    userId: req.params.userId,
    count: rows.length,
    notifications: rows.map(rowToNotification)
  });
});

app.patch('/notifications/:id/read', (req, res) => {
  const info = db.prepare(
    "UPDATE notifications SET is_read = 1, read_at = datetime('now') WHERE id = ? AND is_read = 0"
  ).run(req.params.id);
  const row = db.prepare('SELECT * FROM notifications WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'notification not found' });
  res.json({ updated: info.changes, notification: rowToNotification(row) });
});

app.delete('/notifications/:id', (req, res) => {
  const info = db.prepare('DELETE FROM notifications WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'notification not found' });
  res.status(204).send();
});

app.listen(port, async () => {
  setToken(await getToken());
  Log('backend', 'info', 'service', 'be up ' + port);
});
