let tok;

function setToken(t) { tok = t; }

async function Log(stack, level, pkg, message) {
  if (!tok) return;
  const base = process.env.API_BASE_URL;
  if (!base) return;
  try {
    await fetch(base + '/logs', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + tok,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ stack, level, package: pkg, message })
    });
  } catch (e) {}
}

module.exports = { Log, setToken };
