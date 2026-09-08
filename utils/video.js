const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const ALLOWED_AUDIO_TYPES = ['audio/webm', 'audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/ogg'];

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_VIDEO_SIZE = 50 * 1024 * 1024;
const MAX_AUDIO_SIZE = 10 * 1024 * 1024;
const MAX_VIDEO_DURATION = 30;

function isAllowedImage(mimeType) {
  return ALLOWED_IMAGE_TYPES.includes(mimeType);
}

function isAllowedVideo(mimeType) {
  return ALLOWED_VIDEO_TYPES.includes(mimeType);
}

function isAllowedAudio(mimeType) {
  return ALLOWED_AUDIO_TYPES.includes(mimeType);
}

module.exports = {
  ALLOWED_IMAGE_TYPES,
  ALLOWED_VIDEO_TYPES,
  ALLOWED_AUDIO_TYPES,
  MAX_IMAGE_SIZE,
  MAX_VIDEO_SIZE,
  MAX_AUDIO_SIZE,
  MAX_VIDEO_DURATION,
  isAllowedImage,
  isAllowedVideo,
  isAllowedAudio,
};
