const nodemailer = require('nodemailer');
const env = require('../config/env');
const logger = require('../utils/logger');

let _transporter = null;

const hasSmtpConfig = () =>
  !!(env.smtpHost && env.smtpPort && env.smtpUser && env.smtpPass && env.mailFrom);

const getTransporter = () => {
  if (!hasSmtpConfig()) return null;
  if (_transporter) return _transporter;

  _transporter = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: {
      user: env.smtpUser,
      pass: env.smtpPass,
    },
  });
  return _transporter;
};

const sendOtpEmail = async ({ to, code, pseudo }) => {
  const transporter = getTransporter();

  const subject = 'Code OTP MystMe';
  const text = [
    `Salut ${pseudo || 'MystMe user'},`,
    '',
    'Voici ton code OTP MystMe :',
    code,
    '',
    'Ce code expire dans 10 minutes.',
    'Si tu n\'es pas a l\'origine de cette demande, ignore ce message.',
  ].join('\n');

  if (!transporter) {
    logger.warn({ to, subject, code }, 'SMTP non configure: OTP email not sent (debug log only)');
    return { sent: false, debug: true };
  }

  await transporter.sendMail({
    from: env.mailFrom,
    to,
    subject,
    text,
  });

  return { sent: true, debug: false };
};

module.exports = {
  sendOtpEmail,
  hasSmtpConfig,
};
