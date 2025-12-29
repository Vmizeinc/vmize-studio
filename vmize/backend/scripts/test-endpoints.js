const axios = require('axios');

const BASE = process.env.BASE || `http://${process.env.HOST || 'localhost'}:${process.env.PORT || 5000}`;

const EMAIL = process.env.EMAIL || `test+${Date.now()}@example.com`;
const PASSWORD = process.env.PASSWORD || 'Password123!';

async function register() {
  console.log(`Registering test user ${EMAIL} ...`);
  const res = await axios.post(`${BASE}/api/v1/auth/register`, {
    name: 'Test User',
    email: EMAIL,
    password: PASSWORD,
    companyName: 'TestCo',
    website: 'https://example.com',
    platform: 'other'
  }, { timeout: 10000 });
  return res.data;
}

async function login() {
  console.log(`Logging in ${EMAIL} ...`);
  const res = await axios.post(`${BASE}/api/v1/auth/login`, {
    email: EMAIL,
    password: PASSWORD
  }, { timeout: 10000 });
  return res.data;
}

async function trackView(token) {
  console.log('Posting try-on view event...');
  const res = await axios.post(`${BASE}/api/v1/tryon/track-view`, {
    productId: 'test-product-123',
    viewDuration: 7
  }, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 10000
  });
  return res.data;
}

async function getHistory(token) {
  console.log('Getting try-on history...');
  const res = await axios.get(`${BASE}/api/v1/tryon/history`, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 10000
  });
  return res.data;
}

(async () => {
  try {
    if (process.env.SKIP_REGISTER !== 'true') {
      const reg = await register();
      console.log('Register result:', reg.message || reg);
    } else {
      console.log('SKIP_REGISTER=true — skipping registration');
    }

    const loginRes = await login();
    if (!loginRes || !loginRes.data || !loginRes.data.tokens) {
      console.error('Login did not return tokens:', loginRes);
      process.exit(2);
    }

    const token = loginRes.data.tokens.accessToken;

    const track = await trackView(token);
    console.log('Track view response:', track.message || track);

    const history = await getHistory(token);
    console.log('History length:', history.data?.tryons?.length ?? 0);

    console.log('✅ Endpoint checks completed');
    process.exit(0);
  } catch (err) {
    if (err.response) {
      console.error('Request failed:', err.response.status, err.response.data);
    } else {
      console.error('Error:', err.message || err);
    }
    process.exit(1);
  }
})();
