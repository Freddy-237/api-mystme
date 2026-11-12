# MystMe Backend Configuration Guide

## Quick Start

Run the interactive setup guide:

```bash
npm run setup
```

Or configure manually following the steps below.

---

## Step 1: CORS Configuration

CORS (Cross-Origin Resource Sharing) controls which domains can access your API.

### Where to set it
Edit `.env` and update `CORS_ORIGINS`:

```env
CORS_ORIGINS=https://mystme.app,https://www.mystme.app
```

### For local development:
```env
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
```

### Test it
```bash
curl http://localhost:5000/health -H "Origin: https://mystme.app"
```

---

## Step 2: Cloudinary Configuration (Media Uploads)

Cloudinary stores images, videos, audio files, and documents uploaded in messages.

### Get your keys
1. Go to https://cloudinary.com/console/settings/api-keys
2. Sign up or log in
3. Copy your **Cloud Name**, **API Key**, and **API Secret**

### Add to `.env`
```env
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

### Test it
```bash
npm run verify-config
```
Look for `Cloudinary Status: ✓ configured`

---

## Step 3: Email Provider (OTP & Account Recovery)

Email is required for account recovery and cross-device authentication via OTP.

### Option A: Brevo API (Recommended for Production)

**Advantages:**
- Managed service (no SMTP server needed)
- Better deliverability
- Dedicated support

**Steps:**
1. Go to https://app.brevo.com/settings/keys/api
2. Sign up or log in
3. Copy your **API Key**
4. Add to `.env`:

```env
BREVO_API_KEY=xkeysib-your-api-key
BREVO_SENDER_EMAIL=no-reply@mystme.app
BREVO_SENDER_NAME=MystMe
```

### Option B: SMTP (Traditional Email Server)

**Common providers:**
- **Gmail:** smtp.gmail.com:587
- **Outlook:** smtp-mail.outlook.com:587
- **SendGrid:** smtp.sendgrid.net:587
- **Your own server:** your-mail-server.com

**Steps:**
1. Get SMTP credentials from your email provider
2. Add to `.env`:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
MAIL_FROM="MystMe <no-reply@mystme.app>"
```

### Test Email Configuration
```bash
npm run verify-config
```
Look for `Email OTP: Primary Provider → brevo` or `→ smtp`

---

## Step 4: Moderation API

The Moderation API protects your app from abuse and spam.

### Generate a strong key
```bash
# On Windows/PowerShell
$([System.Guid]::NewGuid().ToString() -replace '-','') + $([System.Guid]::NewGuid().ToString() -replace '-','')

# On Mac/Linux
openssl rand -base64 32
```

### Add to `.env`
```env
MODERATION_API_KEY=your_strong_random_key_32_chars_or_more
```

### For development
Use the default:
```env
MODERATION_API_KEY=dev-moderation-key
```

---

## Verify Everything

After configuring, check your setup:

```bash
npm run verify-config
```

Expected output:
```
Production Readiness Checklist
─────────────────────────────
✓ JWT Secret
✓ CORS Origins
✓ Database
✓ Cloudinary
✓ Email (OTP)
✓ Moderation API
─────────────────────────────
Production Readiness: 100% (6/6)
```

---

## Next Steps

1. **Start the backend:**
   ```bash
   npm run dev
   ```

2. **Test the health endpoint:**
   ```bash
   curl http://localhost:5000/health
   ```

3. **Check email sending (OTP):**
   - Send a request to create an OTP
   - You should receive an email

4. **Check media uploads (Cloudinary):**
   - Upload an image/video in a message
   - It should appear in your Cloudinary dashboard

---

## Troubleshooting

### Email not sending?
- Verify `BREVO_API_KEY` or `SMTP_*` variables are set
- Check sender email is verified in Brevo or SMTP provider
- Look at backend logs for errors

### Cloudinary uploads failing?
- Verify all three Cloudinary variables are set
- Check your Cloudinary credentials are correct
- Ensure storage quota isn't exceeded

### CORS errors?
- Make sure your frontend URL is in `CORS_ORIGINS`
- Separate multiple origins with commas
- Include protocol (http:// or https://)

---

## Security Checklist

- [ ] `JWT_SECRET` is a strong random value (min 32 chars)
- [ ] `CORS_ORIGINS` only includes your domains (not `*`)
- [ ] Email password is not checked into git (use `.env`)
- [ ] `MODERATION_API_KEY` is a strong random value in production
- [ ] All `.env` variables are added to your deployment environment

---

## Commands Reference

| Command | Purpose |
|---------|---------|
| `npm run setup` | Interactive setup guide |
| `npm run verify-config` | Check current configuration state |
| `npm run dev` | Start backend in development mode |
| `npm run start` | Start backend in production mode |
| `npm test` | Run all tests |
| `npm run migrate` | Run database migrations |

---

## Questions?

Check the backend logs:
```bash
npm run dev
```

Test the health endpoint:
```bash
curl -s http://localhost:5000/health | node -e "console.log(JSON.stringify(JSON.parse(require('fs').readFileSync(0, 'utf-8')), null, 2))"
```

Or check the `.env.example` file for detailed explanations of each variable.
