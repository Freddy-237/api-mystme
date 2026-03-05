const { v2: cloudinary } = require('cloudinary');
const logger = require('../utils/logger');

const cloud_name = process.env.CLOUDINARY_CLOUD_NAME;
const api_key = process.env.CLOUDINARY_API_KEY;
const api_secret = process.env.CLOUDINARY_API_SECRET;

if (!cloud_name || !api_key || !api_secret) {
  logger.warn('⚠️  Cloudinary credentials not fully set — media uploads will fail');
}

cloudinary.config({ cloud_name, api_key, api_secret, secure: true });

module.exports = cloudinary;
