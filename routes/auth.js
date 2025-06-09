const express = require('express');
const { register, login, getProfile } = require('../controllers/authController');
const { verifyJWT } = require('../middlewares/authMiddleware');
const rateLimit = require('express-rate-limit');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                  // max 20 requests per IP per window
  message: 'Too many attempts, please try again later.',
});

const router = express.Router();

router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.get('/profile', verifyJWT, getProfile);

module.exports = router; 