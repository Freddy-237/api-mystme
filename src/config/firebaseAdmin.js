const admin = require('firebase-admin');
const logger = require('../utils/logger');

let initialized = false;

const initFirebaseAdmin = () => {
  if (initialized) return true;

  try {
    if (admin.apps.length > 0) {
      initialized = true;
      return true;
    }

    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (serviceAccountJson) {
      const credentials = JSON.parse(serviceAccountJson);
      admin.initializeApp({
        credential: admin.credential.cert(credentials),
      });
      initialized = true;
      return true;
    }

    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
      });
      initialized = true;
      return true;
    }

    return false;
  } catch (error) {
    logger.error({ err: error }, 'firebase admin init failed');
    return false;
  }
};

const getMessaging = () => {
  if (!initFirebaseAdmin()) return null;
  return admin.messaging();
};

module.exports = { getMessaging };
