require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet');
const cors = require('cors');
const cron = require('node-cron');

const app = express();
const path = require('path');
// Hide framework fingerprint
app.disable('x-powered-by');
// =====================================
// SECURITY MIDDLEWARE
// =====================================
app.use(helmet());

// HTTPS redirect (production only)
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      res.redirect(`https://${req.header('host')}${req.url}`);
    } else {
      next();
    }
  });
}

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      'http://localhost:3000',
      'http://localhost:5000',
      'http://127.0.0.1:5000',
      'http://localhost:5173',
      ...( process.env.ALLOWED_ORIGINS?.split(',') || [])
    ];
    
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// Stripe webhook endpoint (raw body required) - keep BEFORE JSON body parser
let handleWebhook;
try {
  ({ handleWebhook } = require('./controllers/billingController'));
} catch (err) {
  console.warn('billingController not found; using stub handler');
  handleWebhook = (req, res) => res.status(200).json({ success: true });
}
app.post('/api/v1/webhooks/stripe', express.raw({ type: 'application/json' }), handleWebhook);

// Body parser (after webhook route)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Trust proxy
app.set('trust proxy', 1);

// Frontend/Admin roots (resolved later, after API route setup)
// Use the `frontend` folder present in the repo.
const frontendRoot = path.join(__dirname, '..', 'frontend');
// Admin files live inside the frontend folder in this repo.
const adminRoot = frontendRoot;

