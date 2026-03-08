const nodemailer = require('nodemailer');
const SibApiV3Sdk = require('sib-api-v3-sdk');
const env = require('../config/env');
const logger = require('../utils/logger');

let _transporter = null;
let _emailApi = null;

const hasSmtpConfig = () =>
  !!(env.smtpHost && env.smtpPort && env.smtpUser && env.smtpPass && env.mailFrom);

const hasBrevoApiConfig = () => !!env.brevoApiKey;

const hasEmailConfig = () => hasBrevoApiConfig() || hasSmtpConfig();

const parseMailFrom = (rawFrom) => {
  const value = String(rawFrom || '').trim();
  const match = value.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) {
    return {
      name: match[1].trim() || undefined,
      email: match[2].trim(),
    };
  }
  return {
    name: undefined,
    email: value || undefined,
  };
};

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

const getBrevoEmailApi = () => {
  if (!hasBrevoApiConfig()) return null;
  if (_emailApi) return _emailApi;

  const client = SibApiV3Sdk.ApiClient.instance;
  client.authentications['api-key'].apiKey = env.brevoApiKey;

  _emailApi = new SibApiV3Sdk.TransactionalEmailsApi();
  return _emailApi;
};

const sendOtpViaBrevoApi = async ({ to, code, pseudo }) => {
  const emailApi = getBrevoEmailApi();
  if (!emailApi) return false;

  const fallbackFrom = parseMailFrom(env.mailFrom);
  const senderEmail = env.brevoSenderEmail || fallbackFrom.email;
  const senderName = env.brevoSenderName || fallbackFrom.name || 'MystMe';

  if (!senderEmail) {
    throw new Error('BREVO_SENDER_EMAIL or MAIL_FROM is required when BREVO_API_KEY is set');
  }

  await emailApi.sendTransacEmail({
    sender: { email: senderEmail, name: senderName },
    to: [{ email: to }],
    subject: 'Code OTP MystMe',
    htmlContent: [
      `<p>Salut ${pseudo || 'MystMe user'},</p>`,
      '<p>Voici ton code OTP MystMe :</p>',
      `<h2 style="letter-spacing:2px">${code}</h2>`,
      '<p>Ce code expire dans 10 minutes.</p>',
      '<p>Si tu n\'es pas a l\'origine de cette demande, ignore ce message.</p>',
    ].join(''),
  });

  return true;
};

const sendOtpEmail = async ({ to, code, pseudo }) => {
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

  if (hasBrevoApiConfig()) {
    try {
      await sendOtpViaBrevoApi({ to, code, pseudo });
      return { sent: true, debug: false, provider: 'brevo-api' };
    } catch (error) {
      logger.error({ err: error, to }, 'Brevo API send failed, trying SMTP fallback');
    }
  }

  const transporter = getTransporter();

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

  return { sent: true, debug: false, provider: 'smtp' };
};

module.exports = {
  sendOtpEmail,
  hasEmailConfig,
  hasSmtpConfig,
  hasBrevoApiConfig,
};
