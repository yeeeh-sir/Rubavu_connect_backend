const authService = require('../services/authService');
const { sendSuccess, sendError } = require('../utils/response');
const { OAuth2Client } = require('google-auth-library');

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClient = googleClientId ? new OAuth2Client(googleClientId) : null;

async function register(req, res, next) {
  try {
    const { full_name, username, email, password } = req.body;
    const result = await authService.registerUser({ full_name, username, email, password });

    res.cookie('token', result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return sendSuccess(res, 'Registration successful', {
      user: result.user,
      token: result.token,
    }, 201);
  } catch (error) {
    next(error);
  }
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    const result = await authService.loginUser({ email, password });

    res.cookie('token', result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return sendSuccess(res, 'Login successful', {
      user: result.user,
      token: result.token,
    });
  } catch (error) {
    next(error);
  }
}

async function googleLogin(req, res, next) {
  try {
    const { credential } = req.body;

    if (!googleClient) {
      return sendError(res, 'Google login is not configured on the server', null, 503);
    }

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: googleClientId,
      });
      payload = ticket.getPayload();
    } catch (error) {
      return sendError(res, 'Invalid Google token', null, 401);
    }

    if (!payload?.sub || !payload.email || payload.email_verified !== true) {
      return sendError(res, 'Google account email is not verified', null, 401);
    }

    const result = await authService.googleAuth({
      google_id: payload.sub,
      email: payload.email,
      full_name: payload.name || payload.email.split('@')[0],
      profile_image_url: payload.picture || null,
    });

    res.cookie('token', result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return sendSuccess(res, 'Google authentication successful', {
      user: result.user,
      token: result.token,
    });
  } catch (error) {
    next(error);
  }
}

async function getMe(req, res, next) {
  try {
    return sendSuccess(res, 'User retrieved', { user: req.user });
  } catch (error) {
    next(error);
  }
}

async function logout(req, res, next) {
  try {
    res.clearCookie('token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });
    return sendSuccess(res, 'Logged out successfully');
  } catch (error) {
    next(error);
  }
}

module.exports = { register, login, googleLogin, getMe, logout };
