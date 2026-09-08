const { isAllowedImage, isAllowedVideo, isAllowedAudio, MAX_VIDEO_DURATION } = require('../utils/video');

describe('Video Duration Validation', () => {
  test('MAX_VIDEO_DURATION should be 30 seconds', () => {
    expect(MAX_VIDEO_DURATION).toBe(30);
  });

  test('isAllowedImage should accept valid image types', () => {
    expect(isAllowedImage('image/jpeg')).toBe(true);
    expect(isAllowedImage('image/png')).toBe(true);
    expect(isAllowedImage('image/webp')).toBe(true);
  });

  test('isAllowedImage should reject invalid types', () => {
    expect(isAllowedImage('text/plain')).toBe(false);
    expect(isAllowedImage('application/pdf')).toBe(false);
  });

  test('isAllowedVideo should accept valid video types', () => {
    expect(isAllowedVideo('video/mp4')).toBe(true);
    expect(isAllowedVideo('video/webm')).toBe(true);
    expect(isAllowedVideo('video/quicktime')).toBe(true);
  });

  test('isAllowedVideo should reject invalid types', () => {
    expect(isAllowedVideo('text/plain')).toBe(false);
    expect(isAllowedVideo('audio/mp3')).toBe(false);
  });

  test('isAllowedAudio should accept valid audio types', () => {
    expect(isAllowedAudio('audio/webm')).toBe(true);
    expect(isAllowedAudio('audio/mpeg')).toBe(true);
    expect(isAllowedAudio('audio/wav')).toBe(true);
    expect(isAllowedAudio('audio/mp4')).toBe(true);
    expect(isAllowedAudio('audio/ogg')).toBe(true);
  });

  test('isAllowedAudio should reject invalid types', () => {
    expect(isAllowedAudio('video/mp4')).toBe(false);
    expect(isAllowedAudio('text/plain')).toBe(false);
  });
});
