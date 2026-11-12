#!/usr/bin/env node
/**
 * Configuration Verification Script
 *
 * Displays the current backend configuration state without exposing secrets.
 * Run: node verify-config.js
 */

require('dotenv').config();

const env = require('./src/config/env');

const formatStatus = (value, provider = null) => {
  if (value === true) return '✓ enabled';
  if (value === false) return '✗ disabled';
  if (value === 'brevo') return '→ brevo';
  if (value === 'smtp') return '→ smtp';
  if (value === 'none') return '✗ none configured';
  return value;
};

const logSection = (title) => {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${'─'.repeat(60)}`);
};

const logItem = (label, status, details = '') => {
  console.log(`${label.padEnd(25)} : ${status.padEnd(20)} ${details}`);
};

console.log(`
╔${'═'.repeat(58)}╗
║${'  MystMe Backend Configuration Verification'.padEnd(58)}║
╚${'═'.repeat(58)}╝
`);

// Environment
logSection('Environment');
logItem('NODE_ENV', env.isProduction ? 'production' : 'development');
logItem('Port', String(env.port));

// Database
logSection('Database');
const dbType = env.databaseUrl ? 'Railway (URL)' : 'Individual vars';
logItem('Database URL', env.databaseUrl ? 'configured' : 'not set');
logItem('DB Host', env.db.host);
logItem('DB SSL', env.dbSsl ? 'enabled' : 'disabled');

// JWT & Security
logSection('Security');
logItem('JWT Secret', env.jwtSecret === 'default_secret' ? '⚠ DEFAULT (dev)' : '✓ configured');
logItem('Auth Cookie', env.authCookieName);
logItem('CSRF Protection', 'enabled');

// CORS
logSection('CORS');
logItem('Allowed Origins', env.corsOrigins.length > 0 ? `${env.corsOrigins.length} origin(s)` : 'none configured');
if (env.corsOrigins.length > 0) {
  env.corsOrigins.forEach(origin => {
    console.log(`  └─ ${origin}`);
  });
}

// Cloudinary
logSection('Cloudinary (Media Uploads)');
logItem('Status', env.cloudinaryConfigured ? '✓ configured' : '✗ MISSING');
if (!env.cloudinaryConfigured) {
  console.log('  Required for: image/video/audio/file uploads in messages');
}

// Email
logSection('Email OTP');
logItem('Primary Provider', formatStatus(env.emailProvider));
logItem('├─ Brevo API', env.hasBrevoApiConfig() ? '✓ configured' : '✗ not set');
logItem('└─ SMTP', env.hasSmtpConfig() ? '✓ configured' : '✗ not set');
if (!env.hasEmailConfig()) {
  console.log('  ⚠ No email provider configured - OTP will fail in production');
}

// Moderation
logSection('Moderation');
const modStatus = env.moderationApiKey && env.moderationApiKey !== 'dev-moderation-key'
  ? '✓ configured'
  : '⚠ dev mode';
logItem('Moderation API Key', modStatus);

// Firebase
logSection('Firebase (Push Notifications)');
const fbServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
logItem('Service Account', fbServiceAccount ? '✓ configured' : '✗ not set');

// Sentry
logSection('Sentry (Error Tracking)');
const sentryDsn = process.env.SENTRY_DSN;
logItem('Sentry DSN', sentryDsn ? '✓ configured' : '✗ disabled');

// Summary
logSection('Production Readiness Checklist');
const checks = [
  { label: 'JWT Secret', pass: env.jwtSecret !== 'default_secret' },
  { label: 'CORS Origins', pass: env.corsOrigins.length > 0 },
  { label: 'Database', pass: !!env.databaseUrl || (env.db.host && env.db.user) },
  { label: 'Cloudinary', pass: env.cloudinaryConfigured },
  { label: 'Email (OTP)', pass: env.hasEmailConfig() },
  { label: 'Moderation API', pass: env.moderationApiKey && env.moderationApiKey !== 'dev-moderation-key' },
];

checks.forEach(check => {
  const icon = check.pass ? '✓' : '✗';
  console.log(`${icon} ${check.label.padEnd(25)}`);
});

const passedCount = checks.filter(c => c.pass).length;
const totalCount = checks.length;
const readinessPercent = Math.round((passedCount / totalCount) * 100);

console.log(`\n${'─'.repeat(60)}`);
console.log(`Production Readiness: ${readinessPercent}% (${passedCount}/${totalCount})`);
console.log(`${'─'.repeat(60)}\n`);

// Recommendations
if (readinessPercent < 100) {
  console.log('⚠ Recommendations for Production:');
  checks.forEach(check => {
    if (!check.pass) {
      if (check.label === 'JWT Secret') {
        console.log('  • Set JWT_SECRET to a strong random value');
      } else if (check.label === 'CORS Origins') {
        console.log('  • Set CORS_ORIGINS to your actual domain(s)');
      } else if (check.label === 'Database') {
        console.log('  • Configure DATABASE_URL or individual DB_* variables');
      } else if (check.label === 'Cloudinary') {
        console.log('  • Get Cloudinary API keys from https://cloudinary.com');
      } else if (check.label === 'Email (OTP)') {
        console.log('  • Set BREVO_API_KEY or SMTP_* variables for email delivery');
      } else if (check.label === 'Moderation API') {
        console.log('  • Set MODERATION_API_KEY to your moderation provider key');
      }
    }
  });
  console.log();
}

process.exit(readinessPercent === 100 ? 0 : 1);
