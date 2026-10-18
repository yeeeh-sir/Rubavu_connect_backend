const rateLimit = require('express-rate-limit');

const disabled = process.env.RATE_LIMIT_DISABLED === 'true';

const keyByUser = (req) => req.user?.id || req.user?._id || req.ip;

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_RATE_LIMIT) || 100,
  skipSuccessfulRequests: true,
  skip: () => disabled,
  message: {
    success: false,
    message: 'Too many authentication attempts. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const messageLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: Number(process.env.MESSAGE_RATE_LIMIT) || 120,
  skip: () => disabled,
  message: {
    success: false,
    message: 'Too many messages. Please slow down.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.SENSITIVE_RATE_LIMIT) || 1000,
  keyGenerator: keyByUser,
  skip: () => disabled,
  message: {
    success: false,
    message: 'Too many sensitive requests. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { authLimiter, messageLimiter, sensitiveLimiter };
