require('dotenv').config();
const express = require('express');
const { Log, setToken } = require('../logging_middleware');

const app = express();
const port = process.env.PORT || 5001;
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

async function call(path) {
  const t = await getToken();
  const r = await fetch(base + path, { headers: { Authorization: 'Bearer ' + t } });
  return r.json();
}

function knapsack(items, cap) {
  const n = items.length;
  const dp = [];
  for (let i = 0; i <= n; i++) dp.push(new Array(cap + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    const w = items[i-1].Duration, v = items[i-1].Impact;
    for (let c = 0; c <= cap; c++) {
      if (w <= c) dp[i][c] = Math.max(dp[i-1][c], dp[i-1][c-w] + v);
      else dp[i][c] = dp[i-1][c];
    }
  }
  const pick = [];
  let c = cap, u = 0, imp = 0;
  for (let i = n; i > 0; i--) {
    if (dp[i][c] !== dp[i-1][c]) {
      const it = items[i-1];
      pick.push(it);
      u += it.Duration; imp += it.Impact;
      c -= it.Duration;
    }
  }
  return { picked: pick.reverse(), usedHours: u, totalImpact: imp };
}

app.get('/schedule', async (req, res) => {
  try {
    const dep = await call('/depots');
    const veh = await call('/vehicles');
    const tasks = (veh.vehicles || []).map(t => ({
      TaskID: t.TaskID, Duration: +t.Duration, Impact: +t.Impact
    }));
    const out = [];
    for (const d of dep.depots) {
      const k = knapsack(tasks, +d.MechanicHours);
      out.push({
        depotID: d.ID,
        mechanicHours: +d.MechanicHours,
        usedHours: k.usedHours,
        totalImpact: k.totalImpact,
        selectedTasks: k.picked
      });
    }
    res.json(out);
  } catch (e) {
    Log('backend', 'error', 'handler', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.listen(port, async () => {
  setToken(await getToken());
  Log('backend', 'info', 'service', 'up ' + port);
});
