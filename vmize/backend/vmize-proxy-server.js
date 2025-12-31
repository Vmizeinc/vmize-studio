// =================================================================
// VMIZE STUDIO - SECURE BACKEND PROXY
// =================================================================
// This proxy sits between customer widgets and Fashn.AI API
// Customers call YOUR API, you call Fashn.AI with YOUR secret key
// =================================================================

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// =================================================================
// CONFIGURATION
// =================================================================

const FASHN_API_KEY = process.env.FASHN_API_KEY; // YOUR secret Fashn.AI key
const PORT = process.env.PORT || 3000;


// MongoDB Customer model
const mongoose = require('mongoose');
const Customer = require('../../backend/models/Customer');

// Connect to MongoDB (update URI as needed)
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost/vmize', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

// =================================================================
// MIDDLEWARE: Verify Customer API Key
// =================================================================

async function verifyCustomerApiKey(req, res, next) {
  const apiKey = req.headers['x-vmize-api-key'];
  
  if (!apiKey) {
    return res.status(401).json({ 
      error: 'Unauthorized', 
      message: 'Missing X-Vmize-API-Key header' 
    });
  }
  
  // Verify key format
  if (!apiKey.startsWith('vmize_pk_live_') && !apiKey.startsWith('vmize_pk_test_')) {
    return res.status(401).json({ 
      error: 'Unauthorized', 
      message: 'Invalid API key format' 
    });
  }
  
  // Look up customer from MongoDB
  const customer = await Customer.findOne({ apiKey });
  if (!customer) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid API key'
    });
  }
  if (customer.subscriptionStatus !== 'active') {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Subscription inactive. Please update billing.'
    });
  }
  if (customer.hasExceededLimit()) {
    return res.status(429).json({
      error: 'Quota Exceeded',
      message: 'Monthly try-on limit reached. Upgrade your plan.'
    });
  }
  req.customer = customer;
  next();
}

// No longer needed: getCustomerByApiKey (now handled inline)

// =================================================================
// HELPER: Track usage
// =================================================================

async function trackUsage(customerId, tryonCount = 1) {
  // Increment usage for the customer in MongoDB
  const customer = await Customer.findById(customerId);
  if (customer) {
    await customer.incrementUsage(tryonCount);
    console.log(`📊 Tracked ${tryonCount} try-on(s) for customer ${customer.email}`);
  }
}

// =================================================================
// ROUTE: Virtual Try-On (Proxied to Fashn.AI)
// =================================================================

app.post('/api/tryon', verifyCustomerApiKey, async (req, res) => {
  const { model_image, garment_image, options = {} } = req.body;
  
  if (!model_image || !garment_image) {
    return res.status(400).json({ 
      error: 'Bad Request', 
      message: 'model_image and garment_image are required' 
    });
  }
  
  try {
    // Step 1: Call Fashn.AI API (with YOUR secret key)
    const payload = {
      model_name: 'tryon-v1.6',
      inputs: {
        model_image,
        garment_image,
        category: options.category || 'auto',
        output_format: options.output_format || 'jpeg',
        mode: options.mode || 'balanced',
        num_samples: options.num_samples || 1
      }
    };

    // Forward optional age if provided (supports kids/adult try-ons)
    if (options.age !== undefined) {
      payload.inputs.age = options.age;
    }

    const response = await fetch('https://api.fashn.ai/v1/run', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FASHN_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      throw new Error('Fashn.AI API error: ' + response.statusText);
    }
    
    const data = await response.json();
    
    // Step 2: Track usage for this customer
    await trackUsage(req.customer.customerId, 1);
    
    // Step 3: Return prediction ID to customer
    res.json({
      id: data.id,
      status: 'processing',
      message: 'Try-on initiated successfully'
    });
    
  } catch (error) {
    console.error('❌ Try-on error:', error);
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: 'Failed to process try-on request' 
    });
  }
});

// =================================================================
// ROUTE: Check Try-On Status (Proxied to Fashn.AI)
// =================================================================

app.get('/api/tryon/:id', verifyCustomerApiKey, async (req, res) => {
  const { id } = req.params;
  
  try {
    // Call Fashn.AI status endpoint
    const response = await fetch(`https://api.fashn.ai/v1/status/${id}`, {
      headers: {
        'Authorization': `Bearer ${FASHN_API_KEY}`
      }
    });
    
    if (!response.ok) {
      throw new Error('Fashn.AI API error: ' + response.statusText);
    }
    
    const data = await response.json();
    
    // Return status to customer
    res.json(data);
    
  } catch (error) {
    console.error('❌ Status check error:', error);
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: 'Failed to check try-on status' 
    });
  }
});

// =================================================================
// ROUTE: Get Usage Stats (for customer dashboard)
// =================================================================

app.get('/api/usage', verifyCustomerApiKey, async (req, res) => {
  const { customer } = req;
  res.json({
    email: customer.email,
    plan: customer.plan,
    used: customer.usage.currentMonth.tryons,
    limit: customer.usage.limit,
    remaining: customer.getRemainingUsage(),
    percentUsed: customer.getUsagePercentage(),
    overLimit: customer.hasExceededLimit(),
    lastReset: customer.usage.lastResetDate
  });
});

// =================================================================
// ADMIN ROUTES: Generate API Keys (Your internal use only)
// =================================================================

// Generate new API key for customer (create new customer)
app.post('/admin/generate-key', async (req, res) => {
  const { email, name, plan = 'starter', companyName } = req.body;
  try {
    // Check if customer already exists
    let customer = await Customer.findOne({ email });
    if (customer) {
      return res.status(400).json({ error: 'Customer already exists', apiKey: customer.apiKey });
    }
    // Create new customer
    customer = new Customer({ email, name, plan, companyName });
    await customer.save();
    res.json({ success: true, apiKey: customer.apiKey, message: 'API key generated successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create customer', details: err.message });
  }
});

// Revoke API key (deactivate customer)
app.post('/admin/revoke-key', async (req, res) => {
  const { apiKey } = req.body;
  try {
    const customer = await Customer.findOne({ apiKey });
    if (!customer) {
      return res.status(404).json({ error: 'Not Found', message: 'API key not found' });
    }
    customer.subscriptionStatus = 'inactive';
    await customer.save();
    res.json({ success: true, message: 'API key revoked' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to revoke key', details: err.message });
  }
});

// =================================================================
// HEALTH CHECK
// =================================================================

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'Vmize Studio Proxy',
    timestamp: new Date().toISOString()
  });
});

// =================================================================
// START SERVER
// =================================================================

app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════════════════════════╗
  ║                                                               ║
  ║   🚀 VMIZE STUDIO - SECURE BACKEND PROXY                     ║
  ║                                                               ║
  ║   Status: Running on port ${PORT}                                ║
  ║   Security: ✅ Fashn.AI key hidden from customers            ║
  ║   API: https://your-domain.com/api/tryon                     ║
  ║                                                               ║
  ╚═══════════════════════════════════════════════════════════════╝
  `);
});

// =================================================================
// EXPORT FOR TESTING
// =================================================================

module.exports = app;
