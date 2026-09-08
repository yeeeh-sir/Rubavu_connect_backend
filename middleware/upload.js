const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const {
  isAllowedImage,
  isAllowedVideo,
  isAllowedAudio,
  MAX_IMAGE_SIZE,
  MAX_VIDEO_SIZE,
  MAX_AUDIO_SIZE,
} = require('../utils/video');

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const fieldname = file.fieldname;

  if (fieldname === 'image' || fieldname === 'profile_image') {
    if (isAllowedImage(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid image type. Allowed: jpg, jpeg, png, webp'), false);
    }
  } else if (fieldname === 'media') {
    if (isAllowedImage(file.mimetype) || isAllowedVideo(file.mimetype) || isAllowedAudio(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid media type. Allowed: images, videos, and audio'), false);
    }
  } else if (fieldname === 'video') {
    if (isAllowedVideo(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid video type. Allowed: mp4, webm, mov'), false);
    }
  } else if (fieldname === 'voice' || fieldname === 'audio') {
    if (isAllowedAudio(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid audio type. Allowed: webm, mp3, wav, m4a, ogg'), false);
    }
  } else {
    cb(new Error('Invalid file field'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_VIDEO_SIZE,
  },
});

const uploadImage = upload.single('image');
const uploadProfileImage = upload.single('profile_image');
const uploadMedia = upload.single('media');
const uploadMultipleMedia = upload.array('media', 10);
const uploadVideo = upload.single('video');
const uploadVoice = upload.single('voice');

const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File too large. Maximum size is 50MB.',
      });
    }
    return res.status(400).json({
      success: false,
      message: `Upload error: ${err.message}`,
    });
  }
  if (err) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }
  next();
};

module.exports = {
  upload,
  uploadImage,
  uploadProfileImage,
  uploadMedia,
  uploadMultipleMedia,
  uploadVideo,
  uploadVoice,
  handleUploadError,
};
