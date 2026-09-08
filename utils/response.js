function sendSuccess(res, message = 'Success', data = {}, statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
}

function sendError(res, message = 'Error', error = null, statusCode = 400) {
  const response = {
    success: false,
    message,
  };
  if (error && process.env.NODE_ENV !== 'production') {
    response.error = error;
  }
  return res.status(statusCode).json(response);
}

module.exports = { sendSuccess, sendError };
