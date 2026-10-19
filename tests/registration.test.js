const mockRegisterUser = jest.fn();

jest.mock('../services/authService', () => ({
  registerUser: mockRegisterUser,
}));

const express = require('express');
const request = require('supertest');
const authRoutes = require('../routes/authRoutes');
const errorHandler = require('../middleware/errorHandler');

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use(errorHandler);

const validPayload = {
  full_name: 'Aline Uwase',
  username: 'aline.uwase',
  email: 'aline@example.com',
  phone_number: '+250788123456',
  password: 'strongpassword123',
};

describe('POST /api/auth/register', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('registers a new user with valid data', async () => {
    mockRegisterUser.mockResolvedValue({
      user: { id: 7, username: 'aline.uwase', email: 'aline@example.com', role: 'user' },
      token: 'signed.jwt.token',
    });

    const response = await request(app).post('/api/auth/register').send(validPayload);

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe('Registration successful');
    expect(response.body.data.token).toBe('signed.jwt.token');
    expect(response.body.data.user).toMatchObject({ id: 7, email: 'aline@example.com' });
    expect(response.headers['set-cookie'].join(';')).toContain('token=');
    expect(mockRegisterUser).toHaveBeenCalledWith({
      full_name: 'Aline Uwase',
      username: 'aline.uwase',
      email: 'aline@example.com',
      phone_number: '+250788123456',
      password: 'strongpassword123',
    });
    expect(JSON.stringify(response.body)).not.toContain('strongpassword123');
  });

  test('allows registration without an optional phone number', async () => {
    mockRegisterUser.mockResolvedValue({
      user: { id: 8, username: 'no.phone', email: 'nophone@example.com' },
      token: 'token',
    });

    const { phone_number, ...withoutPhone } = validPayload;
    const response = await request(app).post('/api/auth/register').send(withoutPhone);

    expect(response.status).toBe(201);
    expect(mockRegisterUser).toHaveBeenCalledWith(
      expect.objectContaining({ phone_number: undefined })
    );
  });

  test('rejects a short password with a field-level message', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ ...validPayload, password: 'short' });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Validation failed');
    expect(response.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'password' })])
    );
    expect(mockRegisterUser).not.toHaveBeenCalled();
  });

  test('rejects an invalid email', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ ...validPayload, email: 'not-an-email' });

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'email' })])
    );
    expect(mockRegisterUser).not.toHaveBeenCalled();
  });

  test('rejects an invalid username', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ ...validPayload, username: 'bad name!' });

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'username' })])
    );
    expect(mockRegisterUser).not.toHaveBeenCalled();
  });

  test('rejects a missing full name', async () => {
    const { full_name, ...withoutName } = validPayload;
    const response = await request(app).post('/api/auth/register').send(withoutName);

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'full_name' })])
    );
    expect(mockRegisterUser).not.toHaveBeenCalled();
  });

  test('returns a safe duplicate message when the account already exists', async () => {
    const duplicateError = new Error(
      'An account with this email, username, or phone number already exists'
    );
    duplicateError.statusCode = 409;
    mockRegisterUser.mockRejectedValue(duplicateError);

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const response = await request(app).post('/api/auth/register').send(validPayload);
    consoleSpy.mockRestore();

    expect(response.status).toBe(409);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe(
      'An account with this email, username, or phone number already exists'
    );
  });
});
