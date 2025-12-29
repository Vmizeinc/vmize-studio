const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const nock = require('nock');

process.env.FASHN_AI_API_URL = process.env.FASHN_AI_API_URL || 'https://api.fashn.ai/v1/run';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

// Mock Fashn.AI success response
function mockFashnSuccess() {
  nock('https://api.fashn.ai')
    .post('/v1/run')
    .reply(200, {
      output: { image_url: 'https://example.com/mock-tryon.jpg' },
      result: { ok: true }
    });
}

async function startServerAndTest() {
  const app = express();
  app.use(bodyParser.json({ limit: '10mb' }));

  // Create lightweight in-memory Customer store and mock models/services
  const path = require('path');
  const bcrypt = require('bcrypt');
  const jwt = require('jsonwebtoken');

  const customers = new Map();
  let nextId = 1;

  // Mock Customer model
  const CustomerMock = {
    findOne(query) {
      const email = query.email;
      let found = null;
      for (const c of customers.values()) {
        if (c.email === email) { found = c; break; }
      }
      // Return a Promise that also supports .select('+password') chaining
      const p = (async () => found)();
      p.select = (sel) => (async () => found)();
      return p;
    },
    async create(data) {
      const id = String(nextId++);
      const hashed = await bcrypt.hash(data.password || 'pass', 8);
      const customer = {
        _id: id,
        name: data.name,
        email: data.email,
        password: hashed,
        companyName: data.companyName,
        website: data.website,
        platform: data.platform || 'other',
        plan: data.plan || 'trial',
        trialEndsAt: data.trialEndsAt || new Date(Date.now() + 14*24*3600*1000),
        apiKey: `mock_key_${id}`,
        usage: { currentMonth: { tryons: 0, apiCalls: 0 }, allTime: { tryons: 0, apiCalls: 0 }, history: [] },
        planLimits: { tryonsPerMonth: 100 },
        save: async function() { customers.set(this._id, this); return this; },
        comparePassword: async function(p) { return bcrypt.compare(p, this.password); },
        generateAccessToken: function() { return jwt.sign({ _id: this._id, email: this.email, plan: this.plan }, process.env.JWT_SECRET, { expiresIn: '7d' }); },
        generateRefreshToken: function() { return jwt.sign({ _id: this._id }, process.env.JWT_REFRESH_SECRET || 'refresh-secret', { expiresIn: '30d' }); }
      };
      customers.set(id, customer);
      return customer;
    },
    async findById(id) {
      return customers.get(String(id)) || null;
    }
  };

  // Mock User model used by tryon route (returns apiKey and trackEvent)
  const UserMock = {
    async findById(id) {
      const c = customers.get(String(id));
      if (!c) return null;
      return {
        _id: c._id,
        apiKey: c.apiKey,
        analytics: { sessions: [] },
        trackEvent: async () => true
      };
    }
  };

  // Mock stripeService to avoid network calls
  const stripePath = path.resolve(__dirname, '../services/stripeService.js');
  require.cache[stripePath] = { id: stripePath, filename: stripePath, loaded: true, exports: {
    createCustomer: async (c) => ({ id: `stripe_${c.email}` })
  }};

  // Inject mocks into require cache so controllers use them
  const custPath = path.resolve(__dirname, '../models/Customer.js');
  require.cache[custPath] = { id: custPath, filename: custPath, loaded: true, exports: CustomerMock };

  const userPath = path.resolve(__dirname, '../models/User.js');
  require.cache[userPath] = { id: userPath, filename: userPath, loaded: true, exports: UserMock };

  // Provide a global fetch implementation (route uses fetch)
  global.fetch = async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    const headers = options.headers || {};
    const data = options.body ? JSON.parse(options.body) : undefined;
    const resp = await axios({ method, url, headers, data, timeout: 30000 });
    return {
      ok: resp.status >= 200 && resp.status < 300,
      status: resp.status,
      json: async () => resp.data,
      text: async () => JSON.stringify(resp.data)
    };
  };

  // Now require and mount real routers using absolute paths (more robust)
  const authRoutePath = path.resolve(__dirname, '../routes/auth.js');
  const tryonRoutePath = path.resolve(__dirname, '../routes/tryon.js');

  try {
    const fs = require('fs');
    console.log('Debug: __dirname=', __dirname);
    console.log('Debug: process.cwd()=', process.cwd());
    console.log('Debug: checking route files...');
    console.log('Exists auth route?', fs.existsSync(authRoutePath));
    console.log('Exists tryon route?', fs.existsSync(tryonRoutePath));
    try {
      console.log('Routes dir listing:');
      console.log(fs.readdirSync(path.resolve(__dirname, '../routes')));
    } catch (lsErr) {
      console.warn('Could not list routes dir:', lsErr.message);
    }

    let authRouter;
    try {
      authRouter = require(authRoutePath);
    } catch (rerr) {
      // Fallback: try dynamic import via file:// URL
      try {
        const { pathToFileURL } = require('url');
        const mod = await import(pathToFileURL(authRoutePath).href);
        authRouter = mod.default || mod;
        console.log('Loaded auth router via dynamic import');
      } catch (ierr) {
        console.error('Require error:', rerr && rerr.message);
        console.error('Import error:', ierr && ierr.message);
        throw rerr; // will be caught by outer catch
      }
    }
    app.use('/api/v1/auth', authRouter);
  } catch (err) {
    console.error('Failed to load auth router at', authRoutePath, err && err.message);
    console.error(err && err.stack);
    process.exit(1);
  }

  try {
    let tryonRouter;
    try {
      tryonRouter = require(tryonRoutePath);
    } catch (rerr) {
      try {
        const { pathToFileURL } = require('url');
        const mod = await import(pathToFileURL(tryonRoutePath).href);
        tryonRouter = mod.default || mod;
        console.log('Loaded tryon router via dynamic import');
      } catch (ierr) {
        console.error('Require error:', rerr && rerr.message);
        console.error('Import error:', ierr && ierr.message);
        throw rerr;
      }
    }
    app.use('/api/v1/tryon', tryonRouter);
  } catch (err) {
    console.error('Failed to load tryon router at', tryonRoutePath, err.message);
    process.exit(1);
  }

  const server = app.listen(0, async () => {
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;
    console.log(`Test server listening on ${base}`);

    // Mock Fashn and run test client
    mockFashnSuccess();

    try {
      // 1) Register new customer
      const email = `test+${Date.now()}@example.com`;
      const registerRes = await axios.post(`${base}/api/v1/auth/register`, {
        name: 'Test User',
        email,
        password: 'Password123!'
      }, { timeout: 20000 });

      const accessToken = registerRes.data?.data?.tokens?.accessToken;
      if (!accessToken) {
        console.error('❌ Register did not return accessToken:', registerRes.data);
        server.close();
        process.exit(2);
      }

      // 2) Call try-on endpoint with obtained JWT
      const res = await axios.post(`${base}/api/v1/tryon/generate`, {
        modelImage: 'data:image/png;base64,FAKE',
        garmentImage: 'data:image/png;base64,FAKE',
        productId: 'test-sku-e2e'
      }, { timeout: 20000, headers: { Authorization: `Bearer ${accessToken}` } });

      if (res.status === 200 && res.data && res.data.data && res.data.data.imageUrl) {
        console.log('✅ In-process try-on test succeeded. Image URL:', res.data.data.imageUrl);
        server.close();
        process.exit(0);
      } else {
        console.error('❌ Unexpected response:', res.status, res.data);
        server.close();
        process.exit(2);
      }
    } catch (err) {
      console.error('❌ Test client error:', err.response ? err.response.data : err.message || err);
      server.close();
      process.exit(1);
    }
  });
}

startServerAndTest();
