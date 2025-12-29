const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();

// Lightweight auth routes suitable for local/dev and in-process tests
// These use the `Customer` model if available (tests mock it); otherwise they fall
// back to simple in-memory behavior.
const Customer = (() => {
  try { return require('../models/Customer'); } catch (e) { return null; }
})();

function makeToken(payload) {
  const secret = process.env.JWT_SECRET || 'dev-jwt-secret';
  return jwt.sign(payload, secret, { expiresIn: '7d' });
}

router.post('/register', async (req, res) => {
  try {
    if (!Customer || !Customer.create) {
      // Fallback: return a fake user with a token
      const id = String(Date.now());
      const user = { _id: id, email: req.body.email || `user+${id}@example.com` };
      return res.json({ success: true, data: { tokens: { accessToken: makeToken({ _id: user._id, email: user.email }) }, user } });
    }

    const user = await Customer.create(req.body);
    const accessToken = (typeof user.generateAccessToken === 'function') ? user.generateAccessToken() : makeToken({ _id: user._id, email: user.email });
    const refreshToken = (typeof user.generateRefreshToken === 'function') ? user.generateRefreshToken() : null;

    return res.json({ success: true, data: { tokens: { accessToken, refreshToken }, user } });
  } catch (err) {
    console.error('Auth register error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    if (!Customer || !Customer.findOne) {
      // Simple demo login
      if (req.body.email && req.body.password) {
        return res.json({ success: true, data: { tokens: { accessToken: makeToken({ email: req.body.email }) } } });
      }
      return res.status(400).json({ success: false, message: 'Missing credentials' });
    }

    const user = await Customer.findOne({ email: req.body.email }).select('+password');
    if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const ok = await user.comparePassword(req.body.password);
    if (!ok) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const accessToken = (typeof user.generateAccessToken === 'function') ? user.generateAccessToken() : makeToken({ _id: user._id, email: user.email });
    return res.json({ success: true, data: { tokens: { accessToken } } });
  } catch (err) {
    console.error('Auth login error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
