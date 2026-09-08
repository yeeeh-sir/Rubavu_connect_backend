const { query, queryOne, execute } = require('../config/database');
const { withPresence } = require('../utils/presence');

async function getConversations(userId) {
  const conversations = await query(
    `
    SELECT 
      u.id as user_id,
      u.username,
      u.full_name,
      u.profile_image_url,
      u.last_active_at,
      u.show_online,
      m.message_text,
      m.message_type,
      m.media_url,
      m.is_read,
      m.created_at as last_message_at,
      m.sender_id,
      (
        SELECT COUNT(*) FROM messages 
        WHERE sender_id = u.id AND receiver_id = ? AND is_read = 0
      ) as unread_count
    FROM messages m
    INNER JOIN users u ON u.id = CASE 
      WHEN m.sender_id = ? THEN m.receiver_id 
      ELSE m.sender_id 
    END
    INNER JOIN (
      SELECT 
        CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END as other_user_id,
        MAX(created_at) as max_created
      FROM messages
      WHERE sender_id = ? OR receiver_id = ?
      GROUP BY other_user_id
    ) latest ON u.id = latest.other_user_id AND m.created_at = latest.max_created
    WHERE (m.sender_id = ? OR m.receiver_id = ?)
    ORDER BY m.created_at DESC
    `,
    [userId, userId, userId, userId, userId, userId, userId]
  );

  return conversations.map((c) => withPresence(c));
}

async function getMessages(userId, otherUserId, page = 1, limit = 20) {
  const offset = (page - 1) * limit;

  const blocked = await queryOne(
    'SELECT id FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)',
    [userId, otherUserId, otherUserId, userId]
  );
  if (blocked) {
    const error = new Error('This conversation is unavailable');
    error.statusCode = 403;
    throw error;
  }

  const countResult = await queryOne(
    `SELECT COUNT(*) as total FROM messages 
     WHERE ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))`,
    [userId, otherUserId, otherUserId, userId]
  );
  const total = countResult ? countResult.total : 0;

  const messages = await query(
    `SELECT m.*, 
      su.username as sender_username, su.profile_image_url as sender_profile_image,
      ru.username as receiver_username, ru.profile_image_url as receiver_profile_image
    FROM messages m
    JOIN users su ON m.sender_id = su.id
    JOIN users ru ON m.receiver_id = ru.id
    WHERE (m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?)
    ORDER BY m.created_at DESC
    LIMIT ? OFFSET ?`,
    [userId, otherUserId, otherUserId, userId, String(limit), String(offset)]
  );

  const partner = await queryOne(
    `SELECT id, username, full_name, profile_image_url, last_active_at, show_online
     FROM users WHERE id = ? AND is_active = 1`,
    [otherUserId]
  );

  return {
    messages: messages.reverse(),
    partner: partner ? withPresence(partner) : null,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
}

async function sendMessage({ sender_id, receiver_id, message_type, message_text, media_url }) {
  const receiver = await queryOne(
    'SELECT id, who_can_message FROM users WHERE id = ? AND is_active = 1',
    [receiver_id]
  );
  if (!receiver) {
    const err = new Error('Receiver not found');
    err.statusCode = 404;
    throw err;
  }

  if (receiver.who_can_message === 'connections') {
    const areConnected = await queryOne(
      `SELECT id FROM connections WHERE status = 'accepted'
       AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))`,
      [sender_id, receiver_id, receiver_id, sender_id]
    );
    if (!areConnected) {
      const err = new Error('This user only accepts messages from their connections');
      err.statusCode = 403;
      throw err;
    }
  }

  const blocked = await queryOne(
    'SELECT id FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)',
    [sender_id, receiver_id, receiver_id, sender_id]
  );
  if (blocked) {
    const error = new Error('You cannot message this user');
    error.statusCode = 403;
    throw error;
  }

  const result = await execute(
    `INSERT INTO messages (sender_id, receiver_id, message_type, message_text, media_url, is_read)
     VALUES (?, ?, ?, ?, ?, 0)`,
    [sender_id, receiver_id, message_type, message_text || null, media_url || null]
  );

  const message = await queryOne('SELECT * FROM messages WHERE id = ?', [result.insertId]);
  return message;
}

async function markAsRead(userId, messageId) {
  const message = await queryOne('SELECT * FROM messages WHERE id = ?', [messageId]);
  if (!message) {
    const err = new Error('Message not found');
    err.statusCode = 404;
    throw err;
  }
  if (message.receiver_id !== userId) {
    const err = new Error('Not authorized to mark this message as read');
    err.statusCode = 403;
    throw err;
  }

  await execute('UPDATE messages SET is_read = 1 WHERE id = ? AND receiver_id = ?', [messageId, userId]);
  return { ...message, is_read: 1 };
}

module.exports = { getConversations, getMessages, sendMessage, markAsRead };
