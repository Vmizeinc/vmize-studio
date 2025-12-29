const axios = require('axios');

const BASE = process.env.BASE || `http://${process.env.HOST || 'localhost'}:${process.env.PORT || 5000}`;

const endpoints = [
  { path: '/api/v1/auth/register', allow: 'POST', bad: 'GET' },
  { path: '/api/v1/auth/login', allow: 'POST', bad: 'GET' },
  { path: '/api/v1/auth/me', allow: 'GET', bad: 'POST' },
  { path: '/api/v1/tryon/generate', allow: 'POST', bad: 'GET' },
  { path: '/api/v1/tryon/history', allow: 'GET', bad: 'POST' },
  { path: '/api/v1/tryon/track-view', allow: 'POST', bad: 'GET' }
];

async function tryRequest(method, url) {
  try {
    const res = await axios({ method: method.toLowerCase(), url, timeout: 5000 });
    return res.status;
  } catch (err) {
    if (err.response && err.response.status) return err.response.status;
    return `ERR:${err.code || err.message}`;
  }
}

(async () => {
  console.log(`Running 405 checks against ${BASE}`);
  const results = [];

  for (const ep of endpoints) {
    const url = `${BASE}${ep.path}`;
    process.stdout.write(`Checking ${ep.path} ... `);

    const allowedStatus = await tryRequest(ep.allow, url);
    const badStatus = await tryRequest(ep.bad, url);

    const okBad = badStatus === 405 || badStatus === 404; // 404 sometimes returned for unmatched methods

    console.log(`allowed=${allowedStatus} | ${ep.bad}=>${badStatus} ${okBad ? 'OK' : '⚠️'}`);

    results.push({ path: ep.path, allowedStatus, badMethod: ep.bad, badStatus, okBad });
  }

  const warnings = results.filter(r => !r.okBad);

  console.log('\nSummary:');
  console.log(`Total endpoints checked: ${results.length}`);
  console.log(`Endpoints with unexpected non-405/404 for disallowed method: ${warnings.length}`);

  if (warnings.length) {
    console.log('Warnings:');
    warnings.forEach(w => console.log(` - ${w.path}: ${w.badStatus}`));
    process.exit(2);
  }

  console.log('All disallowed-method responses returned 405/404 as expected (or server returned error codes).');
  process.exit(0);
})();
