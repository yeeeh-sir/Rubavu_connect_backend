const { query, queryOne, execute } = require('../config/database');
const { sendSuccess, sendError } = require('../utils/response');
const cloudinaryService = require('../services/cloudinaryService');

const STATUS_EXPIRY_HOURS = 25;

async function createStatus(req, res, next) {
  try {
    if (!req.file) {
      return sendError(res, 'Media file is required', null, 400);
    }

    const userId = req.user.id;
    const mimetype = req.file.mimetype;

    let mediaType;
    if (mimetype.startsWith('image/')) {
      mediaType = 'image';
    } else if (mimetype.startsWith('video/')) {
      mediaType = 'video';
      const { validateVideoDuration } = require('../utils/videoUtils');
      await validateVideoDuration(
        req.file.buffer,
        req.file.originalname || 'video.mp4'
      );
    } else {
      return sendError(res, 'Invalid media type. Only images and videos allowed.', null, 400);
    }

    const cloudinaryResult = await cloudinaryService.uploadStatusMedia(req.file.buffer, mimetype);

    const dbResult = await execute(
      `INSERT INTO statuses (user_id, media_type, media_url, expires_at)
       VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ${STATUS_EXPIRY_HOURS} HOUR))`,
      [userId, mediaType, cloudinaryResult.url]
    );

    const status = await queryOne(
      `SELECT s.*, u.username, u.full_name, u.profile_image_url
       FROM statuses s
       JOIN users u ON s.user_id = u.id
       WHERE s.id = ?`,
      [dbResult.insertId]
    );

    return sendSuccess(res, 'Status created', { status }, 201);
  } catch (error) {
    next(error);
  }
}

async function getStatuses(req, res, next) {
  try {
    const userId = req.user ? req.user.id : null;

    const statuses = await query(
      `SELECT s.*, u.username, u.full_name, u.profile_image_url
       FROM statuses s
       JOIN users u ON s.user_id = u.id AND u.is_active = 1
       WHERE s.expires_at > NOW()
       ORDER BY s.created_at DESC`
    );

    return sendSuccess(res, 'Statuses retrieved', { statuses });
  } catch (error) {
    next(error);
  }
}

async function deleteStatus(req, res, next) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const status = await queryOne('SELECT * FROM statuses WHERE id = ?', [id]);
    if (!status) {
      return sendError(res, 'Status not found', null, 404);
    }

    if (status.user_id !== userId) {
      return sendError(res, 'Not authorized to delete this status', null, 403);
    }

    if (status.media_url && status.media_url.includes('cloudinary')) {
      try {
        const urlParts = status.media_url.split('/');
        const publicIdWithExt = urlParts.slice(-2).join('/');
        const publicId = publicIdWithExt.replace(/\.[^.]+$/, '');
        const resourceType = status.media_type === 'video' ? 'video' : 'image';
        await cloudinaryService.deleteFile(publicId, resourceType);
      } catch (err) {
        console.error('Error deleting Cloudinary file:', err.message);
      }
    }

    await execute('DELETE FROM statuses WHERE id = ? AND user_id = ?', [id, userId]);

    return sendSuccess(res, 'Status deleted');
  } catch (error) {
    next(error);
  }
}

module.exports = { createStatus, getStatuses, deleteStatus };
