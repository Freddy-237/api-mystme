#!/usr/bin/env node
/**
 * MystMe Backend Configuration Guide
 *
 * Interactive guide to help configure the backend for production.
 * Run: node setup-guide.js
 */

const readline = require('readline');
const path = require('path');
const fs = require('fs');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const ask = (question) => {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
};

const log = {
  title: (text) => console.log(`\n${'═'.repeat(60)}\n  ${text}\n${'═'.repeat(60)}\n`),
  section: (text) => console.log(`\n${'─'.repeat(60)}\n  ${text}\n${'─'.repeat(60)}\n`),
  success: (text) => console.log(`✓ ${text}`),
  error: (text) => console.log(`✗ ${text}`),
  info: (text) => console.log(`ℹ ${text}`),
  warn: (text) => console.log(`⚠ ${text}`),
  code: (text) => console.log(`\n  ${text}\n`),
};

const configs = {
  cors: null,
  cloudinary: null,
  email: null,
  moderation: null,
};

const startGuide = async () => {
  console.clear();
  log.title('MystMe Backend Setup Guide');

  console.log('This guide will help you configure the backend for production.\n');
  console.log('▶ CORS Configuration');
  console.log('▶ Cloudinary (Media Uploads)');
  console.log('▶ Email Provider (Brevo or SMTP)');
  console.log('▶ Moderation API\n');

  const start = await ask('Ready to configure? (yes/no): ');

  if (start.toLowerCase() !== 'yes') {
    console.log('\nSetup cancelled.');
    rl.close();
    process.exit(0);
  }

  await configureCORS();
  await configureCloudinary();
  await configureEmail();
  await configureModeration();
  await summary();
};

const configureCORS = async () => {
  log.section('1. CORS Configuration (Allowed Origins)');

  console.log('CORS (Cross-Origin Resource Sharing) controls which domains can access your API.\n');
  console.log('Examples:');
  log.code('CORS_ORIGINS=https://mystme.app,https://www.mystme.app');
  console.log('For local dev:');
  log.code('CORS_ORIGINS=http://localhost:5173,http://localhost:3000');

  const origins = await ask('\nEnter your CORS origins (comma-separated): ');

  if (origins.trim()) {
    configs.cors = origins.trim();
    log.success(`CORS configured: ${origins.trim()}`);
  } else {
    log.warn('No CORS origins provided - API will reject cross-origin requests');
  }
};

const configureCloudinary = async () => {
  log.section('2. Cloudinary Configuration (Media Uploads)');

  console.log('Cloudinary stores images, videos, audio, and files uploaded in messages.\n');
  console.log('Steps to get your API keys:');
  console.log('  1. Go to https://cloudinary.com/console/settings/api-keys');
  console.log('  2. Copy your Cloud Name, API Key, and API Secret');
  console.log('  3. Paste them below\n');

  const cloudName = await ask('Cloud Name: ');
  const apiKey = await ask('API Key: ');
  const apiSecret = await ask('API Secret (will not be displayed): ');

  if (cloudName && apiKey && apiSecret) {
    configs.cloudinary = { cloudName, apiKey, apiSecret };
    log.success('Cloudinary configured');
  } else {
    log.warn('Incomplete Cloudinary config - media uploads will fail');
  }
};

const configureEmail = async () => {
  log.section('3. Email Configuration (OTP & Notifications)');

  console.log('Email is required for:');
  console.log('  • Account recovery (email-based OTP)');
  console.log('  • Cross-device authentication\n');

  console.log('Two options available:');
  console.log('  [1] Brevo API (recommended for production)');
  console.log('  [2] SMTP (traditional email server)\n');

  const choice = await ask('Choose your email provider (1 or 2): ');

  if (choice === '1') {
    await configureBrevo();
  } else if (choice === '2') {
    await configureSMTP();
  } else {
    log.warn('Invalid choice - email provider not configured');
  }
};

const configureBrevo = async () => {
  console.log('\n─── Brevo Setup ───\n');
  console.log('Steps to get your API key:');
  console.log('  1. Go to https://app.brevo.com/settings/keys/api');
  console.log('  2. Copy your API Key');
  console.log('  3. Paste it below\n');

  const apiKey = await ask('Brevo API Key (will not be displayed): ');
  const senderEmail = await ask('Sender Email (e.g., no-reply@mystme.app): ');
  const senderName = await ask('Sender Name (default: MystMe): ') || 'MystMe';

  if (apiKey && senderEmail) {
    configs.email = {
      type: 'brevo',
      brevoApiKey: apiKey,
      brevoSenderEmail: senderEmail,
      brevoSenderName: senderName,
    };
    log.success('Brevo configured');
  } else {
    log.error('Incomplete Brevo configuration');
  }
};

