const axios = require('axios');
const nock = require('nock');

const BASE = process.env.BASE || `http://${process.env.HOST || 'localhost'}:${process.env.PORT || 5000}`;
const EMAIL = process.env.EMAIL || `test+${Date.now()}@example.com`;
const PASSWORD = process.env.PASSWORD || 'Password123!';

// Mock Fashn.AI endpoint
function mockFashnAI() {
  nock('https://api.fashn.ai')
    .post('/v1/run')
    .reply(200, {
      output: {
        image_url: 'https://example.com/fake-tryon.jpg'
      },
      result: { ok: true }
    });
}

async function register() {
  console.log(`Registering ${EMAIL}`);
  const res = await axios.post(`${BASE}/api/v1/auth/register`, {
    name: 'Test User',
    email: EMAIL,
    password: PASSWORD
  }, { timeout: 10000 });
  return res.data;
}

async function login() {
  console.log(`Logging in ${EMAIL}`);
  const res = await axios.post(`${BASE}/api/v1/auth/login`, {
    email: EMAIL,
    password: PASSWORD
  }, { timeout: 10000 });
  return res.data;
}

async function generateTryon(token) {
  console.log('Calling generate try-on...');
  const res = await axios.post(`${BASE}/api/v1/tryon/generate`, {
    modelImage: 'data:image/png;base64,FAKE_MODEL_IMAGE',
    garmentImage: 'data:image/png;base64,FAKE_GARMENT_IMAGE',
    productId: 'test-product-tryon',
    age: 8
  }, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 20000
  });
  return res.data;
}

(async () => {
  try {
    mockFashnAI();

    if (process.env.SKIP_REGISTER !== 'true') {
      const r = await register();
      console.log('Register:', r.message || 'ok');
    } else {
      console.log('Skipping registration (SKIP_REGISTER=true)');
    }

    const loginRes = await login();
    if (!loginRes || !loginRes.data || !loginRes.data.tokens) {
      console.error('Login failed or did not return tokens:', loginRes);
      process.exit(2);
    }

    const token = loginRes.data.tokens.accessToken;

    const gen = await generateTryon(token);
    console.log('Generate try-on response:', gen.data?.imageUrl || gen);

    console.log('✅ Try-on flow test completed successfully');
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
