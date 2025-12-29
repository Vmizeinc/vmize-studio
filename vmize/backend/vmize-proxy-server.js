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

// In-memory store for customer API keys (use database in production)
// Format: { 'vmize_pk_live_store123': { storeId: 'store123', plan: 'professional', ... } }
const CUSTOMER_API_KEYS = new Map();

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
  
  // Look up customer from database (simplified here)
  const customer = await getCustomerByApiKey(apiKey);
  
  if (!customer) {
    return res.status(401).json({ 
      error: 'Unauthorized', 
      message: 'Invalid API key' 
    });
  }
  
  // Check if customer has active subscription
  if (customer.status !== 'active') {
    return res.status(403).json({ 
      error: 'Forbidden', 
      message: 'Subscription inactive. Please update billing.' 
    });
  }
  
  // Check usage limits
  if (customer.usageThisMonth >= customer.planLimit) {
    return res.status(429).json({ 
      error: 'Quota Exceeded', 
      message: 'Monthly try-on limit reached. Upgrade your plan.' 
    });
  }
  
  // Attach customer info to request
  req.customer = customer;
  next();
}

// =================================================================
// HELPER: Get customer by API key
// =================================================================

async function getCustomerByApiKey(apiKey) {
  // In production, query your MongoDB database:
  // const customer = await Customer.findOne({ apiKey });
  
  // For now, simulate database lookup
  if (CUSTOMER_API_KEYS.has(apiKey)) {
    return CUSTOMER_API_KEYS.get(apiKey);
  }
  
  return null;
}

// =================================================================
// HELPER: Track usage
// =================================================================

async function trackUsage(customerId, tryonCount = 1) {
  // In production, update MongoDB:
  // await Customer.updateOne(
  //   { _id: customerId },
  //   { $inc: { 'usage.currentMonth': tryonCount } }
  // );
  
  console.log(`📊 Tracked ${tryonCount} try-on(s) for customer ${customerId}`);
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
    customerId: customer.customerId,
    plan: customer.plan,
    usageThisMonth: customer.usageThisMonth,
    planLimit: customer.planLimit,
    remaining: customer.planLimit - customer.usageThisMonth,
    percentUsed: Math.round((customer.usageThisMonth / customer.planLimit) * 100)
  });
});

// =================================================================
// ADMIN ROUTES: Generate API Keys (Your internal use only)
// =================================================================

// Generate new API key for customer
app.post('/admin/generate-key', async (req, res) => {
  const { customerId, plan, email } = req.body;
  
  // Generate unique API key
  const apiKey = `vmize_pk_live_${customerId}_${Date.now()}`;
  
  // Get plan limits
  const planLimits = {
    'starter': 100,
    'professional': 500,
    'business': 2000,
    'enterprise': 10000
  };
  
  // Store customer info
  CUSTOMER_API_KEYS.set(apiKey, {
    customerId,
    apiKey,
    plan,
    email,
    status: 'active',
    planLimit: planLimits[plan] || 100,
    usageThisMonth: 0,
    createdAt: new Date()
  });
  
  res.json({
    success: true,
    apiKey,
    message: 'API key generated successfully'
  });
});

// Revoke API key
app.post('/admin/revoke-key', async (req, res) => {
  const { apiKey } = req.body;
  
  if (CUSTOMER_API_KEYS.has(apiKey)) {
    CUSTOMER_API_KEYS.delete(apiKey);
    res.json({ success: true, message: 'API key revoked' });
  } else {
    res.status(404).json({ error: 'Not Found', message: 'API key not found' });
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
