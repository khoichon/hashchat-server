const rateLimit = require("express-rate-limit");

const globalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, max: 60,
  standardHeaders: true, legacyHeaders: false,
  message: { error: "too many requests, slow down" },
});

const uploadLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, max: 20,
  message: { error: "upload limit reached" },
});

// Message sends — generous but prevents spam
const messageLimiter = rateLimit({
  windowMs: 10 * 1000, max: 20, // 20 messages per 10s
  message: { error: "slow down there" },
});

module.exports = { globalLimiter, uploadLimiter, messageLimiter };
