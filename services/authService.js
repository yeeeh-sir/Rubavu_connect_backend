const bcrypt = require('bcryptjs');
const { query, queryOne, transaction } = require('../config/database');
const { generateToken } = require('../utils/jwt');
const { normalizePhoneNumber } = require('../utils/phoneNumber');
const { assertRegistrationOpen } = require('./settingsService');

async function registerUser({ full_name, username, email, phone_number, password }) {
  await assertRegistrationOpen();
  return transaction(async (conn) => {
    const normalizedPhone = normalizePhoneNumber(phone_number);
    const existingUser = await conn.execute(
      'SELECT id FROM users WHERE email = ? OR username = ? OR (? IS NOT NULL AND phone_number = ?)',
      [email, username, normalizedPhone, normalizedPhone]
    );
    if (existingUser[0].length > 0) {
      const err = new Error('An account with this email, username, or phone number already exists');
      err.statusCode = 409;
      throw err;
    }

    const password_hash = await bcrypt.hash(password, 12);

    const [result] = await conn.execute(
      'INSERT INTO users (full_name, username, email, phone_number, password_hash) VALUES (?, ?, ?, ?, ?)',
      [full_name, username, email, normalizedPhone, password_hash]
    );

    const user = {
      id: result.insertId,
      username,
      email,
      phone_number: normalizedPhone,
      full_name,
      role: 'user',
    };

    const token = generateToken(user);

    return { user, token };
  });
}

async function loginUser({ identifier, email, password }) {
  const loginIdentifier = String(identifier || email || '').trim();
  const phoneNumber = normalizePhoneNumber(loginIdentifier);
  const user = await queryOne(
    `SELECT id, username, email, phone_number, full_name, password_hash, profile_image_url, bio, role, is_verified, is_active
     FROM users
     WHERE email = ? OR username = ? OR (? IS NOT NULL AND phone_number = ?)
     LIMIT 1`,
    [loginIdentifier, loginIdentifier, phoneNumber, phoneNumber]
  );

  if (!user) {
    const err = new Error('Invalid email or password');
    err.statusCode = 401;
    throw err;
  }

  if (!user.is_active) {
    const err = new Error('Account has been deactivated');
    err.statusCode = 403;
    throw err;
  }

  const isMatch = await bcrypt.compare(password, user.password_hash);
  if (!isMatch) {
    const err = new Error('Invalid email or password');
    err.statusCode = 401;
    throw err;
  }

  const token = generateToken(user);

  const { password_hash, ...userWithoutPassword } = user;
  return { user: userWithoutPassword, token };
}

async function verifyAccountOwnership(user, { current_password, googleIdentity }) {
  if (current_password) {
    return bcrypt.compare(current_password, user.password_hash);
  }

  return Boolean(
    googleIdentity &&
    user.google_id &&
    googleIdentity.google_id === user.google_id &&
    googleIdentity.email.toLowerCase() === user.email.toLowerCase()
  );
}

async function verifyAccountCredentials(userId, credentials) {
  const user = await queryOne(
    'SELECT id, email, password_hash, google_id FROM users WHERE id = ? AND is_active = 1',
    [userId]
  );
  if (!user) {
    const error = new Error('User not found');
    error.statusCode = 404;
    throw error;
  }

  if (!await verifyAccountOwnership(user, credentials)) {
    const error = new Error('Account verification failed');
    error.statusCode = 401;
    throw error;
  }
}

async function changePassword(userId, { current_password, new_password, googleIdentity }) {
  return transaction(async (conn) => {
    const [rows] = await conn.execute(
      'SELECT id, email, password_hash, google_id FROM users WHERE id = ? AND is_active = 1 FOR UPDATE',
      [userId]
    );
    const user = rows[0];
    if (!user) {
      const error = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }

    const verified = await verifyAccountOwnership(user, { current_password, googleIdentity });
    if (!verified) {
      const error = new Error('Account verification failed');
      error.statusCode = 401;
      throw error;
    }

    const passwordHash = await bcrypt.hash(new_password, 12);
    await conn.execute('UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?', [
      passwordHash,
      userId,
    ]);
  });
}