// =====================================
// DATABASE CONNECTION
// =====================================
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ MongoDB Connection Error: ${error.message}`);
    process.exit(1);
  }
};

// Only connect to the database when explicitly allowed (avoid connecting during in-process tests)
if (process.env.START_DB !== 'false') {
  connectDB();
} else {
  console.log('Skipping DB connection (START_DB=false)');
}

// =====================================
// ROUTES
// =====================================

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'SaaS Backend API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    version: '1.0.0'
  });
});

// API routes
app.use('/api/v1/auth', require('./routes/auth'));
app.use('/api/v1/billing', require('./routes/billing'));
app.use('/api/v1/tryon', require('./routes/tryon'));

// -------------------------------------
// Legacy /api compatibility & shims
// Mount the proxy (with analytics if available) so unversioned endpoints like
// `/api/tryon` and `/api/analytics` work for embedded widgets and older clients.
try {
  const proxyWithAnalytics = require('./vmize-proxy-server-with-analytics');
  app.use(proxyWithAnalytics);
  console.log('Mounted vmize proxy with analytics for legacy /api endpoints');
} catch (err) {
  try {
    const proxy = require('./vmize-proxy-server');
    app.use(proxy);
    console.log('Mounted vmize proxy for legacy /api endpoints');
  } catch (err2) {
    console.log('No vmize proxy server found — legacy /api endpoints unavailable');
  }
}

// Forward/version-compat: redirect /api/v1/tryon/* -> /api/tryon/* using 307 to preserve method
app.use('/api/v1/tryon', (req, res) => {
  const newPath = req.originalUrl.replace(/^\/api\/v1\/tryon/, '/api/tryon');
  console.debug(`[Compat] Redirecting ${req.originalUrl} -> ${newPath}`);
  return res.redirect(307, newPath);
});

// Simple admin login stub for demo/testing so `admin-login.html` can authenticate locally
app.post('/admin/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === 'admin' && password === 'VmizeAdmin2025!') {
    return res.json({ token: 'demo_admin_token' });
  }
  return res.status(401).json({ message: 'Invalid credentials' });
});

// ==========================
// CONDITIONAL STATIC SERVING
// Move static serving after API routes so API always takes precedence.
// Set SERVE_STATIC=false when hosting frontend separately (Netlify/Vercel).
// ==========================
const serveStatic = process.env.SERVE_STATIC !== 'false';
if (serveStatic) {
  // Serve static assets (CSS/JS/images/etc.)
  app.use(express.static(frontendRoot));
  app.use('/admin', express.static(adminRoot));

  // Convenience routes to serve main HTML files
  app.get('/', (req, res) => res.sendFile(path.join(frontendRoot, 'index.html')));
  app.get('/admin', (req, res) => res.sendFile(path.join(adminRoot, 'admin-dashboard.html')));
  app.get('/admin/login', (req, res) => res.sendFile(path.join(adminRoot, 'admin-login.html')));

  console.log('Static serving enabled: Frontend and Admin assets will be served by this backend');
} else {
  console.log('Static serving disabled (SERVE_STATIC=false). Serve frontend separately on Netlify/Vercel)');
}

// SPA fallback + API 404 handler
app.use('*', (req, res) => {
  // Let API routes return JSON 404s
  if (req.originalUrl.startsWith('/api/')) {
    if (process.env.DEBUG_FALLBACK === 'true') {
      console.debug(`[API 404] ${req.method} ${req.originalUrl}`);
    }
    return res.status(404).json({
      success: false,
      message: 'API route not found',
      path: req.originalUrl
    });
  }

  // Admin prefix protection: only match /admin or /admin/* (avoid accidental matches)
  const p = req.path || '';
  if (p === '/admin' || p.startsWith('/admin/')) {
    if (process.env.DEBUG_FALLBACK === 'true') {
      console.debug(`[SPA Fallback -> Admin] ${req.method} ${req.originalUrl}`);
    }
    // If static serving is disabled, return 404 for admin assets
    if (process.env.SERVE_STATIC === 'false') {
      return res.status(404).json({ success: false, message: 'Admin UI not hosted on this server' });
    }
    return res.sendFile(path.join(adminRoot, 'admin-dashboard.html'));
  }

  // Default: serve frontend SPA entry (enables client-side routing)
  if (process.env.DEBUG_FALLBACK === 'true') {
    console.debug(`[SPA Fallback -> Frontend] ${req.method} ${req.originalUrl}`);
  }
  if (process.env.SERVE_STATIC === 'false') {
    return res.status(404).json({ success: false, message: 'Frontend not hosted on this server' });
  }
  return res.sendFile(path.join(frontendRoot, 'index.html'));
});

// =====================================
// ERROR HANDLER
// =====================================
app.use((err, req, res, next) => {
  console.error('Error:', err);

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map(e => e.message);
    return res.status(400).json({
      success: false,
      message: 'Validation Error',
      errors
    });
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern)[0];
    return res.status(400).json({
      success: false,
      message: `${field} already exists`
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Token expired'
    });
  }

  // Default error
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// =====================================
// CRON JOBS
// =====================================

// Reset monthly usage (runs on 1st of each month at midnight)
if (process.env.START_CRONS !== 'false') {
  cron.schedule(process.env.BILLING_CRON_SCHEDULE || '0 0 1 * *', async () => {
    console.log('🔄 Running monthly billing job...');
    
    try {
      const Customer = require('./models/Customer');
      const stripeService = require('./services/stripeService');
      
      const customers = await Customer.find({ subscriptionStatus: 'active' });
      
      for (const customer of customers) {
        // Calculate overage charges
        const { overage, cost } = customer.calculateOverage();
        
        if (cost > 0) {
          console.log(`💰 Charging customer ${customer.email} overage: $${cost}`);
          await stripeService.createOverageCharge(
            customer.stripeCustomerId,
            cost,
            `Usage overage: ${overage} try-ons`
          );
        }
        
        // Reset monthly usage
        await customer.resetMonthlyUsage();
      }
      
      console.log('✅ Monthly billing completed');
    } catch (error) {
      console.error('❌ Monthly billing error:', error);
    }
  });
} else {
  console.log('Cron jobs disabled (START_CRONS=false) - skipping monthly billing job registration');
}

// Send usage reports (runs every Monday at 9 AM)
if (process.env.START_CRONS !== 'false') {
  cron.schedule(process.env.USAGE_REPORT_CRON_SCHEDULE || '0 9 * * MON', async () => {
    console.log('📊 Sending weekly usage reports...');
    
    try {
      const Customer = require('./models/Customer');
      const customers = await Customer.find({ 
        subscriptionStatus: { $in: ['active', 'trialing'] },
        'notifications.usageAlerts': true
      });
      
      for (const customer of customers) {
        const usagePercentage = customer.getUsagePercentage();
        
        // Send email if usage > 80%
        if (usagePercentage >= 80) {
          console.log(`📧 Sending usage alert to ${customer.email} (${usagePercentage}%)`);
          // await emailService.sendUsageAlert(customer, usagePercentage);
        }
      }
      
      console.log('✅ Usage reports sent');
    } catch (error) {
      console.error('❌ Usage reports error:', error);
    }
  });
} else {
  console.log('Cron jobs disabled (START_CRONS=false) - skipping weekly usage reports job registration');
}

// =====================================
// START SERVER (only when run directly)
// =====================================
if (require.main === module) {
  const PORT = process.env.PORT || 5000;

  const server = app.listen(PORT, () => {
    const assignedPort = server.address() && server.address().port;
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🚀 VIRTUAL TRY-ON SAAS BACKEND - SERVER STARTED        ║
║                                                           ║
║   📍 Port: ${assignedPort}                                             ║
║   🌍 Environment: ${process.env.NODE_ENV}                          ║
║   🔒 HTTPS Only: ${process.env.NODE_ENV === 'production' ? 'Yes' : 'No (Dev)'}                    ║
║   💳 Stripe Mode: ${process.env.STRIPE_TEST_MODE === 'true' ? 'Test' : 'Live'}                  ║
║                                                           ║
║   📡 API Endpoints:                                       ║
║      - POST /api/v1/auth/register                        ║
║      - POST /api/v1/auth/login                           ║
║      - POST /api/v1/billing/create-checkout              ║
║      - POST /api/v1/tryon (requires API key)             ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
    `);
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (err) => {
    console.error(`❌ Unhandled Rejection: ${err.message}`);
    server.close(() => process.exit(1));
  });

  // Handle SIGTERM
  process.on('SIGTERM', () => {
    console.log('👋 SIGTERM received. Shutting down gracefully...');
    server.close(() => {
      console.log('Process terminated');
    });
  });
}

module.exports = app;
