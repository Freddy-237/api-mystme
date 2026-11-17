/**
 * Cloudinary upload helpers — extracted from message.controller.js.
 */
const cloudinary = require('../config/cloudinary');
const logger = require('../utils/logger');

const uploadStream = (buffer, options) =>
  new Promise((resolve, reject) => {
    logger.info(
      {
        folder: options.folder,
        resourceType: options.resource_type,
        publicId: options.public_id,
        bytes: buffer?.length || 0,
      },
      'Cloudinary upload start',
    );
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error || !result) {
        logger.error(
          {
            err: error,
            folder: options.folder,
            resourceType: options.resource_type,
            publicId: options.public_id,
            bytes: buffer?.length || 0,
          },
          'Cloudinary upload callback failed',
        );
        return reject(error || new Error('Upload Cloudinary échoué'));
      }
      logger.info(
        {
          folder: options.folder,
          resourceType: options.resource_type,
          publicId: options.public_id,
          secureUrl: result.secure_url,
          bytes: result.bytes,
          format: result.format,
        },
        'Cloudinary upload success',
      );
      resolve(result.secure_url);
    });
    stream.end(buffer);
  });

const uploadVideo = (buffer, conversationId) =>
  uploadStream(buffer, {
    folder: 'mystme/messages/videos',
    resource_type: 'video',
    public_id: `${conversationId}_${Date.now()}`,
  });

const uploadImage = (buffer, conversationId) =>
  uploadStream(buffer, {
    folder: 'mystme/messages/images',
    resource_type: 'image',
    public_id: `${conversationId}_${Date.now()}`,
  });

const uploadFile = (buffer, conversationId) =>
  uploadStream(buffer, {
    folder: 'mystme/messages/files',
    resource_type: 'raw',
    public_id: `${conversationId}_${Date.now()}`,
  });

const uploadAudio = (buffer, conversationId) =>
  uploadStream(buffer, {
    folder: 'mystme/messages/audio',
    resource_type: 'video',
    public_id: `${conversationId}_${Date.now()}`,
  });

// ── Deletion ────────────────────────────────────────────────────────────────
const RESOURCE_TYPE_BY_MEDIA = { image: 'image', video: 'video', audio: 'video', file: 'raw' };
const OWN_FOLDER = 'mystme/messages/';

/**
 * Cloudinary public id of one of OUR uploads, from its delivery URL.
 * Returns null for anything that is not under mystme/messages/.
 */
const publicIdFromUrl = (url, mediaType) => {
  const resourceType = RESOURCE_TYPE_BY_MEDIA[mediaType];
  if (!resourceType || typeof url !== 'string') return null;

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(url).pathname);
  } catch (_) {
    return null;
  }

  const match = /\/upload\/(?:v\d+\/)?(.+)$/.exec(pathname);
  if (!match || !match[1].startsWith(OWN_FOLDER)) return null;

  // Raw files keep their extension in the public id; images/videos do not.
  const publicId = resourceType === 'raw' ? match[1] : match[1].replace(/\.[a-z0-9]+$/i, '');
  return { publicId, resourceType };
};

/** Best effort: never throws, returns how many files were removed. */
const deleteMedia = async (items) => {
  let deleted = 0;
  for (const item of items || []) {
    const target = publicIdFromUrl(item.media_url, item.media_type);
    if (!target) continue;
    try {
      await cloudinary.uploader.destroy(target.publicId, {
        resource_type: target.resourceType,
        invalidate: true,
      });
      deleted += 1;
    } catch (error) {
      logger.warn({ err: error, publicId: target.publicId }, 'Cloudinary delete failed');
    }
  }
  return deleted;
};

module.exports = {
  uploadVideo,
  uploadImage,
  uploadFile,
  uploadAudio,
  publicIdFromUrl,
  deleteMedia,
};
