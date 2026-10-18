process.env.JWT_SECRET = 'test-google-auth-secret';

const mockConnectionExecute = jest.fn();
const mockAssertRegistrationOpen = jest.fn();

jest.mock('../config/database', () => ({
  transaction: (callback) => callback({ execute: mockConnectionExecute }),
}));

jest.mock('../services/settingsService', () => ({
  assertRegistrationOpen: mockAssertRegistrationOpen,
}));

const { googleAuth } = require('../services/authService');

const identity = {
  google_id: 'google-sub-123',
  email: 'verified@example.com',
  full_name: 'Verified User',
  profile_image_url: 'https://example.com/profile.png',
};

describe('Google account registration policy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAssertRegistrationOpen.mockResolvedValue();
  });

  test('allows an existing Google account to sign in when registration is disabled', async () => {
    mockAssertRegistrationOpen.mockRejectedValue(new Error('Registration is currently disabled'));
    mockConnectionExecute.mockResolvedValueOnce([[
      {
        id: 7,
        username: 'existing',
        email: identity.email,
        full_name: identity.full_name,
        profile_image_url: identity.profile_image_url,
        role: 'user',
        is_verified: 0,
        is_active: 1,
        google_id: identity.google_id,
      },
    ]]);

    const result = await googleAuth(identity);

    expect(result.user.id).toBe(7);
    expect(mockAssertRegistrationOpen).not.toHaveBeenCalled();
  });

  test('blocks a new Google account when registration is disabled', async () => {
    mockConnectionExecute.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[]]);
    mockAssertRegistrationOpen.mockRejectedValue(new Error('Registration is currently disabled'));

    await expect(googleAuth(identity)).rejects.toThrow('Registration is currently disabled');
    expect(mockConnectionExecute).toHaveBeenCalledTimes(2);
  });

  test('rejects an email already linked to a different Google subject', async () => {
    mockConnectionExecute
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[
        {
          id: 8,
          username: 'linked',
          email: identity.email,
          is_active: 1,
          google_id: 'different-google-sub',
        },
      ]]);

    await expect(googleAuth(identity)).rejects.toMatchObject({
      statusCode: 409,
      message: 'This email is linked to a different Google account',
    });
    expect(mockAssertRegistrationOpen).not.toHaveBeenCalled();
  });
});
