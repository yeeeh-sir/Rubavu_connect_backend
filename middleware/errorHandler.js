const safeProductionMessages = new Set([
  'Invalid email or password',
  'Account has been deactivated',
]);

function redactSensitiveDetails(message) {
  return String(message)
    .replace(
      /\b(password|passwd|token|secret|authorization|credential|api[_-]?key)\b(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '$1$2[REDACTED]'
    )
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]');
}

function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  const diagnostic = {
    statusCode,
    method: req.method,
    path: req.originalUrl.split('?')[0],
    name: err.name,
    code: err.code,
  };

  if (statusCode >= 500) {
    diagnostic.message = redactSensitiveDetails(err.message || 'Unknown error');
    console.error('Request error:', diagnostic);
  } else {
    console.warn('Request rejected:', diagnostic);
  }

  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      message: 'Request entity too large.',
    });
  }

  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }

  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({
      success: false,
      message: 'Duplicate entry. Resource already exists.',
    });
  }

  if (err.code === 'ER_NO_REFERENCED_ROW_2') {
    return res.status(400).json({
      success: false,
      message: 'Referenced resource not found.',
    });
  }

  const message =
    process.env.NODE_ENV === 'production'
      ? (safeProductionMessages.has(err.message) ? err.message : 'Internal server error')
      : err.message || 'Internal server error';

  res.status(statusCode).json({
    success: false,
    message,
  });
}

module.exports = errorHandler;
