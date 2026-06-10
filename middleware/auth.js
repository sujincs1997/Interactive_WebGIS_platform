const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'telecom_gis_secure_secret_key_2026';

module.exports = function (req, res, next) {
  // Get token from header
  const authHeader = req.header('Authorization');
  if (!authHeader) {
    return res.status(401).json({ message: 'No authorization header, access denied' });
  }

  // Expecting format: Bearer <token>
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({ message: 'Authorization format is Bearer <token>, access denied' });
  }

  const token = parts[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded.user; // Contains id, username, role
    next();
  } catch (err) {
    res.status(401).json({ message: 'Token is invalid or expired, authorization denied' });
  }
};
