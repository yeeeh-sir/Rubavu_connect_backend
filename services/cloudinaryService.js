const cloudinary = require('../config/cloudinary');
const { v4: uuidv4 } = require('uuid');

function getFolder(type) {
  const folders = {
    profile: 'rubavu_connect/profile',
    post: 'rubavu_connect/posts',
    message: 'rubavu_connect/messages',
    status: 'rubavu_connect/status',
    voice: 'rubavu_connect/voice',
  };
  return folders[type] || 'rubavu_connect/misc';
}

async function uploadBuffer(buffer, type, mimetype) {
  const folder = getFolder(type);
  const publicId = `${type}_${uuidv4()}`;

  return new Promise((resolve, reject) => {
    const isVideo = mimetype && mimetype.startsWith('video/');
    const isAudio = mimetype && mimetype.startsWith('audio/');

    const resourceType = isVideo || isAudio ? 'video' : 'image';

    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: publicId,
        resource_type: resourceType,
        quality: 'auto:best',
        ...(isVideo && {
          eager: [{ streaming_profile: 'hd', format: 'mp4' }],
          video_codec: 'h264',
        }),
        ...(isAudio && {
          audio_codec: 'aac',
          audio_bitrate: '192k',
        }),
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve({
            url: result.secure_url,
            public_id: result.public_id,
            format: result.format,
            resource_type: result.resource_type,
          });
        }
      }
    );

    stream.end(buffer);
  });
}

async function uploadImage(buffer) {
  return uploadBuffer(buffer, 'post', 'image');
}

async function uploadVideo(buffer) {
  return uploadBuffer(buffer, 'post', 'video');
}

async function uploadProfileImage(buffer) {
  return uploadBuffer(buffer, 'profile', 'image');
}

async function uploadMessageMedia(buffer, mimetype) {
  const type = mimetype.startsWith('audio/') ? 'voice' : 'message';
  return uploadBuffer(buffer, type, mimetype);
}

async function uploadStatusMedia(buffer, mimetype) {
  return uploadBuffer(buffer, 'status', mimetype);
}

async function deleteFile(publicId, resourceType = 'image') {
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
    return true;
  } catch (error) {
    console.error('Cloudinary delete error:', error.message);
    return false;
  }
}

module.exports = {
  uploadBuffer,
  uploadImage,
  uploadVideo,
  uploadProfileImage,
  uploadMessageMedia,
  uploadStatusMedia,
  deleteFile,
};
