const { query, queryOne, execute } = require('../config/database');
const { sendSuccess, sendError } = require('../utils/response');
const cloudinaryService = require('../services/cloudinaryService');
const { isAllowedImage, isAllowedAudio, MAX_IMAGE_SIZE, MAX_AUDIO_SIZE } = require('../utils/video');

async function createComment(req, res, next) {
    try {
        const postId = Number.parseInt(req.params.id, 10);
        const userId = req.user.id;
        const commentText = String(req.body.comment_text || '').trim();
        const file = req.file;

        if (!Number.isInteger(postId) || postId < 1) return sendError(res, 'Invalid post', null, 400);
        if (!commentText && !file) return sendError(res, 'Comment text or media is required', null, 400);
        if (commentText.length > 1000) return sendError(res, 'Comment must be under 1000 characters', null, 400);

        const post = await queryOne('SELECT id, user_id FROM posts WHERE id = ?', [postId]);
        if (!post) return sendError(res, 'Post not found', null, 404);

        let mediaUrl = null;
        let mediaType = null;
        let audioDuration = null;
        if (file) {
            if (isAllowedImage(file.mimetype)) {
                if (file.size > MAX_IMAGE_SIZE) return sendError(res, 'Comment image must be 10MB or smaller', null, 400);
                mediaType = 'image';
            } else if (isAllowedAudio(file.mimetype)) {
                if (file.size > MAX_AUDIO_SIZE) return sendError(res, 'Voice note must be 10MB or smaller', null, 400);
                mediaType = 'voice';
                audioDuration = Number.parseFloat(req.body.audio_duration) || null;
            } else {
                return sendError(res, 'Comments support images and voice notes only', null, 400);
            }
            const upload = await cloudinaryService.uploadMessageMedia(file.buffer, file.mimetype);
            mediaUrl = upload.url;
        }

        const result = await execute(
            'INSERT INTO comments (post_id, user_id, comment_text, media_url, media_type, audio_duration) VALUES (?, ?, ?, ?, ?, ?)',
            [postId, userId, commentText || null, mediaUrl, mediaType, audioDuration]
        );
        const comment = await queryOne(
            `SELECT c.*, u.username, u.full_name, u.profile_image_url
       FROM comments c JOIN users u ON c.user_id = u.id WHERE c.id = ?`,
            [result.insertId]
        );

        if (post.user_id !== userId) {
            await execute(
                `INSERT INTO notifications (user_id, from_user_id, type, post_id) VALUES (?, ?, 'comment', ?)`,
                [post.user_id, userId, postId]
            );
        }
        return sendSuccess(res, 'Comment created', { comment }, 201);
    } catch (error) {
        next(error);
    }
}

async function getComments(req, res, next) {
    try {
        const postId = Number.parseInt(req.params.id, 10);
        const page = Number.parseInt(req.query.page, 10) || 1;
        const limit = Math.min(Number.parseInt(req.query.limit, 10) || 20, 50);
        const offset = (page - 1) * limit;
        const post = await queryOne('SELECT id FROM posts WHERE id = ?', [postId]);
        if (!post) return sendError(res, 'Post not found', null, 404);

        const countRows = await query('SELECT COUNT(*) AS total FROM comments WHERE post_id = ?', [postId]);
        const total = countRows[0]?.total || 0;
        const comments = await query(
            `SELECT c.*, u.username, u.full_name, u.profile_image_url
       FROM comments c JOIN users u ON c.user_id = u.id AND u.is_active = 1
       WHERE c.post_id = ? ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
            [postId, String(limit), String(offset)]
        );
        return sendSuccess(res, 'Comments retrieved', { comments, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (error) {
        next(error);
    }
}

async function deleteComment(req, res, next) {
    try {
        const commentId = Number.parseInt(req.params.id, 10);
        const comment = await queryOne('SELECT * FROM comments WHERE id = ?', [commentId]);
        if (!comment) return sendError(res, 'Comment not found', null, 404);
        if (comment.user_id !== req.user.id) return sendError(res, 'Not authorized to delete this comment', null, 403);
        await execute('DELETE FROM comments WHERE id = ?', [commentId]);
        return sendSuccess(res, 'Comment deleted');
    } catch (error) {
        next(error);
    }
}

module.exports = { createComment, getComments, deleteComment };
