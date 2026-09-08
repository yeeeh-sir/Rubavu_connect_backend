const http = require('http');
const { Server } = require('socket.io');
const { verifyToken } = require('../utils/jwt');
const { queryOne, execute } = require('../config/database');

function attachSocketServer(app) {
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: process.env.CLIENT_URL || 'http://localhost:5173',
      credentials: true,
      methods: ['GET', 'POST'],
    },
  });

  const connectedUsers = new Map();

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error('Authentication required'));
      const decoded = verifyToken(token);
      const user = await queryOne(
        'SELECT id, username, full_name, profile_image_url FROM users WHERE id = ? AND is_active = 1',
        [decoded.id]
      );
      if (!user) return next(new Error('User not found'));
      socket.user = user;
      next();
    } catch (error) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user.id;

    execute('UPDATE users SET last_active_at = NOW() WHERE id = ?', [userId]).catch(() => {});
    const prevCount = connectedUsers.get(userId) || 0;
    connectedUsers.set(userId, prevCount + 1);
    queryOne('SELECT show_online FROM users WHERE id = ?', [userId]).then((me) => {
      if (me && Number(me.show_online) === 1) {
        io.emit('presence:online', { user_id: userId, username: socket.user.username });
      }
    }).catch(() => {});

    socket.on('presence:ping', () => {
      execute('UPDATE users SET last_active_at = NOW() WHERE id = ?', [userId]).catch(() => {});
    });

    socket.on('live:join', async (liveId) => {
      const safeLiveId = Number.parseInt(liveId, 10);
      if (!Number.isInteger(safeLiveId) || safeLiveId < 1) return;

      const session = await queryOne('SELECT id FROM live_sessions WHERE id = ? AND status = \'live\'', [safeLiveId]);
      if (!session) return;

      socket.join(`live:${safeLiveId}`);
      await execute(
        `INSERT INTO live_viewers (live_session_id, user_id, joined_at, left_at)
         VALUES (?, ?, NOW(), NULL)
         ON DUPLICATE KEY UPDATE left_at = NULL`,
        [safeLiveId, userId]
      );
      const viewerRows = await queryOne(
        'SELECT COUNT(*) AS count FROM live_viewers WHERE live_session_id = ? AND left_at IS NULL',
        [safeLiveId]
      );
      io.to(`live:${safeLiveId}`).emit('live:viewer_count', { live_id: safeLiveId, viewer_count: viewerRows?.count || 0 });

      const sessionOwner = await queryOne('SELECT creator_id FROM live_sessions WHERE id = ?', [safeLiveId]);
      if (sessionOwner && sessionOwner.creator_id !== userId) {
        io.to(`live:${safeLiveId}`).emit('live:viewer_joined', {
          user_id: userId,
          username: socket.user.username,
          full_name: socket.user.full_name,
          profile_image_url: socket.user.profile_image_url,
        });
      }
    });

    socket.on('live:leave', async (liveId) => {
      const safeLiveId = Number.parseInt(liveId, 10);
      if (!Number.isInteger(safeLiveId) || safeLiveId < 1) return;

      const rooms = [...socket.rooms];
      const roomToLeave = rooms.find((r) => r === `live:${safeLiveId}`);
      if (roomToLeave) socket.leave(roomToLeave);

      await execute(
        'UPDATE live_viewers SET left_at = NOW() WHERE live_session_id = ? AND user_id = ? AND left_at IS NULL',
        [safeLiveId, userId]
      );
      const viewerRows = await queryOne(
        'SELECT COUNT(*) AS count FROM live_viewers WHERE live_session_id = ? AND left_at IS NULL',
        [safeLiveId]
      );
      io.to(`live:${safeLiveId}`).emit('live:viewer_count', { live_id: safeLiveId, viewer_count: viewerRows?.count || 0 });
    });

    socket.on('live:comment', async (data) => {
      const liveId = Number.parseInt(data?.live_id, 10);
      const text = String(data?.comment_text || '').trim().slice(0, 500);
      if (!Number.isInteger(liveId) || liveId < 1 || !text) return;

      const session = await queryOne('SELECT id FROM live_sessions WHERE id = ? AND status = \'live\'', [liveId]);
      if (!session) return;

      const result = await execute(
        'INSERT INTO live_comments (live_session_id, user_id, comment_text) VALUES (?, ?, ?)',
        [liveId, userId, text]
      );
      const comment = await queryOne(
        `SELECT lc.id, lc.live_session_id, lc.user_id, lc.comment_text, lc.created_at,
          u.username, u.full_name, u.profile_image_url
         FROM live_comments lc JOIN users u ON lc.user_id = u.id
         WHERE lc.id = ?`,
        [result.insertId]
      );
      io.to(`live:${liveId}`).emit('live:comment', comment);
    });

    socket.on('live:frame', async (data) => {
      const liveId = Number.parseInt(data?.live_id, 10);
      const frame = String(data?.frame || '');
      if (!Number.isInteger(liveId) || liveId < 1) return;
      if (!frame.startsWith('data:image/jpeg') || frame.length > 500000) return;

      const session = await queryOne('SELECT id, creator_id FROM live_sessions WHERE id = ? AND status = \'live\'', [liveId]);
      if (!session || session.creator_id !== userId) return;

      socket.to(`live:${liveId}`).emit('live:frame', { live_id: liveId, frame });
    });

    socket.on('live:ended', async (liveId) => {
      const safeLiveId = Number.parseInt(liveId, 10);
      if (!Number.isInteger(safeLiveId) || safeLiveId < 1) return;
      const session = await queryOne('SELECT id, creator_id FROM live_sessions WHERE id = ?', [safeLiveId]);
      if (!session || session.creator_id !== userId) return;

      await execute('UPDATE live_sessions SET status = \'ended\', ended_at = NOW() WHERE id = ?', [safeLiveId]);
      await execute('UPDATE live_viewers SET left_at = NOW() WHERE live_session_id = ? AND left_at IS NULL', [safeLiveId]);
      io.to(`live:${safeLiveId}`).emit('live:ended', { live_id: safeLiveId });
      io.in(`live:${safeLiveId}`).socketsLeave(`live:${safeLiveId}`);
    });

    socket.on('disconnect', () => {
      const remaining = (connectedUsers.get(userId) || 1) - 1;
      if (remaining <= 0) {
        connectedUsers.delete(userId);
        io.emit('presence:offline', { user_id: userId, username: socket.user.username });
      } else {
        connectedUsers.set(userId, remaining);
      }

      socket.rooms.forEach((room) => {
        if (room.startsWith('live:')) {
          const liveId = Number.parseInt(room.split(':')[1], 10);
          execute(
            'UPDATE live_viewers SET left_at = NOW() WHERE live_session_id = ? AND user_id = ? AND left_at IS NULL',
            [liveId, userId]
          ).then(() => {
            return queryOne(
              'SELECT COUNT(*) AS count FROM live_viewers WHERE live_session_id = ? AND left_at IS NULL',
              [liveId]
            );
          }).then((viewerRows) => {
            io.to(room).emit('live:viewer_count', { live_id: liveId, viewer_count: viewerRows?.count || 0 });
          }).catch(() => {});
        }
      });
    });
  });

  return { server, io };
}

module.exports = { attachSocketServer };