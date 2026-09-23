const geoip = require('geoip-lite');

// ISO country codes for the East African Community member states.
const BLOCKED_COUNTRIES = new Set(
  (process.env.BLOCKED_COUNTRY_CODES || 'UG,KE,TZ,RW,BI,SS,CD,SO')
    .split(',')
    .map(c => c.trim().toUpperCase())
    .filter(Boolean)
);

function getClientIp(req) {
  // Render (and most hosts) sit behind a proxy, so the real client IP is in
  // X-Forwarded-For. app.set('trust proxy', 1) in server.js makes req.ip resolve
  // this correctly already; this is a fallback in case that's ever misconfigured.
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.ip;
}

function geoBlockMiddleware(req, res, next) {
  const ip = getClientIp(req);

  // Private/local IPs (dev, health checks, container-internal) have no geo data — allow.
  if (!ip || ip === '::1' || ip.startsWith('127.') || ip.startsWith('10.') || ip.startsWith('192.168.')) {
    return next();
  }

  const geo = geoip.lookup(ip);
  if (geo && BLOCKED_COUNTRIES.has(geo.country)) {
    return res.status(451).send(renderBlockedPage());
  }
  next();
}

function renderBlockedPage() {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Not available in your region</title>
<style>
  body{font-family:Georgia,serif;background:#fff;color:#1a1a1a;display:flex;align-items:center;
       justify-content:center;height:100vh;margin:0;text-align:center;padding:24px;}
  .box{max-width:420px;}
  h1{color:#5c3a21;font-size:1.4rem;margin-bottom:8px;}
  p{color:#444;line-height:1.5;}
</style></head>
<body><div class="box">
  <h1>SWIFT MARKET</h1>
  <p>This service is not currently available in your region.</p>
</div></body></html>`;
}

module.exports = { geoBlockMiddleware, BLOCKED_COUNTRIES };
