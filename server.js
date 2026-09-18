require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const routes = require('./routes');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api', routes);
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ ok: true }));

// The admin dashboard is not linked from anywhere on the public site. It
// only opens for someone holding the exact secret token below — share that
// link only via the email it's sent to (see scripts/send-admin-link.js).
app.get('/admin-panel', (req, res) => {
  if (!process.env.ADMIN_ACCESS_TOKEN || req.query.token !== process.env.ADMIN_ACCESS_TOKEN) {
    return res.status(404).send('Not found');
  }
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Swift Market backend running on port ${PORT}`));

// Set CRON_ENABLED=false in .env to disable (e.g. if you run this app as
// multiple instances behind a load balancer and only want one of them
// running the scheduled job).
if (process.env.CRON_ENABLED !== 'false') {
  require('./cron').start();
}
