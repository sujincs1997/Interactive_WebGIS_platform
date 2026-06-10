const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/auth');

// @route   POST api/auth/register
// @desc    Register a new user
// @access  Public
router.post('/register', authController.register);

// @route   POST api/auth/login
// @desc    Authenticate user & get token
// @access  Public
router.post('/login', authController.login);

// @route   GET api/auth/me
// @desc    Get current user details
// @access  Private
router.get('/me', authMiddleware, authController.getMe);

router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);

module.exports = router;
