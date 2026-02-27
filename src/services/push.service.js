const identityRepository = require('../modules/identity/identity.repository');
const { getMessaging } = require('../config/firebaseAdmin');
const logger = require('../utils/logger');

const sendPushToUser = async ({ userId, title, body, data = {} }) => {
  const user = await identityRepository.findById(userId);
  if (!user || !user.push_token) return false;

  const messaging = getMessaging();
  if (!messaging) return false;

  try {
    await messaging.send({
      token: user.push_token,
      notification: { title, body },
      data,
    });
    return true;
  } catch (error) {
    logger.error({ err: error, userId }, 'push send failed');
    return false;
  }
};

module.exports = {
  sendPushToUser,
};
