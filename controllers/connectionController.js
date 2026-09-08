const { query, queryOne, execute, transaction } = require('../config/database');
const { sendSuccess, sendError } = require('../utils/response');

async function getActiveUser(userId) {
    return queryOne('SELECT id, username, full_name, profile_image_url FROM users WHERE id = ? AND is_active = 1', [userId]);
}

async function getConnectionPair(firstUserId, secondUserId) {
    return queryOne(
        `SELECT * FROM connections
     WHERE (requester_id = ? AND addressee_id = ?)
        OR (requester_id = ? AND addressee_id = ?)
     ORDER BY id DESC LIMIT 1`,
        [firstUserId, secondUserId, secondUserId, firstUserId]
    );
}

async function sendRequest(req, res, next) {
    try {
        const requesterId = req.user.id;
        const addresseeId = Number.parseInt(req.params.userId, 10);

        if (!Number.isInteger(addresseeId) || addresseeId < 1) {
            return sendError(res, 'A valid user is required', null, 400);
        }
        if (requesterId === addresseeId) {
            return sendError(res, 'You cannot connect with yourself', null, 400);
        }

        const target = await queryOne('SELECT id, who_can_connect FROM users WHERE id = ? AND is_active = 1', [addresseeId]);
        if (!target) return sendError(res, 'User not found', null, 404);

        if (target.who_can_connect === 'connections') {
            const followsTarget = await queryOne(
                'SELECT id FROM follows WHERE follower_id = ? AND following_id = ?',
                [requesterId, addresseeId]
            );
            if (!followsTarget) {
                return sendError(res, 'This user only accepts connection requests from people they follow', null, 403);
            }
        }

        const blocked = await queryOne(
            'SELECT id FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)',
            [requesterId, addresseeId, addresseeId, requesterId]
        );
        if (blocked) return sendError(res, 'This user is unavailable for connection requests', null, 403);

        const existing = await getConnectionPair(requesterId, addresseeId);
        if (existing?.status === 'accepted') {
            return sendError(res, 'You are already connected', null, 409);
        }
        if (existing?.status === 'pending') {
            if (existing.requester_id === requesterId) {
                return sendError(res, 'Connection request already sent', null, 409);
            }
            return sendError(res, 'This user already sent you a connection request', null, 409);
        }

        let request;
        if (existing?.status === 'rejected' && existing.requester_id === requesterId) {
            await execute('UPDATE connections SET status = \'pending\', updated_at = NOW() WHERE id = ?', [existing.id]);
            request = await queryOne('SELECT * FROM connections WHERE id = ?', [existing.id]);
        } else {
            const result = await execute(
                'INSERT INTO connections (requester_id, addressee_id, status) VALUES (?, ?, \'pending\')',
                [requesterId, addresseeId]
            );
            request = await queryOne('SELECT * FROM connections WHERE id = ?', [result.insertId]);
        }

        await execute(
            `INSERT INTO notifications (user_id, from_user_id, type)
       VALUES (?, ?, 'connection_request')`,
            [addresseeId, requesterId]
        );

        return sendSuccess(res, 'Connection request sent', { request }, 201);
    } catch (error) {
        next(error);
    }
}

async function updateRequest(req, res, next, status) {
    try {
        const requestId = Number.parseInt(req.params.requestId, 10);
        if (!Number.isInteger(requestId) || requestId < 1) {
            return sendError(res, 'A valid connection request is required', null, 400);
        }

        const request = await queryOne('SELECT * FROM connections WHERE id = ?', [requestId]);
        if (!request) return sendError(res, 'Connection request not found', null, 404);
        if (request.addressee_id !== req.user.id) {
            return sendError(res, 'You are not authorized to update this request', null, 403);
        }
        if (request.status !== 'pending') {
            return sendError(res, 'This request is no longer pending', null, 409);
        }

        await execute('UPDATE connections SET status = ?, updated_at = NOW() WHERE id = ?', [status, requestId]);

        if (status === 'accepted') {
            await execute(
                `INSERT INTO notifications (user_id, from_user_id, type)
         VALUES (?, ?, 'connection_accepted')`,
                [request.requester_id, req.user.id]
            );
        }

        const updated = await queryOne('SELECT * FROM connections WHERE id = ?', [requestId]);
        return sendSuccess(res, status === 'accepted' ? 'Connection request accepted' : 'Connection request rejected', { request: updated });
    } catch (error) {
        next(error);
    }
}

async function acceptRequest(req, res, next) {
    return updateRequest(req, res, next, 'accepted');
}

