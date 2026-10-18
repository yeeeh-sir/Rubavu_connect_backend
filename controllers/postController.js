const { query, queryOne, execute, transaction } = require('../config/database');
const { sendSuccess, sendError } = require('../utils/response');
const cloudinaryService = require('../services/cloudinaryService');
const { MAX_VIDEO_DURATION } = require('../utils/video');
const { isOnline } = require('../utils/presence');

async function createPost(req, res, next) {
  try {
    const files = req.files && req.files.length ? req.files : (req.file ? [req.file] : []);
    if (!files.length) {
      return sendError(res, 'At least one media file is required', null, 400);
    }
    if (files.length > 10) {
      return sendError(res, 'A post can have up to 10 media files', null, 400);
    }

    const { caption } = req.body;
    const audience = ['public', 'friends', 'private'].includes(req.body.audience)
      ? req.body.audience
      : 'public';
    let collaboratorIds = [];
    try {
      collaboratorIds = req.body.collaborator_ids
        ? JSON.parse(req.body.collaborator_ids)
        : [];
    } catch (_) {
      return sendError(res, 'Invalid collaborators', null, 400);
    }
    if (!Array.isArray(collaboratorIds) || collaboratorIds.length > 10) {
      return sendError(res, 'A post can have up to 10 collaborators', null, 400);
    }
    collaboratorIds = [...new Set(collaboratorIds.map((id) => Number.parseInt(id, 10)))];
    if (collaboratorIds.some((id) => !Number.isInteger(id) || id < 1)) {
      return sendError(res, 'Invalid collaborator list', null, 400);
    }
    if (collaboratorIds.includes(req.user.id)) {
      return sendError(res, 'You cannot add yourself as a collaborator', null, 400);
    }
    const userId = req.user.id;

    const mediaRecords = [];
    for (const file of files) {
      const mimetype = file.mimetype;
      if (mimetype.startsWith('image/')) {
        const result = await cloudinaryService.uploadImage(file.buffer);
        mediaRecords.push({
          media_type: 'image',
          media_url: result.url,
          thumbnail_url: null,
          video_duration: null,
        });
      } else if (mimetype.startsWith('video/')) {
        const { validateVideoDuration } = require('../utils/videoUtils');
        const duration = await validateVideoDuration(
          file.buffer,
          file.originalname || 'video.mp4'
        );
        const result = await cloudinaryService.uploadVideo(file.buffer);
        mediaRecords.push({
          media_type: 'video',
          media_url: result.url,
          thumbnail_url: null,
          video_duration: duration,
        });
      } else {
        return sendError(res, 'Invalid media type. Only images and videos are allowed.', null, 400);
      }
    }

    const users = collaboratorIds.length
      ? await query(`SELECT id FROM users WHERE is_active = 1 AND id IN (${collaboratorIds.map(() => '?').join(',')})`, collaboratorIds)
      : [];
    if (users.length !== collaboratorIds.length) {
      return sendError(res, 'One or more collaborators were not found', null, 400);
    }

    const mediaType = mediaRecords.some((m) => m.media_type === 'video') ? 'video' : 'image';
    const primaryMedia = mediaRecords[0];

    const dbResult = await execute(
      'INSERT INTO posts (user_id, caption, media_type, media_url, thumbnail_url, video_duration, audience) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, caption || null, mediaType, primaryMedia.media_url, primaryMedia.thumbnail_url, primaryMedia.video_duration, audience]
    );

    const postId = dbResult.insertId;

    for (let i = 0; i < mediaRecords.length; i++) {
      const m = mediaRecords[i];
      await execute(
        'INSERT INTO post_media (post_id, media_type, media_url, thumbnail_url, video_duration, position) VALUES (?, ?, ?, ?, ?, ?)',
        [postId, m.media_type, m.media_url, m.thumbnail_url, m.video_duration, i]
      );
    }

    if (collaboratorIds.length) {
      await execute(
        `INSERT INTO post_collaborators (post_id, user_id, status) VALUES ${collaboratorIds.map(() => '(?, ?, \'pending\')').join(', ')}`,
        collaboratorIds.flatMap((collaboratorId) => [postId, collaboratorId])
      );

      for (const collaboratorId of collaboratorIds) {
        await execute(
          `INSERT INTO notifications (user_id, from_user_id, type, post_id)
           VALUES (?, ?, 'collaboration_invite', ?)`,
          [collaboratorId, userId, postId]
        );
      }
    }

    const post = await getPostEntity(postId, userId);

    return sendSuccess(res, 'Post created', { post }, 201);
  } catch (error) {
    next(error);
  }
}

