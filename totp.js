const speakeasy = require('speakeasy');
const QRCode = require('qrcode');

function generateSecret() {
  return speakeasy.generateSecret({ name: 'Swift Market Admin' });
}

async function secretToQrDataUrl(otpauthUrl) {
  return QRCode.toDataURL(otpauthUrl);
}

function verifyToken(secretBase32, token) {
  return speakeasy.totp.verify({
    secret: secretBase32,
    encoding: 'base32',
    token,
    window: 1
  });
}

module.exports = { generateSecret, secretToQrDataUrl, verifyToken };