const configureSMTP = async () => {
  console.log('\n─── SMTP Setup ───\n');
  console.log('Common providers:');
  console.log('  Gmail: smtp.gmail.com:587');
  console.log('  Outlook: smtp-mail.outlook.com:587');
  console.log('  Custom: your-mail-server.com\n');

  const host = await ask('SMTP Host: ');
  const port = await ask('SMTP Port (587 or 465): ') || '587';
  const secure = (await ask('Use SSL? (yes/no): ')).toLowerCase() === 'yes';
  const user = await ask('SMTP Username: ');
  const pass = await ask('SMTP Password (will not be displayed): ');
  const mailFrom = await ask('Mail From (e.g., "MystMe <no-reply@mystme.app>"): ');

  if (host && user && pass && mailFrom) {
    configs.email = {
      type: 'smtp',
      smtpHost: host,
      smtpPort: port,
      smtpSecure: secure,
      smtpUser: user,
      smtpPass: pass,
      mailFrom: mailFrom,
    };
    log.success('SMTP configured');
  } else {
    log.error('Incomplete SMTP configuration');
  }
};

const configureModeration = async () => {
  log.section('4. Moderation API Configuration');

  console.log('Moderation happens in the back-office (admin.myst-me.com), with individual');
  console.log('accounts and two-factor authentication. Create the first owner with:');
  console.log('  npm run admin:create -- --email <email> --name "<nom>"\n');
};

const summary = async () => {
  log.section('Configuration Summary');

  const envContent = buildEnvContent();

  console.log('Your new environment variables:\n');
  console.log(envContent);

  const save = await ask('\nSave to .env file? (yes/no): ');

  if (save.toLowerCase() === 'yes') {
    await saveEnv(envContent);
  } else {
    console.log('\nConfiguration not saved. Here\'s what to add to .env:\n');
    console.log(envContent);
  }

  rl.close();
};

const buildEnvContent = () => {
  let content = '';

  if (configs.cors) {
    content += `CORS_ORIGINS=${configs.cors}\n`;
  }

  if (configs.cloudinary) {
    content += `CLOUDINARY_CLOUD_NAME=${configs.cloudinary.cloudName}\n`;
    content += `CLOUDINARY_API_KEY=${configs.cloudinary.apiKey}\n`;
    content += `CLOUDINARY_API_SECRET=${configs.cloudinary.apiSecret}\n`;
  }

  if (configs.email) {
    if (configs.email.type === 'brevo') {
      content += `BREVO_API_KEY=${configs.email.brevoApiKey}\n`;
      content += `BREVO_SENDER_EMAIL=${configs.email.brevoSenderEmail}\n`;
      content += `BREVO_SENDER_NAME=${configs.email.brevoSenderName}\n`;
    } else {
      content += `SMTP_HOST=${configs.email.smtpHost}\n`;
      content += `SMTP_PORT=${configs.email.smtpPort}\n`;
      content += `SMTP_SECURE=${configs.email.smtpSecure ? 'true' : 'false'}\n`;
      content += `SMTP_USER=${configs.email.smtpUser}\n`;
      content += `SMTP_PASS=${configs.email.smtpPass}\n`;
      content += `MAIL_FROM=${configs.email.mailFrom}\n`;
    }
  }

  return content;
};

const saveEnv = async (content) => {
  try {
    const envPath = path.join(__dirname, '.env');

    // Read existing .env if it exists
    let existing = '';
    if (fs.existsSync(envPath)) {
      existing = fs.readFileSync(envPath, 'utf8');
    }

    // Merge: update existing keys, add new ones
    const lines = existing.split('\n');
    const keysToUpdate = new Set();

    content.split('\n').forEach(line => {
      if (line.includes('=')) {
        const key = line.split('=')[0];
        keysToUpdate.add(key);
      }
    });

    let merged = lines
      .filter(line => {
        if (!line.includes('=')) return true;
        const key = line.split('=')[0];
        return !keysToUpdate.has(key);
      })
      .join('\n');

    if (merged && !merged.endsWith('\n')) merged += '\n';
    merged += content;

    fs.writeFileSync(envPath, merged);

    log.success('.env file updated successfully!');
    console.log(`Location: ${envPath}\n`);

    // Show next steps
    log.section('Next Steps');
    console.log('1. Verify configuration:');
    log.code('npm run verify-config');

    console.log('2. Start the backend:');
    log.code('npm run dev');

    console.log('3. Test the health endpoint:');
    log.code('curl http://localhost:5000/health');

  } catch (error) {
    log.error(`Failed to save .env: ${error.message}`);

    log.section('Manual Setup');
    console.log('Copy this content to your .env file:\n');
    console.log(content);
  }
};

// Start the guide
startGuide().catch(error => {
  console.error('Setup error:', error);
  rl.close();
  process.exit(1);
});
