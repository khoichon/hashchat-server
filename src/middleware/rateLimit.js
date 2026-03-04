const rateLimit = require('express-rate-limit');

// Blanket limiter — every endpoint
const globalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60,                  // 60 req/min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, slow down 💀' },
});

// Stricter limiter for uploads specifically
const uploadLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20,                  // 20 uploads per 5 min
  message: { error: 'Upload limit reached, take a breath' },
});

module.exports = { globalLimiter, uploadLimiter };