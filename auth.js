const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) console.error('FATAL: JWT_SECRET is not set.');

function signToken(payload, expiresIn = '30d') {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

// Attaches req.auth if a valid token is present; does not reject if absent.
// Routes that require login use requireAuth below.
function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try {
      req.auth = verifyToken(token);
    } catch (e) {
      req.auth = null;
    }
  }
  next();
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Login required.' });
  try {
    req.auth = verifyToken(token);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Session expired, please log in again.' });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.auth || req.auth.role !== role) {
      return res.status(403).json({ error: 'Not authorized.' });
    }
    next();
  };
}

module.exports = { signToken, verifyToken, optionalAuth, requireAuth, requireRole };
