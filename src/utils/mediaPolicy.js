/**
 * Which uploads we accept. Every upload becomes a public Cloudinary URL, so
 * only formats that are safe to re-serve are allowed. SVG/HTML/JS are refused
 * everywhere because they can embed scripts (phishing / XSS hosting).
 * Shared by the HTTP upload routes and the socket `send_media` event.
 */
const baseMime = (mimetype) => String(mimetype || '').split(';')[0].trim().toLowerCase();

const extensionOf = (filename) => {
  const match = /\.([a-z0-9]+)$/i.exec(String(filename || ''));
  return match ? match[1].toLowerCase() : '';
};

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif']);
const VIDEO_MIMES = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp', 'video/x-m4v']);
const FILE_EXTENSIONS = new Set(['pdf', 'txt', 'csv', 'rtf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp']);
const BLOCKED_EXTENSIONS = new Set(['svg', 'svgz', 'html', 'htm', 'xhtml', 'js', 'mjs']);
const BLOCKED_MIMES = new Set(['text/html', 'application/xhtml+xml', 'image/svg+xml', 'application/javascript', 'text/javascript']);

const isAllowedImage = ({ mimetype }) => IMAGE_MIMES.has(baseMime(mimetype));
const isAllowedVideo = ({ mimetype }) => VIDEO_MIMES.has(baseMime(mimetype));
const isAllowedAudio = ({ mimetype }) => baseMime(mimetype).startsWith('audio/');
const isAllowedFile = ({ mimetype, originalname }) =>
  FILE_EXTENSIONS.has(extensionOf(originalname)) && !BLOCKED_MIMES.has(baseMime(mimetype));

/** Socket payloads carry no MIME type: judge by filename extension. */
const isAllowedSocketMedia = (mediaType, filename) => {
  const ext = extensionOf(filename);
  if (BLOCKED_EXTENSIONS.has(ext)) return false;
  if (mediaType === 'file') return FILE_EXTENSIONS.has(ext);
  return true; // image/audio/video: Cloudinary validates the actual content
};

module.exports = {
  baseMime,
  extensionOf,
  isAllowedImage,
  isAllowedVideo,
  isAllowedAudio,
  isAllowedFile,
  isAllowedSocketMedia,
  FILE_EXTENSIONS,
};