async function getPostEntity(postId, userId) {
  const rows = await query(
    `SELECT p.*,
      u.username, u.full_name, u.profile_image_url, u.last_active_at, u.show_online,
      (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) as likes_count,
      (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comments_count,
      ${userId ? '(SELECT COUNT(*) FROM post_likes WHERE post_id = p.id AND user_id = ?) as is_liked' : '0 as is_liked'}
     FROM posts p
     JOIN users u ON p.user_id = u.id
     WHERE p.id = ?`,
    userId ? [String(userId), String(postId)] : [String(postId)]
  );
  if (!rows.length) return null;
  const p = rows[0];

  const mediaRows = await query(
    'SELECT id, media_type, media_url, thumbnail_url, video_duration, position FROM post_media WHERE post_id = ? ORDER BY position ASC',
    [postId]
  );
  const media = mediaRows.length
    ? mediaRows
    : mediaRows.concat(
        p.media_url
          ? [{ media_type: p.media_type, media_url: p.media_url, thumbnail_url: p.thumbnail_url, video_duration: p.video_duration }]
          : []
      );

  const collabRows = await query(
    `SELECT pc.user_id, pc.status, u.username, u.full_name, u.profile_image_url
     FROM post_collaborators pc
     JOIN users u ON pc.user_id = u.id
     WHERE pc.post_id = ?`,
    [postId]
  );
  const collaborators = collabRows
    .filter((c) => c.status === 'accepted')
    .map((c) => ({ id: c.user_id, username: c.username, full_name: c.full_name, profile_image_url: c.profile_image_url }));

  return {
    id: p.id,
    user: {
      id: p.user_id,
      username: p.username,
      full_name: p.full_name,
      profile_image_url: p.profile_image_url,
      is_online: isOnline(p),
    },
    caption: p.caption,
    audience: p.audience,
    media_type: p.media_type,
    media_url: p.media_url,
    media,
    collaborators,
    collaborator_pending_count: collabRows.filter((c) => c.status === 'pending').length,
    collaborator_invited: userId ? collabRows.some((c) => c.user_id === userId && c.status === 'pending') : false,
    thumbnail_url: p.thumbnail_url,
    video_duration: p.video_duration,
    likes_count: p.likes_count,
    comments_count: p.comments_count,
    is_liked: p.is_liked > 0,
    created_at: p.created_at,
  };
}

