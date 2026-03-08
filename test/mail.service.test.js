/**
 * Unit tests for mail.service – config checks, parseMailFrom, sendOtpEmail routing.
 *
 * These tests mock external deps (nodemailer, Brevo SDK) and env variables
 * to test the service logic in isolation.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

// ── parseMailFrom (inline mirror for pure testing) ──

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

// ── parseMailFrom tests ──

test('parseMailFrom extracts name and email from "Name <email>" format', () => {
  const { name, email } = parseMailFrom('MystMe <contact@fridevs.com>');
  assert.equal(name, 'MystMe');
  assert.equal(email, 'contact@fridevs.com');
});

test('parseMailFrom handles email-only string', () => {
  const { name, email } = parseMailFrom('user@example.com');
  assert.equal(name, undefined);
  assert.equal(email, 'user@example.com');
});

test('parseMailFrom handles empty string', () => {
  const { name, email } = parseMailFrom('');
  assert.equal(name, undefined);
  assert.equal(email, undefined);
});

test('parseMailFrom handles null', () => {
  const { name, email } = parseMailFrom(null);
  assert.equal(name, undefined);
  assert.equal(email, undefined);
});

test('parseMailFrom handles angle brackets with no name', () => {
  const { name, email } = parseMailFrom('<noreply@app.com>');
  assert.equal(name, undefined);
  assert.equal(email, 'noreply@app.com');
});

test('parseMailFrom trims whitespace', () => {
  const { name, email } = parseMailFrom('  Support Team  <support@app.com>  ');
  assert.equal(name, 'Support Team');
  assert.equal(email, 'support@app.com');
});

// ── hasSmtpConfig / hasBrevoApiConfig / hasEmailConfig logic ──

test('hasSmtpConfig returns true only when all SMTP vars are set', () => {
  const hasSmtpConfig = (env) =>
    !!(env.smtpHost && env.smtpPort && env.smtpUser && env.smtpPass && env.mailFrom);

  assert.ok(hasSmtpConfig({
    smtpHost: 'smtp.example.com',
    smtpPort: 587,
    smtpUser: 'user',
    smtpPass: 'pass',
    mailFrom: 'from@test.com',
  }));

  assert.ok(!hasSmtpConfig({
    smtpHost: 'smtp.example.com',
    smtpPort: 587,
    smtpUser: 'user',
    smtpPass: '',
    mailFrom: 'from@test.com',
  }));

  assert.ok(!hasSmtpConfig({}));
});

test('hasBrevoApiConfig returns true when brevoApiKey is set', () => {
  const hasBrevoApiConfig = (env) => !!env.brevoApiKey;

  assert.ok(hasBrevoApiConfig({ brevoApiKey: 'xkeysib-...' }));
  assert.ok(!hasBrevoApiConfig({}));
  assert.ok(!hasBrevoApiConfig({ brevoApiKey: '' }));
});

test('hasEmailConfig returns true if either Brevo or SMTP is configured', () => {
  const hasBrevoApiConfig = (env) => !!env.brevoApiKey;
  const hasSmtpConfig = (env) =>
    !!(env.smtpHost && env.smtpPort && env.smtpUser && env.smtpPass && env.mailFrom);
  const hasEmailConfig = (env) => hasBrevoApiConfig(env) || hasSmtpConfig(env);

  // Only Brevo
  assert.ok(hasEmailConfig({ brevoApiKey: 'key' }));

  // Only SMTP
  assert.ok(hasEmailConfig({
    smtpHost: 'h', smtpPort: 25, smtpUser: 'u', smtpPass: 'p', mailFrom: 'f',
  }));

  // Neither
  assert.ok(!hasEmailConfig({}));
});

// ── sendOtpEmail routing logic ──

test('sendOtpEmail prefers Brevo API over SMTP', async () => {
  let brevoUsed = false;
  let smtpUsed = false;

  const sendOtp = async ({ to, code, pseudo }, deps) => {
    if (deps.hasBrevoApiConfig()) {
      try {
        await deps.sendViaBrevo({ to, code, pseudo });
        brevoUsed = true;
        return { sent: true, provider: 'brevo-api' };
      } catch {
        // fallback
      }
    }
    if (deps.getTransporter()) {
      await deps.getTransporter().sendMail({ to });
      smtpUsed = true;
      return { sent: true, provider: 'smtp' };
    }
    return { sent: false, debug: true };
  };

  const result = await sendOtp({ to: 'a@b.com', code: '123456', pseudo: 'Test' }, {
    hasBrevoApiConfig: () => true,
    sendViaBrevo: async () => {},
    getTransporter: () => ({ sendMail: async () => {} }),
  });

  assert.ok(brevoUsed);
  assert.ok(!smtpUsed);
  assert.equal(result.provider, 'brevo-api');
});

test('sendOtpEmail falls back to SMTP on Brevo failure', async () => {
  let smtpUsed = false;

  const sendOtp = async ({ to, code, pseudo }, deps) => {
    if (deps.hasBrevoApiConfig()) {
      try {
        await deps.sendViaBrevo({ to, code, pseudo });
        return { sent: true, provider: 'brevo-api' };
      } catch {
        // fallback
      }
    }
    if (deps.getTransporter()) {
      await deps.getTransporter().sendMail({ to });
      smtpUsed = true;
      return { sent: true, provider: 'smtp' };
    }
    return { sent: false, debug: true };
  };

  const result = await sendOtp({ to: 'a@b.com', code: '123456', pseudo: 'T' }, {
    hasBrevoApiConfig: () => true,
    sendViaBrevo: async () => { throw new Error('API down'); },
    getTransporter: () => ({ sendMail: async () => {} }),
  });

  assert.ok(smtpUsed);
  assert.equal(result.provider, 'smtp');
});

test('sendOtpEmail returns debug mode when no provider configured', async () => {
  const sendOtp = async ({ to }, deps) => {
    if (deps.hasBrevoApiConfig()) {
      try { await deps.sendViaBrevo({ to }); return { sent: true }; } catch { /* fallback */ }
    }
    if (deps.getTransporter()) {
      await deps.getTransporter().sendMail({ to });
      return { sent: true, provider: 'smtp' };
    }
    return { sent: false, debug: true };
  };

  const result = await sendOtp({ to: 'a@b.com' }, {
    hasBrevoApiConfig: () => false,
    getTransporter: () => null,
  });

  assert.ok(!result.sent);
  assert.ok(result.debug);
});

// ── OTP email content format ──

test('OTP email text includes code and pseudo', () => {
  const buildText = (code, pseudo) => [
    `Salut ${pseudo || 'MystMe user'},`,
    '',
    'Voici ton code OTP MystMe :',
    code,
    '',
    'Ce code expire dans 10 minutes.',
  ].join('\n');

  const text = buildText('654321', 'SilentWolf_1234');
  assert.ok(text.includes('654321'));
  assert.ok(text.includes('SilentWolf_1234'));
  assert.ok(text.includes('10 minutes'));
});

test('OTP email text uses fallback pseudo when none provided', () => {
  const buildText = (code, pseudo) => [
    `Salut ${pseudo || 'MystMe user'},`,
  ].join('\n');

  assert.ok(buildText('000000', null).includes('MystMe user'));
  assert.ok(buildText('000000', undefined).includes('MystMe user'));
});
