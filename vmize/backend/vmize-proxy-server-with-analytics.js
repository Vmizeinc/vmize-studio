/**
 * Vmize Backend Proxy Server with Real Analytics Tracking
 * Tracks every API call and event in real-time
 */

const express = require('express');
const cors = require('cors');
require('dotenv').config();
const AnalyticsTracker = require('./analytics-tracker');

const app = express();
const PORT = process.env.PORT || 3000;
const FASHN_API_KEY = process.env.FASHN_API_KEY;
const FASHN_API_URL = process.env.FASHN_API_URL || process.env.FASHN_AI_API_URL || 'https://api.fashn.ai/v1/run';
const FASHN_BASE = FASHN_API_URL.replace(/\/run$/, '');
const axios = require('axios');

// Initialize analytics
const analytics = new AnalyticsTracker();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Demo customer storage (replace with database in production)
const demoKeys = {
    'vmize_pk_demo_test_1234567890': {
        customerId: 'demo_customer',
        email: 'demo@example.com',
        plan: 'professional',
        limit: 500,
        used: 0
    }
};

// Middleware: Verify API Key
function verifyVmizeKey(req, res, next) {
    const apiKey = req.headers['x-vmize-api-key'];
    
    if (!apiKey) {
        return res.status(401).json({ error: 'API key required' });
    }
    
    if (!apiKey.startsWith('vmize_pk_')) {
        return res.status(401).json({ error: 'Invalid API key format' });
    }
    
    const customer = demoKeys[apiKey];
    
    if (!customer) {
        return res.status(401).json({ error: 'Invalid API key' });
    }
    
    if (customer.used >= customer.limit) {
        return res.status(429).json({ 
            error: 'Usage limit exceeded',
            limit: customer.limit,
            used: customer.used
        });
    }
    
    req.customer = customer;
    req.apiKey = apiKey;
    next();
}

// Health Check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        timestamp: new Date().toISOString()
    });
});