async function deleteAccount(userId, { username, confirmation }) {
  return transaction(async (conn) => {
    const [rows] = await conn.execute(
      'SELECT id, username FROM users WHERE id = ? AND is_active = 1 FOR UPDATE',
      [userId]
    );
    const user = rows[0];
    if (!user) {
      const error = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }

    if (confirmation !== 'DELETE MY ACCOUNT' || username !== user.username) {
      const error = new Error('Account deletion confirmation did not match');
      error.statusCode = 400;
      throw error;
    }

    const [result] = await conn.execute('DELETE FROM users WHERE id = ?', [userId]);
    if (result.affectedRows !== 1) {
      const error = new Error('Account could not be deleted');
      error.statusCode = 409;
      throw error;
    }
  });
}

async function googleAuth({ google_id, email, full_name, profile_image_url }) {
  return transaction(async (conn) => {
    const userColumns = 'id, username, email, full_name, profile_image_url, bio, role, is_verified, is_active, google_id';
    const [googleUsers] = await conn.execute(
      `SELECT ${userColumns} FROM users WHERE google_id = ? LIMIT 1 FOR UPDATE`,
      [google_id]
    );
    let user = googleUsers[0];

    if (!user) {
      const [emailUsers] = await conn.execute(
        `SELECT ${userColumns} FROM users WHERE email = ? LIMIT 1 FOR UPDATE`,
        [email]
      );
      user = emailUsers[0];

      if (user?.google_id && String(user.google_id) !== String(google_id)) {
        const error = new Error('This email is linked to a different Google account');
        error.statusCode = 409;
        throw error;
      }
    }

    if (user) {
      if (Number(user.is_active) !== 1) {
        const error = new Error('Account has been deactivated');
        error.statusCode = 403;
        throw error;
      }
      if (!user.google_id) {
        await conn.execute('UPDATE users SET google_id = ? WHERE id = ?', [
          google_id,
          user.id,
        ]);
      }
      if (profile_image_url && !user.profile_image_url) {
        await conn.execute('UPDATE users SET profile_image_url = ? WHERE id = ?', [
          profile_image_url,
          user.id,
        ]);
      }
    } else {
      await assertRegistrationOpen();
      let username = email.split('@')[0];
      const existing = await conn.execute(
        'SELECT id FROM users WHERE username = ?',
        [username]
      );
      if (existing[0].length > 0) {
        username = username + '_' + Date.now().toString(36);
      }

      const [result] = await conn.execute(
        'INSERT INTO users (full_name, username, email, google_id, profile_image_url, password_hash) VALUES (?, ?, ?, ?, ?, ?)',
        [
          full_name,
          username,
          email,
          google_id,
          profile_image_url || null,
          await bcrypt.hash(require('uuid').v4(), 12),
        ]
      );

      user = {
        id: result.insertId,
        username,
        email,
        full_name,
        profile_image_url: profile_image_url || null,
        bio: null,
        role: 'user',
        is_verified: 0,
        is_active: 1,
      };

      const token = generateToken(user);
      return { user, token };
    }

    const token = generateToken(user);
    const { password_hash, google_id: gid, ...userWithoutPassword } = user;
    return { user: userWithoutPassword, token };
  });
}

async function getUserById(id) {
  const user = await queryOne(
    'SELECT id, username, full_name, email, phone_number, profile_image_url, bio, role, is_verified, is_active, created_at FROM users WHERE id = ? AND is_active = 1',
    [id]
  );
  return user;
}

module.exports = {
  registerUser,
  loginUser,
  verifyAccountCredentials,
  changePassword,
  deleteAccount,
  googleAuth,
  getUserById,
};
