const expectedClientId = '479719811895-dvbso925iv4j39tijrdlb4uthkbfoo10.apps.googleusercontent.com';

process.env.GOOGLE_CLIENT_ID = expectedClientId;

const mockVerifyIdToken = jest.fn();
const mockGoogleAuth = jest.fn();

jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: mockVerifyIdToken,
  })),
}));

jest.mock('../services/authService', () => ({
  googleAuth: mockGoogleAuth,
}));

const express = require('express');
const request = require('supertest');
const authRoutes = require('../routes/authRoutes');

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);

describe('Google ID token authentication', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('verifies the ID token against the configured web client and uses only verified claims', async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({
        sub: 'google-user-123',
        email: 'verified@example.com',
        email_verified: true,
        name: 'Verified Google User',
        picture: 'https://example.com/profile.png',
      }),
    });
    mockGoogleAuth.mockResolvedValue({
      user: { id: 42, email: 'verified@example.com' },
      token: 'app-token',
    });

    const response = await request(app)
      .post('/api/auth/google')
      .send({
        credential: 'signed-google-id-token',
        email: 'attacker@example.com',
        full_name: 'Untrusted Name',
      });

    expect(mockVerifyIdToken).toHaveBeenCalledWith({
      idToken: 'signed-google-id-token',
      audience: expectedClientId,
    });
    expect(mockGoogleAuth).toHaveBeenCalledWith({
      google_id: 'google-user-123',
      email: 'verified@example.com',
      full_name: 'Verified Google User',
      profile_image_url: 'https://example.com/profile.png',
    });
    expect(response.status).toBe(200);
  });

  test('rejects invalid Google ID tokens without creating or logging in a user', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('invalid token'));

    const response = await request(app)
      .post('/api/auth/google')
      .send({ credential: 'invalid-token' });

    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Invalid Google token');
    expect(mockGoogleAuth).not.toHaveBeenCalled();
  });

  test.each([
    ['wrong audience', new Error('Wrong recipient, payload audience != required'), 'audience_mismatch'],
    ['expired token', new Error('Token used too late, expired'), 'token_expired_or_not_yet_valid'],
    ['malformed token', new Error('Wrong number of segments in token'), 'malformed_token'],
  ])('logs a safe category for %s without logging the token', async (_caseName, verificationError, category) => {
    const token = 'synthetic-google-token-never-log';
    mockVerifyIdToken.mockRejectedValue(verificationError);
    const verificationLog = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const response = await request(app)
        .post('/api/auth/google')
        .send({ credential: token });

      expect(response.status).toBe(401);
      expect(response.body.message).toBe('Invalid Google token');
      expect(mockVerifyIdToken).toHaveBeenCalledWith({
        idToken: token,
        audience: expectedClientId,
      });
      expect(verificationLog).toHaveBeenCalledWith(
        'Google ID token verification failed:',
        category
      );
      expect(JSON.stringify(verificationLog.mock.calls)).not.toContain(token);
      expect(mockGoogleAuth).not.toHaveBeenCalled();
    } finally {
      verificationLog.mockRestore();
    }
  });

  test('reports verifier network failures as temporary service errors', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('request timed out fetching certificates'));
    const verificationLog = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const response = await request(app)
        .post('/api/auth/google')
        .send({ credential: 'synthetic-google-token' });

      expect(response.status).toBe(503);
      expect(response.body.message).toBe('Google account verification is temporarily unavailable');
      expect(verificationLog).toHaveBeenCalledWith(
        'Google ID token verification failed:',
        'verifier_unavailable'
      );
      expect(mockGoogleAuth).not.toHaveBeenCalled();
    } finally {
      verificationLog.mockRestore();
    }
  });

  test('rejects non-string credentials', async () => {
    const response = await request(app)
      .post('/api/auth/google')
      .send({ credential: { access_token: 'not-an-id-token' } });

    expect(response.status).toBe(400);
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
    expect(mockGoogleAuth).not.toHaveBeenCalled();
  });

  test('reports invalid server client configuration without revealing its value', async () => {
    const previousClientId = process.env.GOOGLE_CLIENT_ID;
    process.env.GOOGLE_CLIENT_ID = 'invalid-google-client-id';

    try {
      jest.resetModules();
      const { googleLogin } = require('../controllers/authController');
      const unconfiguredApp = express();
      unconfiguredApp.use(express.json());
      unconfiguredApp.post('/api/auth/google', googleLogin);

      const response = await request(unconfiguredApp)
        .post('/api/auth/google')
        .send({ credential: 'fake-id-token' });

      expect(response.status).toBe(503);
      expect(response.body.message).toBe('Google login is not configured on the server');
      expect(JSON.stringify(response.body)).not.toContain('invalid-google-client-id');
      expect(mockGoogleAuth).not.toHaveBeenCalled();
    } finally {
      process.env.GOOGLE_CLIENT_ID = previousClientId;
      jest.resetModules();
    }
  });
});