async function rejectRequest(req, res, next) {
    return updateRequest(req, res, next, 'rejected');
}

async function cancelRequest(req, res, next) {
    try {
        const requestId = Number.parseInt(req.params.requestId, 10);
        const request = await queryOne('SELECT * FROM connections WHERE id = ?', [requestId]);
        if (!request) return sendError(res, 'Connection request not found', null, 404);
        if (request.requester_id !== req.user.id) return sendError(res, 'You are not authorized to cancel this request', null, 403);
        if (request.status !== 'pending') return sendError(res, 'This request is no longer pending', null, 409);

        await execute('DELETE FROM connections WHERE id = ?', [requestId]);
        return sendSuccess(res, 'Connection request cancelled');
    } catch (error) {
        next(error);
    }
}

async function removeConnection(req, res, next) {
    try {
        const otherUserId = Number.parseInt(req.params.userId, 10);
        if (!Number.isInteger(otherUserId) || otherUserId < 1) {
            return sendError(res, 'A valid user is required', null, 400);
        }

        const connection = await getConnectionPair(req.user.id, otherUserId);
        if (!connection || connection.status !== 'accepted') {
            return sendError(res, 'Accepted connection not found', null, 404);
        }

        await execute('DELETE FROM connections WHERE id = ?', [connection.id]);
        return sendSuccess(res, 'Connection removed');
    } catch (error) {
        next(error);
    }
}

async function getStatus(req, res, next) {
    try {
        const otherUserId = Number.parseInt(req.params.userId, 10);
        if (!Number.isInteger(otherUserId) || otherUserId < 1) return sendError(res, 'A valid user is required', null, 400);
        if (!(await getActiveUser(otherUserId))) return sendError(res, 'User not found', null, 404);

        const connection = await getConnectionPair(req.user.id, otherUserId);
        let status = 'none';
        if (connection?.status === 'accepted') status = 'accepted';
        else if (connection?.status === 'pending') status = connection.requester_id === req.user.id ? 'pending_sent' : 'pending_received';
        else if (connection?.status === 'rejected') status = 'rejected';

        return sendSuccess(res, 'Connection status retrieved', {
            status,
            request_id: connection?.id || null,
            is_connected: status === 'accepted',
            can_send: status === 'none' || status === 'rejected',
        });
    } catch (error) {
        next(error);
    }
}

async function listRequests(req, res, next) {
    try {
        const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
        const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 50);
        const offset = (page - 1) * limit;
        const direction = req.query.direction === 'sent' ? 'sent' : 'received';
        const userColumn = direction === 'sent' ? 'c.requester_id' : 'c.addressee_id';
        const otherColumn = direction === 'sent' ? 'c.addressee_id' : 'c.requester_id';

        const countRows = await query(`SELECT COUNT(*) AS total FROM connections c WHERE ${userColumn} = ? AND c.status = 'pending'`, [req.user.id]);
        const total = countRows[0]?.total || 0;
        const requests = await query(
            `SELECT c.id, ${otherColumn} AS user_id, c.status, c.created_at,
              u.username, u.full_name, u.profile_image_url
       FROM connections c JOIN users u ON u.id = ${otherColumn}
       WHERE ${userColumn} = ? AND c.status = 'pending'
       ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
            [req.user.id, String(limit), String(offset)]
        );

        return sendSuccess(res, 'Connection requests retrieved', { requests, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (error) {
        next(error);
    }
}

async function listConnections(req, res, next) {
    try {
        const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
        const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 50);
        const offset = (page - 1) * limit;
        const countRows = await query(
            `SELECT COUNT(*) AS total FROM connections WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)`,
            [req.user.id, req.user.id]
        );
        const total = countRows[0]?.total || 0;
        const connections = await query(
            `SELECT c.id, c.status, c.created_at,
              CASE WHEN c.requester_id = ? THEN c.addressee_id ELSE c.requester_id END AS user_id,
              u.username, u.full_name, u.profile_image_url
       FROM connections c
       JOIN users u ON u.id = CASE WHEN c.requester_id = ? THEN c.addressee_id ELSE c.requester_id END
       WHERE c.status = 'accepted' AND (c.requester_id = ? OR c.addressee_id = ?)
       ORDER BY c.updated_at DESC LIMIT ? OFFSET ?`,
            [req.user.id, req.user.id, req.user.id, req.user.id, String(limit), String(offset)]
        );

        return sendSuccess(res, 'Connections retrieved', { connections, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (error) {
        next(error);
    }
}

module.exports = { sendRequest, acceptRequest, rejectRequest, cancelRequest, removeConnection, getStatus, listRequests, listConnections };
