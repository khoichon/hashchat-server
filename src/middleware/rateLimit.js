const rateLimit = require("express-rate-limit");

const makeLimit = (windowMs, max, message) => rateLimit({
  windowMs, max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: message },
  handler: (req, res, next, options) => {
    res.status(429).json({
      error: options.message.error,
      retryAfter: Math.ceil(options.windowMs / 1000),
    });
  },
});

// Global — 60 req/min per IP
const globalLimiter = makeLimit(60 * 1000, 60, 'too many requests, slow down');

// Messages — 5 per 3s (strict anti-spam)
const messageLimiter = makeLimit(3 * 1000, 5, 'slow down — max 5 messages per 3 seconds');

// Invites — 10 per minute
const inviteLimiter = makeLimit(60 * 1000, 10, 'too many invites — try again soon');

// Room actions — 20 per minute
const roomLimiter = makeLimit(60 * 1000, 20, 'too many room actions — try again soon');

// Uploads — 10 per 5 min
const uploadLimiter = makeLimit(5 * 60 * 1000, 10, 'upload limit reached — try again in 5 minutes');

// Auth endpoints — 10 per 15 min
const authLimiter = makeLimit(15 * 60 * 1000, 10, 'too many attempts — try again in 15 minutes');

// Catchup — 1 per minute (no need to hammer this)
const catchupLimiter = makeLimit(60 * 1000, 1, 'catchup already requested — try again in a minute');

module.exports = { globalLimiter, messageLimiter, inviteLimiter, roomLimiter, uploadLimiter, authLimiter, catchupLimiter };
