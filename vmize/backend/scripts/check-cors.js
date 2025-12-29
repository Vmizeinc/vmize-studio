const axios = require('axios');

const BASE = process.env.BASE || `http://${process.env.HOST || 'localhost'}:${process.env.PORT || 5000}`;

// Map endpoints to the method they typically allow
const endpoints = [
  { path: '/api/v1/auth/register', method: 'POST' },
  { path: '/api/v1/auth/login', method: 'POST' },
  { path: '/api/v1/auth/me', method: 'GET' },
  { path: '/api/v1/tryon/generate', method: 'POST' },
  { path: '/api/v1/tryon/history', method: 'GET' },
  { path: '/api/v1/tryon/track-view', method: 'POST' }
];

// Origins to test (include allowed dev origins and a malicious one)
const origins = [
  process.env.FRONTEND_URL || 'http://localhost:3000',
  'http://localhost:5000',
  'http://127.0.0.1:5000',
  'http://malicious.example.com'
];

async function sendPreflight(url, origin, method) {
  try {
    const res = await axios({
      method: 'OPTIONS',
      url,
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': method,
        'Access-Control-Request-Headers': 'content-type,authorization'
      },
      validateStatus: () => true,
      timeout: 7000
    });

    return { status: res.status, headers: res.headers };
  } catch (err) {
    return { error: err.message || err.code };
  }
}

async function sendTestRequest(url, origin, method) {
  try {
    const res = await axios({
      method: method.toLowerCase(),
      url,
      headers: {
        Origin: origin,
        'Content-Type': 'application/json'
      },
      data: method === 'GET' ? undefined : {},
      validateStatus: () => true,
      timeout: 7000
    });

    return { status: res.status, headers: res.headers };
  } catch (err) {
    return { error: err.message || err.code };
  }
}

(async () => {
  console.log(`Running CORS preflight checks against ${BASE}`);
  const failures = [];

  for (const ep of endpoints) {
    const url = `${BASE}${ep.path}`;
    for (const origin of origins) {
      process.stdout.write(`Checking ${ep.path} from ${origin} ... `);

      const pre = await sendPreflight(url, origin, ep.method);

      if (pre.error) {
        console.log(`ERR preflight: ${pre.error}`);
        failures.push({ ep: ep.path, origin, reason: `preflight error ${pre.error}` });
        continue;
      }

      const acao = pre.headers['access-control-allow-origin'];
      const acam = pre.headers['access-control-allow-methods'];

      const okOrigin = acao && (acao === origin || acao === '*');
      const okMethods = acam && acam.toUpperCase().includes(ep.method);

      // Send a real test request to see effective behavior for allowed origins
      const testReq = await sendTestRequest(url, origin, ep.method);

      const okTest = !testReq.error && (testReq.status >= 200 && testReq.status < 500);

      const passed = okOrigin && okMethods;

      if (passed) {
        console.log(`OK (preflight ${pre.status})`);
      } else {
        console.log(`FAIL (preflight ${pre.status})`);
        failures.push({ ep: ep.path, origin, preflightStatus: pre.status, acao, acam, testReq });
      }
    }
  }

  console.log('\nSummary:');
  if (failures.length === 0) {
    console.log('All CORS preflight checks passed.');
    process.exit(0);
  }

  console.log(`Failures: ${failures.length}`);
  failures.forEach(f => console.log(JSON.stringify(f, null, 2)));
  process.exit(2);
})();
