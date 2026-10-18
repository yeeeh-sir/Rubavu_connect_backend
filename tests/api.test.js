const request = require('supertest');
const app = require('../server');
const { isRegistrationEnabled } = require('../services/settingsService');

describe('Rubavu Connect API Tests', () => {
  let authToken = '';
  let userId = '';
  let postId = '';
  let registrationEnabled;
  const testUser = {
    full_name: 'Test User',
    username: 'testuser' + Date.now(),
    email: 'test' + Date.now() + '@example.com',
    phone_number: '+250 7' + Date.now().toString().slice(-8),
    password: 'password123',
  };

  beforeAll(async () => {
    registrationEnabled = await isRegistrationEnabled();
  });

  describe('Health Check', () => {
    test('GET /api/health should return 200 with success message', async () => {
      const res = await request(app).get('/api/health');
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Rubavu Connect API is running');
    });
  });

  describe('Authentication', () => {
    test('POST /api/auth/register should register a new user', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send(testUser);
      if (!registrationEnabled) {
        expect(res.statusCode).toBe(403);
        expect(res.body.message).toBe('Registration is currently disabled');
        return;
      }
      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user).toHaveProperty('id');
      expect(res.body.data.token).toBeDefined();
      authToken = res.body.data.token;
      userId = res.body.data.user.id;
    });

    test('POST /api/auth/register with duplicate email should fail', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send(testUser);
      if (!registrationEnabled) {
        expect(res.statusCode).toBe(403);
        expect(res.body.message).toBe('Registration is currently disabled');
        return;
      }
      expect(res.statusCode).toBe(409);
      expect(res.body.success).toBe(false);
    });

    test('POST /api/auth/register with short password should fail', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          full_name: 'Test',
          username: 'shortpass' + Date.now(),
          email: 'sp' + Date.now() + '@example.com',
          password: '123',
        });
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('POST /api/auth/login should login existing user', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: testUser.email, password: testUser.password });
      if (!registrationEnabled) {
        expect(res.statusCode).toBe(401);
        return;
      }
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.token).toBeDefined();
    });

    test('POST /api/auth/login should accept username', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ identifier: testUser.username, password: testUser.password });
      if (!registrationEnabled) {
        expect(res.statusCode).toBe(401);
        return;
      }
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.username).toBe(testUser.username);
    });

    test('POST /api/auth/login should accept phone number', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ identifier: testUser.phone_number, password: testUser.password });
      if (!registrationEnabled) {
        expect(res.statusCode).toBe(401);
        return;
      }
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.phone_number).toBe(testUser.phone_number.replace(/\s/g, ''));
    });

    test('POST /api/auth/login with wrong password should fail', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: testUser.email, password: 'wrongpassword' });
      expect(res.statusCode).toBe(401);
      expect(res.body.success).toBe(false);
    });

    test('GET /api/auth/me without token should return 401', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.statusCode).toBe(401);
    });

    test('GET /api/auth/me with token should return user', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${authToken}`);
      if (!registrationEnabled) {
        expect(res.statusCode).toBe(401);
        return;
      }
      expect(res.statusCode).toBe(200);
      expect(res.body.data.user).toHaveProperty('email');
    });

    test('Password should never be exposed', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${authToken}`);
      if (!registrationEnabled) {
        expect(res.statusCode).toBe(401);
        expect(res.body.data).toBeUndefined();
        return;
      }
      expect(res.statusCode).toBe(200);
      expect(res.body.data.user).not.toHaveProperty('password_hash');
      expect(res.body.data.user).not.toHaveProperty('password');
    });

    test('Account security requires fresh verification and explicit deletion confirmation', async () => {
      const suffix = Date.now().toString();
      const account = {
        full_name: 'Temporary Security Test',
        username: `security${suffix}`,
        email: `security${suffix}@example.com`,
        password: 'initial-password123',
      };
      const registration = await request(app).post('/api/auth/register').send(account);
      if (!registrationEnabled) {
        expect(registration.statusCode).toBe(403);
        expect(registration.body.message).toBe('Registration is currently disabled');
        return;
      }
      expect(registration.statusCode).toBe(201);
      const token = registration.body.data.token;
      const authorization = `Bearer ${token}`;

      const rejectedProof = await request(app)
        .post('/api/auth/verify-account')
        .set('Authorization', authorization)
        .send({ current_password: 'not-the-password' });
      expect(rejectedProof.statusCode).toBe(401);

      const verification = await request(app)
        .post('/api/auth/verify-account')
        .set('Authorization', authorization)
        .send({ current_password: account.password });
      expect(verification.statusCode).toBe(200);
      const verificationToken = verification.body.data.verification_token;
      expect(verificationToken).toBeDefined();

      const passwordChange = await request(app)
        .post('/api/auth/change-password')
        .set('Authorization', authorization)
        .send({ current_password: account.password, new_password: 'updated-password123' });
      expect(passwordChange.statusCode).toBe(200);

      const invalidToken = await request(app)
        .post('/api/auth/delete-account')
        .set('Authorization', authorization)
        .send({
          verification_token: 'invalid',
          username: account.username,
          confirmation: 'DELETE MY ACCOUNT',
        });
      expect(invalidToken.statusCode).toBe(401);

      const invalidConfirmation = await request(app)
        .post('/api/auth/delete-account')
        .set('Authorization', authorization)
        .send({
          verification_token: verificationToken,
          username: account.username,
          confirmation: 'DELETE',
        });
      expect(invalidConfirmation.statusCode).toBe(400);

      const deletion = await request(app)
        .post('/api/auth/delete-account')
        .set('Authorization', authorization)
        .send({
          verification_token: verificationToken,
          username: account.username,
          confirmation: 'DELETE MY ACCOUNT',
        });
      expect(deletion.statusCode).toBe(200);
      expect(deletion.body.message).toBe('Account permanently deleted');
    });
  });

  describe('Posts', () => {
    test('POST /api/posts without file should fail', async () => {
      const res = await request(app)
        .post('/api/posts')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ caption: 'Test post' });
      if (!registrationEnabled) {
        expect(res.statusCode).toBe(401);
        return;
      }
      expect(res.statusCode).toBe(400);
    });

    test('GET /api/posts should return empty or list', async () => {
      const res = await request(app)
        .get('/api/posts')
        .set('Authorization', `Bearer ${authToken}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('posts');
      expect(res.body.data).toHaveProperty('pagination');
    });

    test('GET /api/posts/:id non-existent should return 404', async () => {
      const res = await request(app)
        .get('/api/posts/999999')
        .set('Authorization', `Bearer ${authToken}`);
      expect(res.statusCode).toBe(404);
    });
  });

  describe('Protected Routes', () => {
    test('GET /api/status without token should return active statuses', async () => {
      const res = await request(app).get('/api/status');
      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveProperty('statuses');
    });

    test('GET /api/messages/conversations without token should return 401', async () => {
      const res = await request(app).get('/api/messages/conversations');
      expect(res.statusCode).toBe(401);
    });

    test('POST /api/status without file should fail with 400', async () => {
      const res = await request(app)
        .post('/api/status')
        .set('Authorization', `Bearer ${authToken}`);
      if (!registrationEnabled) {
        expect(res.statusCode).toBe(401);
        return;
      }
      expect(res.statusCode).toBe(400);
    });
  });

  describe('Invalid Uploads', () => {
    test('POST /api/posts with invalid file type should fail', async () => {
      const fakeFile = Buffer.from('This is not a real image');
      const res = await request(app)
        .post('/api/posts')
        .set('Authorization', `Bearer ${authToken}`)
        .field('caption', 'test')
        .attach('media', fakeFile, {
          filename: 'file.txt',
          contentType: 'text/plain',
        });
      if (!registrationEnabled) {
        expect(res.statusCode).toBe(401);
        return;
      }
      expect(res.statusCode).toBe(400);
    });

    test('POST /api/users/profile-image with invalid file should fail', async () => {
      const fakeFile = Buffer.from('not an image');
      const res = await request(app)
        .post('/api/users/profile-image')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('profile_image', fakeFile, {
          filename: 'bad.bin',
          contentType: 'application/octet-stream',
        });
      if (!registrationEnabled) {
        expect(res.statusCode).toBe(401);
        return;
      }
      expect(res.statusCode).toBe(400);
    });
  });
});
