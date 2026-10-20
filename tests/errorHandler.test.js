const express = require('express');
const request = require('supertest');
const errorHandler = require('../middleware/errorHandler');

function createApp(error) {
  const app = express();
  app.get('/test', (req, res, next) => next(error));
  app.use(errorHandler);
  return app;
}

describe('errorHandler', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    jest.restoreAllMocks();
  });

  test('returns a safe invalid-credentials message in production', async () => {
    process.env.NODE_ENV = 'production';
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const error = new Error('Invalid email or password');
    error.statusCode = 401;

    const response = await request(createApp(error)).get('/test');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      message: 'Invalid email or password',
    });
  });

  test('returns a safe deactivated-account message in production', async () => {
    process.env.NODE_ENV = 'production';
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const error = new Error('Account has been deactivated');
    error.statusCode = 403;

    const response = await request(createApp(error)).get('/test');

    expect(response.status).toBe(403);
    expect(response.body.message).toBe('Account has been deactivated');
  });

  test('keeps unexpected server errors generic and redacts secrets from diagnostics', async () => {
    process.env.NODE_ENV = 'production';
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error(
      'Database error password=hunter2 token=abc123 Authorization: Bearer jwt-value'
    );
    error.code = 'ER_TEST_FAILURE';

    const response = await request(createApp(error)).get('/test?token=query-value');

    expect(response.status).toBe(500);
    expect(response.body.message).toBe('Internal server error');
    const loggedDetails = JSON.stringify(log.mock.calls);
    expect(loggedDetails).toContain('ER_TEST_FAILURE');
    expect(loggedDetails).toContain('/test');
    for (const secret of ['hunter2', 'abc123', 'jwt-value', 'query-value']) {
      expect(loggedDetails).not.toContain(secret);
    }
  });
});
