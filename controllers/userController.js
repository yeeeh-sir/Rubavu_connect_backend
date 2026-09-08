const { query, queryOne } = require('../config/database');
const { sendSuccess, sendError } = require('../utils/response');
const cloudinaryService = require('../services/cloudinaryService');
const { isOnline } = require('../utils/presence');

async function getProfile(req, res, next) {
  try {
    const { username } = req.params;
    const currentUser = req.user;

    const user = await queryOne(
      `SELECT id, username, full_name, bio, interests, profile_image_url, is_verified, created_at,
        who_can_message, who_can_connect, show_online, last_active_at
       FROM users WHERE username = ? AND is_active = 1`,
      [username]
    );

    if (!user) {
      return sendError(res, 'User not found', null, 404);
    }

    const followerCountRows = await query(
      'SELECT COUNT(*) as count FROM follows WHERE following_id = ?',
      [user.id]
    );
    const followingCountRows = await query(
      'SELECT COUNT(*) as count FROM follows WHERE follower_id = ?',
      [user.id]
    );
    const postCountRows = await query(
      `SELECT COUNT(*) as count FROM posts
       WHERE (user_id = ? OR EXISTS (
         SELECT 1 FROM post_collaborators pc
         WHERE pc.post_id = posts.id AND pc.user_id = ? AND pc.status = 'accepted'
       ))`,
      [user.id, user.id]
    );

    let isFollowing = false;
    let isConnected = false;
    if (currentUser) {
      const followCheck = await query(
        'SELECT id FROM follows WHERE follower_id = ? AND following_id = ?',
        [currentUser.id, user.id]
      );
      isFollowing = followCheck.length > 0;

      if (currentUser.id !== user.id) {
        const connectionCheck = await query(
          `SELECT id FROM connections WHERE status = 'accepted'
           AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))`,
          [currentUser.id, user.id, user.id, currentUser.id]
        );
        isConnected = connectionCheck.length > 0;
      }
    }

    let interests = null;
    if (user.interests && currentUser) {
      try { interests = JSON.parse(user.interests); } catch (_) { interests = user.interests.split(','); }
    }

    return sendSuccess(res, 'Profile retrieved', {
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        bio: user.bio,
        interests,
        profile_image_url: user.profile_image_url,
        is_verified: !!user.is_verified,
        created_at: user.created_at,
        follower_count: followerCountRows[0]?.count || 0,
        following_count: followingCountRows[0]?.count || 0,
        post_count: postCountRows[0]?.count || 0,
        is_following: isFollowing,
        is_connected: isConnected,
        is_online: isOnline(user),
      },
    });
  } catch (error) {
    next(error);
  }
}

async function updateProfile(req, res, next) {
  try {
    const { full_name, bio, interests } = req.body;
    const userId = req.user.id;

    const updates = [];
    const params = [];

    if (full_name !== undefined) {
      updates.push('full_name = ?');
      params.push(full_name);
    }
    if (bio !== undefined) {
      updates.push('bio = ?');
      params.push(bio);
    }
    if (interests !== undefined) {
      let interestsValue = null;
      if (Array.isArray(interests)) {
        interestsValue = JSON.stringify(interests.map((i) => String(i).trim()).filter(Boolean).slice(0, 10));
      } else if (typeof interests === 'string') {
        interestsValue = JSON.stringify(interests.split(',').map((i) => i.trim()).filter(Boolean).slice(0, 10));
      }
      updates.push('interests = ?');
      params.push(interestsValue);
    }

    if (updates.length === 0) {
      return sendError(res, 'No fields to update', null, 400);
    }

    updates.push('updated_at = NOW()');
    params.push(userId);

    await query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    const user = await queryOne(
      'SELECT id, username, full_name, email, bio, interests, profile_image_url, is_verified, created_at, updated_at FROM users WHERE id = ?',
      [userId]
    );

    let parsedInterests = null;
    if (user.interests) {
      try { parsedInterests = JSON.parse(user.interests); } catch (_) { parsedInterests = user.interests.split(','); }
    }

    return sendSuccess(res, 'Profile updated', { user: { ...user, interests: parsedInterests } });
  } catch (error) {
    next(error);
  }
}

async function uploadProfileImage(req, res, next) {
  try {
    if (!req.file) {
      return sendError(res, 'No image file provided', null, 400);
    }

    const result = await cloudinaryService.uploadProfileImage(req.file.buffer);

    await query(
      'UPDATE users SET profile_image_url = ?, updated_at = NOW() WHERE id = ?',
      [result.url, req.user.id]
    );

    const user = await queryOne(
      'SELECT id, username, full_name, bio, profile_image_url FROM users WHERE id = ?',
      [req.user.id]
    );

    return sendSuccess(res, 'Profile image updated', { user });
  } catch (error) {
    next(error);
  }
}

async function searchUsers(req, res, next) {
  try {
    const { q } = req.query;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const offset = (page - 1) * limit;

    const searchTerm = `%${q}%`;

    const countRows = await query(
      'SELECT COUNT(*) as total FROM users WHERE (username LIKE ? OR full_name LIKE ? OR bio LIKE ? OR interests LIKE ?) AND is_active = 1',
      [searchTerm, searchTerm, searchTerm, searchTerm]
    );
    const total = countRows[0]?.total || 0;

    const users = await query(
      `SELECT id, username, full_name, profile_image_url, bio, interests, is_verified, last_active_at, show_online
       FROM users
       WHERE (username LIKE ? OR full_name LIKE ? OR bio LIKE ? OR interests LIKE ?) AND is_active = 1
       ORDER BY (username = ?) DESC, username ASC
       LIMIT ? OFFSET ?`,
      [searchTerm, searchTerm, searchTerm, searchTerm, q, String(limit), String(offset)]
    );

    const formattedUsers = users.map((u) => ({
      id: u.id,
      username: u.username,
      full_name: u.full_name,
      profile_image_url: u.profile_image_url,
      bio: u.bio,
      is_verified: !!u.is_verified,
      is_online: isOnline(u),
      interests: (() => {
        if (!u.interests) return [];
        try { return JSON.parse(u.interests); } catch (_) { return String(u.interests).split(','); }
      })(),
    }));

    return sendSuccess(res, 'Users found', {
      users: formattedUsers,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { getProfile, updateProfile, uploadProfileImage, searchUsers };