// Compatibility endpoint: track analytics events from demo site
app.post('/api/analytics/track', async (req, res) => {
    try {
        const { event, properties, timestamp, session_id } = req.body || {};
        const payload = {
            properties: properties || {},
            timestamp: timestamp || new Date().toISOString(),
            session_id: session_id || null,
            user_ip: req.ip,
            user_agent: req.get('User-Agent')
        };

        // Map event name and payload into analytics tracker
        await analytics.trackEvent(event, payload);

        res.json({ success: true, event, timestamp: payload.timestamp });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get Analytics
app.get('/api/analytics', async (req, res) => {
    try {
        const summary = analytics.getAnalyticsSummary();
        res.json(summary);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get Conversion Funnel
app.get('/api/analytics/funnel', async (req, res) => {
    try {
        const funnel = analytics.getConversionFunnel();
        res.json(funnel);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Track Event
app.post('/api/track', async (req, res) => {
    try {
        const { eventName, data } = req.body;
        
        await analytics.trackEvent(eventName, data);
        
        res.json({ 
            success: true,
            eventName,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Virtual Try-On Implementation (extracted for reuse)
async function doTryOn(req, res) {
    const startTime = Date.now();
    const { model_image, garment_image, category = 'auto', mode = 'quality', age } = req.body;

    console.log(`🎨 Try-on request from ${req.customer?.customerId || 'unknown'}`);

    // Track API call start
    await analytics.trackEvent('tryon_initiated', {
        customerId: req.customer?.customerId || null,
        productId: req.body.productId
    });

    try {
        if (!FASHN_API_KEY) {
            throw new Error('FASHN_API_KEY not configured');
        }

        if (!model_image || !garment_image) {
            throw new Error('Both model_image and garment_image are required');
        }

        // Track photo upload
        await analytics.trackEvent('photo_uploaded', {
            customerId: req.customer?.customerId || null
        });

        // Build payload and forward optional age if present
        const payload = {
            model_name: 'tryon-v1.6',
            inputs: {
                model_image,
                garment_image,
                category,
                mode
            }
        };

        if (age !== undefined) payload.inputs.age = age;

        // Validate FASHN base
        try {
            const parsed = new URL(FASHN_BASE);
            if (parsed.port && isNaN(Number(parsed.port))) {
                throw new Error(`Invalid port in FASHN_API_URL: '${parsed.port}'`);
            }
            if (!['http:', 'https:'].includes(parsed.protocol)) {
                throw new Error(`Invalid protocol in FASHN_API_URL: '${parsed.protocol}'`);
            }
        } catch (urlErr) {
            console.error('❌ FASHN_API_URL validation failed:', urlErr.message);
            throw new Error(`Invalid FASHN_API_URL: ${urlErr.message}`);
        }

        // Call Fashn API via axios to avoid undici/fetch IPv6/port issues
        console.log(`[vmize->Fashn] POST ${FASHN_API_URL} age=${age}`);
        let fashnResp;
        try {
            fashnResp = await axios.post(FASHN_API_URL, payload, {
                headers: {
                    'Authorization': `Bearer ${FASHN_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            });
        } catch (axiosErr) {
            console.error('❌ Axios request to Fashn failed:', axiosErr.message, axiosErr.response?.data || '');
            throw new Error(axiosErr.response ? `Fashn API error: ${axiosErr.response.status}` : axiosErr.message);
        }

        const data = fashnResp.data;
        console.log('[vmize->Fashn] response', fashnResp.status, data);

        if (fashnResp.status >= 400) {
            throw new Error(data.error?.message || 'Fashn API error');
        }

        // Increment usage (if apiKey is available in demo keys)
        if (req.apiKey && demoKeys[req.apiKey]) demoKeys[req.apiKey].used++;

        const duration = Date.now() - startTime;

        // Track successful API call
        await analytics.trackApiCall({
            customerId: req.customer?.customerId || null,
            apiKey: req.apiKey,
            endpoint: '/api/tryon',
            method: 'POST',
            status: 'success',
            duration,
            productId: req.body.productId
        });

        return res.json({
            prediction_id: data.id,
            status: data.status,
            used: req.apiKey && demoKeys[req.apiKey] ? demoKeys[req.apiKey].used : undefined,
            remaining: req.apiKey && demoKeys[req.apiKey] ? demoKeys[req.apiKey].limit - demoKeys[req.apiKey].used : undefined
        });

    } catch (error) {
        const duration = Date.now() - startTime;

        // Track failed API call (best effort)
        await analytics.trackApiCall({
            customerId: req.customer?.customerId || null,
            apiKey: req.apiKey,
            endpoint: '/api/tryon',
            method: 'POST',
            status: 'error',
            duration,
            error: error.message
        }).catch(() => {});

        await analytics.trackEvent('api_error', {
            customerId: req.customer?.customerId || null,
            error: error.message
        }).catch(() => {});

        console.error('❌ Error:', error);
        return res.status(500).json({ 
            error: error.message,
            used: req.apiKey && demoKeys[req.apiKey] ? demoKeys[req.apiKey].used : undefined,
            remaining: req.apiKey && demoKeys[req.apiKey] ? demoKeys[req.apiKey].limit - demoKeys[req.apiKey].used : undefined
        });
    }
}

// Standard route (requires valid API key)
app.post('/api/tryon', verifyVmizeKey, doTryOn);

// Demo-friendly generate endpoint (used by demo frontend without headers)
app.post('/api/tryon/generate', async (req, res) => {
    // Inject demo API key when missing
    if (!req.headers['x-vmize-api-key']) {
        req.headers['x-vmize-api-key'] = 'vmize_pk_demo_test_1234567890';
    }

    // Run verification and then the tryon handler
    verifyVmizeKey(req, res, async () => {
        await doTryOn(req, res);
    });
});

// Get Try-On Status (allows demo calls without explicit header)
app.get('/api/tryon/:id', async (req, res) => {
    // Inject demo key when missing so demo frontend polling works
    if (!req.headers['x-vmize-api-key']) {
        req.headers['x-vmize-api-key'] = 'vmize_pk_demo_test_1234567890';
    }

    // Run verification then the status check
    verifyVmizeKey(req, res, async () => {
        const startTime = Date.now();
        const { id } = req.params;
        
        try {
            if (!FASHN_API_KEY) {
                throw new Error('FASHN_API_KEY not configured');
            }
            
            let statusResp;
            try {
                statusResp = await axios.get(`${FASHN_BASE}/status/${id}`, {
                    headers: {
                        'Authorization': `Bearer ${FASHN_API_KEY}`
                    },
                    timeout: 10000
                });
            } catch (axiosErr) {
                console.error('❌ Axios status check to Fashn failed:', axiosErr.message, axiosErr.response?.data || '');
                throw new Error('Status check failed');
            }

            const data = statusResp.data;

            if (!statusResp || !statusResp.status || statusResp.status >= 400) {
                throw new Error(data.error?.message || 'Status check failed');
            }
            
            const duration = Date.now() - startTime;
            
            // Track status check
            await analytics.trackApiCall({
                customerId: req.customer.customerId,
                apiKey: req.apiKey,
                endpoint: `/api/tryon/${id}`,
                method: 'GET',
                status: 'success',
                duration
            });
            
            // If completed, track result generation
            if (data.status === 'completed') {
                await analytics.trackEvent('result_generated', {
                    customerId: req.customer.customerId
                });
                
                await analytics.trackEvent('result_viewed', {
                    customerId: req.customer.customerId
                });
            }
            
            res.json(data);
            
        } catch (error) {
            const duration = Date.now() - startTime;
            
            await analytics.trackApiCall({
                customerId: req.customer.customerId,
                apiKey: req.apiKey,
                endpoint: `/api/tryon/${id}`,
                method: 'GET',
                status: 'error',
                duration,
                error: error.message
            });
            
            console.error('❌ Error:', error);
            res.status(500).json({ error: error.message });
        }
    });
});

// Get Usage Stats
app.get('/api/usage', verifyVmizeKey, (req, res) => {
    const customer = req.customer;
    
    res.json({
        customerId: customer.customerId,
        plan: customer.plan,
        limit: customer.limit,
        used: customer.used,
        remaining: customer.limit - customer.used,
        percentageUsed: ((customer.used / customer.limit) * 100).toFixed(2) + '%'
    });
});

// Reset Analytics (for testing)
app.post('/api/analytics/reset', async (req, res) => {
    try {
        await analytics.reset();
        
        // Reset demo customer usage
        Object.keys(demoKeys).forEach(key => {
            demoKeys[key].used = 0;
        });
        
        res.json({ 
            success: true,
            message: 'Analytics reset successfully'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║   🚀 Vmize Backend Server with Analytics             ║
║                                                       ║
║   Server running on: http://localhost:${PORT}         ║
║   Analytics enabled: ✅                               ║
║   Fashn API configured: ${FASHN_API_KEY ? '✅' : '❌'}                      ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝

📊 Analytics Endpoints:
   GET  /api/analytics         - Get full analytics summary
   GET  /api/analytics/funnel  - Get conversion funnel data
   POST /api/track             - Track custom event
   POST /api/analytics/reset   - Reset all analytics (testing)

🎨 Try-On Endpoints:
   POST /api/tryon             - Create virtual try-on
   GET  /api/tryon/:id         - Get try-on status
   GET  /api/usage             - Get usage statistics

💡 Every API call is now being tracked in real-time!
    `);
});

module.exports = app;
