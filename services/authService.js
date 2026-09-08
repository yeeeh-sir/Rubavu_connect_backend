const bcrypt = require('bcryptjs');
const { query, queryOne, transaction } = require('../config/database');
const { generateToken } = require('../utils/jwt');

async function registerUser({ full_name, username, email, password }) {
  return transaction(async (conn) => {
    const existingUser = await conn.execute(
      'SELECT id FROM users WHERE email = ? OR username = ?',
      [email, username]
    );
    if (existingUser[0].length > 0) {
      const err = new Error('User with this email or username already exists');
      err.statusCode = 409;
      throw err;
    }

    const password_hash = await bcrypt.hash(password, 12);

    const [result] = await conn.execute(
      'INSERT INTO users (full_name, username, email, password_hash) VALUES (?, ?, ?, ?)',
      [full_name, username, email, password_hash]
    );

    const user = {
      id: result.insertId,
      username,
      email,
      full_name,
    };

    const token = generateToken(user);

    return { user, token };
  });
}

async function loginUser({ email, password }) {
  const user = await queryOne(
    'SELECT id, username, email, full_name, password_hash, profile_image_url, bio, is_verified, is_active FROM users WHERE email = ?',
    [email]
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

async function googleAuth({ google_id, email, full_name, profile_image_url }) {
  return transaction(async (conn) => {
    let user = await conn.execute(
      'SELECT id, username, email, full_name, profile_image_url, bio, is_verified, is_active, google_id FROM users WHERE google_id = ? OR email = ?',
      [google_id, email]
    );
    user = user[0][0];

    if (user) {
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
    'SELECT id, username, full_name, email, profile_image_url, bio, is_verified, is_active, created_at FROM users WHERE id = ? AND is_active = 1',
    [id]
  );
  return user;
}

module.exports = { registerUser, loginUser, googleAuth, getUserById };
