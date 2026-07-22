// Save as: middleware/auth.js
const jwt = require('jsonwebtoken');

// Set DISABLE_AUTH=true in .env to skip login during early UX iteration.
// Flip it back (or remove it) once real accounts are in use.
function requireAuth(req, res, next) {
  if (process.env.DISABLE_AUTH === 'true') {
    req.user = { id: '00000000-0000-0000-0000-000000000000', username: 'dev', role: 'supervisor' };
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token provided' });

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = requireAuth;