const request = require('supertest');
const app = require('../server');

describe('Rubavu Connect API Tests', () => {
  let authToken = '';
  let userId = '';
  let postId = '';
  const testUser = {
    full_name: 'Test User',
    username: 'testuser' + Date.now(),
    email: 'test' + Date.now() + '@example.com',
    password: 'password123',
  };

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
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.token).toBeDefined();
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
      expect(res.statusCode).toBe(200);
      expect(res.body.data.user).toHaveProperty('email');
    });

    test('Password should never be exposed', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${authToken}`);
      expect(res.body.data.user).not.toHaveProperty('password_hash');
      expect(res.body.data.user).not.toHaveProperty('password');
    });
  });

  describe('Posts', () => {
    test('POST /api/posts without file should fail', async () => {
      const res = await request(app)
        .post('/api/posts')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ caption: 'Test post' });
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
      expect(res.statusCode).toBe(400);
    });
  });
});
