const { query, execute } = require('../config/database');
const cloudinary = require('../config/cloudinary');

let cleanupInterval = null;

async function cleanupExpiredStatuses() {
  try {
    const expiredStatuses = await query(
      'SELECT id, media_url FROM statuses WHERE expires_at <= NOW()'
    );

    for (const status of expiredStatuses) {
      if (status.media_url && status.media_url.includes('cloudinary')) {
        try {
          const urlParts = status.media_url.split('/');
          const publicIdWithExt = urlParts.slice(-2).join('/');
          const publicId = publicIdWithExt.replace(/\.[^.]+$/, '');
          const resourceType = status.media_url.includes('video') ? 'video' : 'image';
          await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
        } catch (err) {
          console.error('Error deleting Cloudinary file:', err.message);
        }
      }
    }

    const result = await execute('DELETE FROM statuses WHERE expires_at <= NOW()');
    if (result.affectedRows > 0) {
      console.log(`Cleaned up ${result.affectedRows} expired statuses`);
    }
  } catch (error) {
    console.error('Status cleanup error:', error.message);
  }
}

function startCleanupService() {
  cleanupExpiredStatuses();
  cleanupInterval = setInterval(cleanupExpiredStatuses, 10 * 60 * 1000);
  console.log('Status cleanup service started (runs every 10 minutes)');
}

function stopCleanupService() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    console.log('Status cleanup service stopped');
  }
}

module.exports = { startCleanupService, stopCleanupService, cleanupExpiredStatuses };