async function getPosts(req, res, next) {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const offset = (page - 1) * limit;
    const userId = req.user ? req.user.id : null;

    const countRows = await query('SELECT COUNT(*) as total FROM posts WHERE is_hidden = 0', []);
    const total = countRows[0]?.total || 0;

    const posts = await query(
      `SELECT p.*,
        u.username, u.full_name, u.profile_image_url, u.last_active_at, u.show_online,
        (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) as likes_count,
        (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comments_count
        ${userId ? ', (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id AND user_id = ?) as is_liked' : ', 0 as is_liked'}
       FROM posts p
       JOIN users u ON p.user_id = u.id AND u.is_active = 1
        WHERE p.is_hidden = 0
          AND (p.audience = 'public'
          OR p.user_id = ?
          OR (p.audience = 'friends' AND EXISTS (
            SELECT 1 FROM connections c
            WHERE c.status = 'accepted'
              AND ((c.requester_id = p.user_id AND c.addressee_id = ?)
                OR (c.requester_id = ? AND c.addressee_id = p.user_id))
          ))
          OR EXISTS (SELECT 1 FROM post_collaborators pc WHERE pc.post_id = p.id AND pc.user_id = ? AND pc.status = 'accepted'))
        ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
      userId
        ? [String(userId), String(userId), String(userId), String(userId), String(userId), String(limit), String(offset)]
        : ['0', '0', '0', '0', String(limit), String(offset)]
    );

    const formattedPosts = [];
    for (const p of posts) {
      const mediaRows = await query(
        'SELECT id, media_type, media_url, thumbnail_url, video_duration, position FROM post_media WHERE post_id = ? ORDER BY position ASC',
        [p.id]
      );
      const media = mediaRows.length
        ? mediaRows
        : (p.media_url ? [{ media_type: p.media_type, media_url: p.media_url, thumbnail_url: p.thumbnail_url, video_duration: p.video_duration }] : []);

      const collabRows = await query(
        `SELECT pc.user_id, pc.status, u.username, u.full_name, u.profile_image_url
         FROM post_collaborators pc JOIN users u ON pc.user_id = u.id
         WHERE pc.post_id = ?`,
        [p.id]
      );
      const collaborators = collabRows
        .filter((c) => c.status === 'accepted')
        .map((c) => ({ id: c.user_id, username: c.username, full_name: c.full_name, profile_image_url: c.profile_image_url }));

      formattedPosts.push({
        id: p.id,
        user: {
          id: p.user_id,
          username: p.username,
          full_name: p.full_name,
          profile_image_url: p.profile_image_url,
          is_online: isOnline(p),
        },
        caption: p.caption,
        audience: p.audience,
        media_type: p.media_type,
        media_url: p.media_url,
        media,
        collaborators,
        collaborator_pending_count: collabRows.filter((c) => c.status === 'pending').length,
        collaborator_invited: userId ? collabRows.some((c) => c.user_id === userId && c.status === 'pending') : false,
        likes_count: p.likes_count,
        comments_count: p.comments_count,
        is_liked: p.is_liked > 0,
        created_at: p.created_at,
      });
    }

    return sendSuccess(res, 'Posts retrieved', {
      posts: formattedPosts,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
}

async function getPostById(req, res, next) {
  try {
    const { id } = req.params;
    const userId = req.user ? req.user.id : null;

    const posts = await query(
      `SELECT p.*,
        u.username, u.full_name, u.profile_image_url, u.last_active_at, u.show_online,
        (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) as likes_count,
        (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comments_count
        ${userId ? ', (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id AND user_id = ?) as is_liked' : ', 0 as is_liked'}
       FROM posts p
       JOIN users u ON p.user_id = u.id
       WHERE p.id = ? AND p.is_hidden = 0 AND (
         p.audience = 'public'
         OR p.user_id = ?
         OR (p.audience = 'friends' AND EXISTS (SELECT 1 FROM connections c WHERE c.status = 'accepted' AND ((c.requester_id = p.user_id AND c.addressee_id = ?) OR (c.requester_id = ? AND c.addressee_id = p.user_id))))
         OR EXISTS (SELECT 1 FROM post_collaborators pc WHERE pc.post_id = p.id AND pc.user_id = ? AND pc.status = 'accepted')
       )`,
      userId ? [String(userId), String(id), String(userId), String(userId), String(userId), String(userId)] : [String(id), '0', '0', '0', '0']
    );

    if (posts.length === 0) {
      return sendError(res, 'Post not found', null, 404);
    }

    const post = await getPostEntity(posts[0].id, userId);
    return sendSuccess(res, 'Post retrieved', { post });
  } catch (error) {
    next(error);
  }
}

async function getUserPosts(req, res, next) {
  try {
    const { username } = req.params;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const offset = (page - 1) * limit;
    const userId = req.user ? req.user.id : null;

    const user = await queryOne('SELECT id FROM users WHERE username = ? AND is_active = 1', [username]);
    if (!user) {
      return sendError(res, 'User not found', null, 404);
    }

    const countRows = await query(
      `SELECT COUNT(*) as total FROM posts
       WHERE is_hidden = 0
         AND (user_id = ? OR EXISTS (SELECT 1 FROM post_collaborators pc WHERE pc.post_id = posts.id AND pc.user_id = ? AND pc.status = 'accepted'))
         AND (audience = 'public' OR user_id = ?)`,
      [user.id, user.id, user.id]
    );
    const total = countRows[0]?.total || 0;

    const posts = await query(
      `SELECT p.*,
        u.username, u.full_name, u.profile_image_url, u.last_active_at, u.show_online,
        (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) as likes_count,
        (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comments_count
        ${userId ? ', (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id AND user_id = ?) as is_liked' : ', 0 as is_liked'}
       FROM posts p
       JOIN users u ON p.user_id = u.id
       WHERE (p.user_id = ? OR EXISTS (SELECT 1 FROM post_collaborators pc WHERE pc.post_id = p.id AND pc.user_id = ? AND pc.status = 'accepted'))
         AND p.is_hidden = 0
         AND p.audience = 'public'
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
      userId
        ? [String(userId), user.id, user.id, String(limit), String(offset)]
        : [user.id, user.id, String(limit), String(offset)]
    );

    const formattedPosts = [];
    for (const p of posts) {
      const mediaRows = await query(
        'SELECT id, media_type, media_url, thumbnail_url, video_duration, position FROM post_media WHERE post_id = ? ORDER BY position ASC',
        [p.id]
      );
      const media = mediaRows.length
        ? mediaRows
        : (p.media_url ? [{ media_type: p.media_type, media_url: p.media_url, thumbnail_url: p.thumbnail_url, video_duration: p.video_duration }] : []);

      const collabRows = await query(
        `SELECT pc.user_id, pc.status, u.username, u.full_name, u.profile_image_url
         FROM post_collaborators pc JOIN users u ON pc.user_id = u.id
         WHERE pc.post_id = ?`,
        [p.id]
      );
      const collaborators = collabRows
        .filter((c) => c.status === 'accepted')
        .map((c) => ({ id: c.user_id, username: c.username, full_name: c.full_name, profile_image_url: c.profile_image_url }));

      formattedPosts.push({
        id: p.id,
        user: {
          id: p.user_id,
          username: p.username,
          full_name: p.full_name,
          profile_image_url: p.profile_image_url,
          is_online: isOnline(p),
        },
        caption: p.caption,
        audience: p.audience,
        media_type: p.media_type,
        media_url: p.media_url,
        media,
        collaborators,
        collaborator_pending_count: collabRows.filter((c) => c.status === 'pending').length,
        collaborator_invited: userId ? collabRows.some((c) => c.user_id === userId && c.status === 'pending') : false,
        likes_count: p.likes_count,
        comments_count: p.comments_count,
        is_liked: p.is_liked > 0,
        created_at: p.created_at,
      });
    }

    return sendSuccess(res, 'User posts retrieved', {
      posts: formattedPosts,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
}

async function deletePost(req, res, next) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const post = await queryOne('SELECT * FROM posts WHERE id = ?', [id]);
    if (!post) {
      return sendError(res, 'Post not found', null, 404);
    }

    if (post.user_id !== userId) {
      return sendError(res, 'Not authorized to delete this post', null, 403);
    }

    const mediaRows = await query('SELECT media_url FROM post_media WHERE post_id = ?', [id]);
    const allUrls = [post.media_url, ...mediaRows.map((m) => m.media_url)].filter(Boolean);

    for (const url of allUrls) {
      if (url && url.includes('cloudinary')) {
        try {
          const urlParts = url.split('/');
          const publicIdWithExt = urlParts.slice(-2).join('/');
          const publicId = publicIdWithExt.replace(/\.[^.]+$/, '');
          const resourceType = url.includes('video') ? 'video' : 'image';
          await cloudinaryService.deleteFile(publicId, resourceType);
        } catch (err) {
          console.error('Error deleting Cloudinary file:', err.message);
        }
      }
    }

    await transaction(async (conn) => {
      await conn.execute('DELETE FROM post_likes WHERE post_id = ?', [id]);
      await conn.execute('DELETE FROM comments WHERE post_id = ?', [id]);
      await conn.execute('DELETE FROM post_collaborators WHERE post_id = ?', [id]);
      await conn.execute('DELETE FROM post_media WHERE post_id = ?', [id]);
      await conn.execute('DELETE FROM posts WHERE id = ? AND user_id = ?', [id, userId]);
    });

    return sendSuccess(res, 'Post deleted');
  } catch (error) {
    next(error);
  }
}

async function updateCollaboratorStatus(req, res, next) {
  try {
    const { id: postId, userId: collaboratorUserId } = req.params;
    const { action } = req.body;
    const currentUserId = req.user.id;

    if (!['accept', 'decline'].includes(action)) {
      return sendError(res, 'Invalid action. Use accept or decline', null, 400);
    }

    const post = await queryOne('SELECT id, user_id FROM posts WHERE id = ?', [postId]);
    if (!post) {
      return sendError(res, 'Post not found', null, 404);
    }

    const collab = await queryOne(
      'SELECT * FROM post_collaborators WHERE post_id = ? AND user_id = ?',
      [postId, currentUserId]
    );
    if (!collab || collab.status !== 'pending') {
      return sendError(res, 'No pending collaboration invitation found', null, 404);
    }
    if (collab.status === 'pending' && collab.user_id !== currentUserId) {
      return sendError(res, 'You are not authorized to update this invitation', null, 403);
    }

    const newStatus = action === 'accept' ? 'accepted' : 'rejected';

    await execute('UPDATE post_collaborators SET status = ? WHERE post_id = ? AND user_id = ?', [newStatus, postId, currentUserId]);

    if (action === 'accept') {
      await execute(
        `INSERT INTO notifications (user_id, from_user_id, type, post_id)
         VALUES (?, ?, 'collaboration_accepted', ?)`,
        [post.user_id, currentUserId, postId]
      );
    } else {
      await execute('DELETE FROM post_collaborators WHERE post_id = ? AND user_id = ?', [postId, currentUserId]);
    }

    return sendSuccess(res, action === 'accept' ? 'Collaboration accepted' : 'Collaboration declined');
  } catch (error) {
    next(error);
  }
}

async function removeCollaborator(req, res, next) {
  try {
    const { id: postId, userId: collaboratorUserId } = req.params;
    const currentUserId = req.user.id;

    const post = await queryOne('SELECT id, user_id FROM posts WHERE id = ?', [postId]);
    if (!post) return sendError(res, 'Post not found', null, 404);
    if (post.user_id !== currentUserId) {
      return sendError(res, 'Only the post creator can remove collaborators', null, 403);
    }

    await execute('DELETE FROM post_collaborators WHERE post_id = ? AND user_id = ?', [postId, collaboratorUserId]);
    return sendSuccess(res, 'Collaborator removed');
  } catch (error) {
    next(error);
  }
}

async function getPendingCollaborations(req, res, next) {
  try {
    const userId = req.user.id;
    const invites = await query(
      `SELECT pc.post_id, pc.status, p.caption, p.media_url, p.media_type, p.created_at,
        u.username, u.full_name, u.profile_image_url
       FROM post_collaborators pc
       JOIN posts p ON pc.post_id = p.id
       JOIN users u ON p.user_id = u.id
       WHERE pc.user_id = ? AND pc.status = 'pending'
       ORDER BY pc.created_at DESC
       LIMIT 50`,
      [userId]
    );
    return sendSuccess(res, 'Pending collaborations retrieved', { invites });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createPost,
  getPosts,
  getPostById,
  getUserPosts,
  deletePost,
  updateCollaboratorStatus,
  removeCollaborator,
  getPendingCollaborations,
  getPostEntity,
};