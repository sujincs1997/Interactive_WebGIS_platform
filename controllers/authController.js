const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'telecom_gis_secure_secret_key_2026';

// Register a new user
exports.register = async (req, res) => {
  const { username, email, password, role } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ message: 'Please enter all fields' });
  }

  try {
    // Check if user already exists
    const checkUser = await db.query(
      'SELECT id FROM users WHERE username = $1 OR email = $2',
      [username, email]
    );

    if (checkUser.rows.length > 0) {
      return res.status(400).json({ message: 'Username or email already exists' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    // Insert user
    const userRole = role || 'planner';
    const result = await db.query(
      'INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, username, email, role',
      [username, email, password_hash, userRole]
    );

    const user = result.rows[0];

    // Create JWT token
    const payload = {
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
    };

    jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' }, (err, token) => {
      if (err) throw err;
      res.json({ token, user });
    });
  } catch (err) {
    console.error('Registration error:', err.message);
    res.status(500).json({ message: 'Server error during registration' });
  }
};

// Login user
exports.login = async (req, res) => {
  const { usernameOrEmail, password } = req.body;

  if (!usernameOrEmail || !password) {
    return res.status(400).json({ message: 'Please enter all fields' });
  }

  try {
    // Find user by username or email
    const result = await db.query(
      'SELECT * FROM users WHERE username = $1 OR email = $1',
      [usernameOrEmail]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const user = result.rows[0];

    // Check password
    const isMatch = await bcrypt.compare(password, user.password_hash);
    console.log(`Login attempt for ${usernameOrEmail}`);
    console.log(`Password match: ${isMatch}`);

    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Create JWT token
    const payload = {
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
    };

    jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' }, (err, token) => {
      if (err) throw err;
      res.json({
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
        },
      });
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ message: 'Server error during login' });
  }
};

// Get current authenticated user details
exports.getMe = async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, username, email, role, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Fetch user details error:', err.message);
    res.status(500).json({ message: 'Server error fetching user details' });
  }
};

// Password reset request - send email with token
const crypto = require('crypto');
const nodemailer = require('nodemailer');

// Email transporter configuration (uses .env variables)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Helper to build reset URL (adjust CLIENT_URL as needed)
const getResetUrl = (token, userId) => {
  const base = process.env.CLIENT_URL || 'http://localhost:3000';
  return `${base}/reset-password?token=${token}&id=${userId}`;
};

// @desc   Request password reset
// @route  POST /auth/forgot-password
// @access Public
exports.forgotPassword = async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ message: 'Email is required' });
  }
  try {
    const userResult = await db.query('SELECT id, email FROM users WHERE email = $1', [email]);
    if (userResult.rows.length === 0) {
      // Respond with generic message to avoid email enumeration
      return res.json({ message: 'If an account exists, a reset link has been sent' });
    }
    const user = userResult.rows[0];
    // Generate secure token
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
    // Store token hash
    await db.query(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.id, tokenHash, expiresAt]
    );
    // Send email
    const resetLink = getResetUrl(token, user.id);
    const mailOptions = {
      from: process.env.EMAIL_FROM || 'no-reply@telecomgis.com',
      to: user.email,
      subject: 'Password Reset Request',
      html: `<p>You requested a password reset. Click the link below to set a new password. The link expires in 15 minutes.</p><p><a href="${resetLink}">Reset Password</a></p>`,
    };
    await transporter.sendMail(mailOptions);
    return res.json({ message: 'If an account exists, a reset link has been sent' });
  } catch (err) {
    console.error('Forgot password error:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

// @desc   Reset password using token
// @route  POST /auth/reset-password
// @access Public
exports.resetPassword = async (req, res) => {
  const { token, userId, newPassword } = req.body;
  if (!token || !userId || !newPassword) {
    return res.status(400).json({ message: 'All fields are required' });
  }
  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const result = await db.query(
      `SELECT id, used_at, expires_at FROM password_reset_tokens 
       WHERE user_id = $1 AND token_hash = $2 AND used_at IS NULL AND expires_at > NOW()`,
      [userId, tokenHash]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }
    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(newPassword, salt);
    // Update user password
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [password_hash, userId]);
    // Mark token as used
    await db.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1', [result.rows[0].id]);
    return res.json({ message: 'Password has been reset successfully' });
  } catch (err) {
    console.error('Reset password error:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};
