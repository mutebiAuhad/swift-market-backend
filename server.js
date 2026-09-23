require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { migrate } = require('./db');
const { geoBlockMiddleware } = require('./geoblock');
const apiRoutes = require('./routes');

const app = express();
app.set('trust proxy', 1); // Render sits behind a proxy; needed for correct req.ip and geo-blocking

// Catches errors that would otherwise silently kill the process, and logs them
// so they show up in Render's Logs tab instead of just "Application failed".
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));

app.use(helmet({
  contentSecurityPolicy: false // the SPA loads its own inline scripts; tighten this once the frontend is finalized
}));
app.use(geoBlockMiddleware); // blocks EAC countries before anything else runs, including static files
app.use(cors());

// Stripe needs the raw, unparsed body to verify webhook signatures. Because this raw
// parser is scoped to this exact path and mounted first, express.json() below sees the
// body already parsed (body-parser sets req._body internally) and skips re-parsing it —
// so this route gets a Buffer in req.body while every other /api route gets normal JSON.
app.use('/api/subscription/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '2mb' }));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/admin/login', authLimiter);
app.use('/api/auth/forgot', authLimiter);

app.use('/api', apiRoutes);

// Admin panel is never linked from the public site — only reachable if you have the
// secret token, e.g. https://your-app.onrender.com/admin-panel?token=xxxxx
// The HTML itself is gated; admin.js contains no secrets (all real authorization
// happens against ADMIN_EMAIL/ADMIN_PASSWORD_HASH on the API side) so it's served
// plainly alongside it.
app.get('/admin-panel', (req, res) => {
  if (!process.env.ADMIN_ACCESS_TOKEN || req.query.token !== process.env.ADMIN_ACCESS_TOKEN) {
    return res.status(404).send('Not found');
  }
  res.sendFile(path.join(__dirname, 'private', 'admin.html'));
});
app.get('/admin-panel/admin.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'private', 'admin.js'));
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;

migrate()
  .then(() => {
    app.listen(PORT, () => console.log(`[server] Swift Market listening on port ${PORT}`));
    require('./cron').startCron();
  })
  .catch(err => {
    console.error('FATAL: database migration failed, server not starting.', err);
    process.exit(1);
  });
