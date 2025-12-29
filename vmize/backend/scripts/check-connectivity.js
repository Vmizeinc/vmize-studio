const axios = require('axios');

const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || 'localhost';
const BASE = `http://${HOST}:${PORT}`;

(async () => {
  try {
    const res = await axios.get(`${BASE}/health`, { timeout: 5000 });
    if (res.status === 200 && res.data && res.data.success) {
      console.log(`✅ Backend reachable at ${BASE}/health`);
      console.log('Response:', JSON.stringify(res.data, null, 2));
      process.exit(0);
    }
    console.error('❌ Unexpected response:', res.status, res.data);
    process.exit(2);
  } catch (err) {
    console.error(`❌ Failed to reach backend at ${BASE}/health`);
    console.error(err.message || err);
    process.exit(1);
  }
})();
