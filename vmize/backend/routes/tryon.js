const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();

// Minimal tryon route set used by integration tests and the widget.
// Depends on global `fetch` (tests mock fetch) and optional Customer/User models.
const User = (() => { try { return require('../models/User'); } catch (e) { return null; } })();

function verifyJwt(req, res, next) {
  const auth = req.headers.authorization || req.headers.Authorization || '';
  const token = (auth && auth.split(' ')[0] === 'Bearer') ? auth.split(' ')[1] : null;
  if (!token) return res.status(401).json({ success: false, message: 'Missing token' });
  try {
    const secret = process.env.JWT_SECRET || 'dev-jwt-secret';
    req.user = jwt.verify(token, secret);
    return next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

// POST /generate - creates a try-on (calls Fashn.AI via fetch)
router.post('/generate', verifyJwt, async (req, res) => {
  try {
    const { modelImage, garmentImage, productId, age } = req.body || {};
    if (!modelImage || !garmentImage) return res.status(400).json({ success: false, message: 'Missing images' });

    // Build request body and forward optional age
    const reqBody = { model_image: modelImage, garment_image: garmentImage };
    if (age !== undefined) reqBody.age = age;

    // Call Fashn.AI or similar (tests will mock global.fetch)
    const resp = await fetch(process.env.FASHN_AI_API_URL || 'https://api.fashn.ai/v1/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody)
    });

    const body = await resp.json();

    // If mocked response contains an image url, return it
    const imageUrl = (body && (body.output?.image_url || body.data?.imageUrl || body.imageUrl)) || null;
    if (imageUrl) {
      return res.json({ success: true, data: { imageUrl } });
    }

    // Generic: return a processing id if available
    return res.json({ success: true, data: { id: body.id || null, status: body.status || 'processing' } });
  } catch (err) {
    console.error('Tryon generate error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/history', verifyJwt, async (req, res) => {
  // Simple stub returning empty history; can be extended to use DB
  return res.json({ success: true, data: [] });
});

router.post('/track-view', async (req, res) => {
  // Accept tracking pings from widgets
  // noop for now — in production store analytics
  return res.json({ success: true });
});

module.exports = router;
