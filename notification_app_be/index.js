require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Log, setToken } = require('../logging_middleware');

const app = express();
app.use(cors());
app.use(express.json());

const port = process.env.PORT || 5002;
const base = process.env.API_BASE_URL;

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

app.listen(port, async () => {
  setToken(await getToken());
  Log('backend', 'info', 'service', 'be up ' + port);
});
