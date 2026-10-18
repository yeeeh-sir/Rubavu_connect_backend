const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'rubavu_connect_secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, username: user.username },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function generateActionToken(userId, action) {
  return jwt.sign(
    { id: userId, purpose: action },
    JWT_SECRET,
    { expiresIn: '5m' }
  );
}

function verifyActionToken(token, action) {
  const decoded = jwt.verify(token, JWT_SECRET);
  if (decoded.purpose !== action || !decoded.id) {
    throw new jwt.JsonWebTokenError('Invalid verification token');
  }
  return decoded;
}

module.exports = { generateToken, verifyToken, generateActionToken, verifyActionToken };
