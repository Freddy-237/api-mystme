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

module.exports = { uploadVideo, uploadImage, uploadFile, uploadAudio };
