const messageService = require('../services/messageService');
const { sendSuccess, sendError } = require('../utils/response');
const cloudinaryService = require('../services/cloudinaryService');

async function getConversations(req, res, next) {
  try {
    const conversations = await messageService.getConversations(req.user.id);
    return sendSuccess(res, 'Conversations retrieved', { conversations });
  } catch (error) {
    next(error);
  }
}

async function getMessages(req, res, next) {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.id;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);

    const result = await messageService.getMessages(currentUserId, parseInt(userId, 10), page, limit);
    return sendSuccess(res, 'Messages retrieved', result);
  } catch (error) {
    next(error);
  }
}

async function sendMessage(req, res, next) {
  try {
    const { receiver_id, message_text, message_type } = req.body;
    const sender_id = req.user.id;

    if (!receiver_id) {
      return sendError(res, 'Receiver ID is required', null, 400);
    }

    if (parseInt(receiver_id, 10) === sender_id) {
      return sendError(res, 'Cannot send message to yourself', null, 400);
    }

    let type = message_type || 'text';
    let media_url = null;

    if (req.file) {
      const result = await cloudinaryService.uploadMessageMedia(
        req.file.buffer,
        req.file.mimetype
      );
      media_url = result.url;
      if (req.file.mimetype.startsWith('audio/')) {
        type = 'voice';
      } else if (req.file.mimetype.startsWith('image/')) {
        type = 'image';
      }
    } else if (type !== 'text') {
      return sendError(res, 'File is required for non-text messages', null, 400);
    }

    if (type === 'text' && (!message_text || !message_text.trim())) {
      return sendError(res, 'Message text is required', null, 400);
    }

    const message = await messageService.sendMessage({
      sender_id,
      receiver_id: parseInt(receiver_id, 10),
      message_type: type,
      message_text: message_text || null,
      media_url,
    });

    return sendSuccess(res, 'Message sent', { message }, 201);
  } catch (error) {
    next(error);
  }
}

async function markAsRead(req, res, next) {
  try {
    const { id } = req.params;
    const message = await messageService.markAsRead(req.user.id, parseInt(id, 10));
    return sendSuccess(res, 'Message marked as read', { message });
  } catch (error) {
    next(error);
  }
}

module.exports = { getConversations, getMessages, sendMessage, markAsRead };
