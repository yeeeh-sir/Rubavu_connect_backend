const authService = require('../services/authService');
const { sendSuccess, sendError } = require('../utils/response');
const { OAuth2Client } = require('google-auth-library');
const { generateActionToken, verifyActionToken } = require('../utils/jwt');

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClient = googleClientId ? new OAuth2Client(googleClientId) : null;

async function verifyGoogleIdToken(idToken) {
  if (!googleClient) {
    const error = new Error('Google account verification is not configured');
    error.statusCode = 503;
    throw error;
  }
  if (typeof idToken !== 'string' || !idToken.trim()) {
    const error = new Error('Google account verification failed');
    error.statusCode = 401;
    throw error;
  }

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: googleClientId,
    });
    payload = ticket.getPayload();
  } catch (error) {
    const invalidCredential = new Error('Google account verification failed');
    invalidCredential.statusCode = 401;
    throw invalidCredential;
  }

  if (!payload?.sub || !payload.email || payload.email_verified !== true) {
    const invalidCredential = new Error('Google account verification failed');
    invalidCredential.statusCode = 401;
    throw invalidCredential;
  }

  return payload;
}

async function verifyGoogleCredential(idToken) {
  const payload = await verifyGoogleIdToken(idToken);
  return { google_id: payload.sub, email: payload.email };
}

async function register(req, res, next) {
  try {
    const { full_name, username, email, phone_number, password } = req.body;
    const result = await authService.registerUser({ full_name, username, email, phone_number, password });

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
    const { identifier, email, password } = req.body;
    const result = await authService.loginUser({ identifier, email, password });

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
    let payload;
    try {
      payload = await verifyGoogleIdToken(req.body.credential);
    } catch (error) {
      if (error.statusCode === 503) {
        return sendError(res, 'Google login is not configured on the server', null, 503);
      }
      return sendError(res, 'Invalid Google token', null, 401);
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

async function changePassword(req, res, next) {
  try {
    const { current_password, new_password, google_credential } = req.body;
    const googleIdentity = google_credential
      ? await verifyGoogleCredential(google_credential)
      : null;

    await authService.changePassword(req.user.id, {
      current_password,
      new_password,
      googleIdentity,
    });

    return sendSuccess(res, 'Password updated successfully');
  } catch (error) {
    next(error);
  }
}

async function verifyAccount(req, res, next) {
  try {
    const { current_password, google_credential } = req.body;
    const googleIdentity = google_credential
      ? await verifyGoogleCredential(google_credential)
      : null;

    await authService.verifyAccountCredentials(req.user.id, {
      current_password,
      googleIdentity,
    });

    return sendSuccess(res, 'Account verified', {
      verification_token: generateActionToken(req.user.id, 'delete-account'),
      expires_in_seconds: 300,
    });
  } catch (error) {
    next(error);
  }
}

async function deleteAccount(req, res, next) {
  try {
    const { username, confirmation, verification_token } = req.body;
    let verification;
    try {
      verification = verifyActionToken(verification_token, 'delete-account');
    } catch (error) {
      return sendError(res, 'Account verification has expired. Verify your account again.', null, 401);
    }
    if (verification.id !== req.user.id) {
      return sendError(res, 'Account verification failed', null, 401);
    }

    await authService.deleteAccount(req.user.id, {
      username,
      confirmation,
    });

    res.clearCookie('token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });
    return sendSuccess(res, 'Account permanently deleted');
  } catch (error) {
    next(error);
  }
}

async function getMe(req, res, next) {
  try {
    const user = await authService.getUserById(req.user.id);
    return sendSuccess(res, 'User retrieved', { user });
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

module.exports = { register, login, googleLogin, changePassword, verifyAccount, deleteAccount, getMe, logout };
