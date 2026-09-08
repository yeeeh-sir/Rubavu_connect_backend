const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const { MAX_VIDEO_DURATION } = require('./video');

async function getVideoDuration(buffer, filename = 'video.mp4') {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rubavu_video_'));
  const tempFile = path.join(tempDir, filename);

  try {
    fs.writeFileSync(tempFile, buffer);

    const ffprobe = require('ffprobe-static');
    const { stdout } = await execFileAsync(ffprobe.path, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      tempFile,
    ]);

    const metadata = JSON.parse(stdout);
    const duration = metadata.format && metadata.format.duration
      ? parseFloat(metadata.format.duration)
      : 0;

    return duration;
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

async function validateVideoDuration(buffer, filename = 'video.mp4') {
  const duration = await getVideoDuration(buffer, filename);

  if (duration > MAX_VIDEO_DURATION) {
    const error = new Error(
      `Video duration is ${Math.round(duration)}s. Maximum allowed is ${MAX_VIDEO_DURATION}s.`
    );
    error.statusCode = 400;
    throw error;
  }

  return duration;
}

module.exports = { getVideoDuration, validateVideoDuration, MAX_VIDEO_DURATION };
