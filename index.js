require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const morgan = require('morgan');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');

const app = express();

const PORT = process.env.PORT || 5000;

// Global Middlewares
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_ORIGIN
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('🗄️ Connected to MongoDB'))
.catch((err) => {
  console.error('❌ MongoDB connection error:', err);
  process.exit(1);
});

// Routes (Placeholder)
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);
// app.use('/api/complaints', require('./routes/complaints'));

// Global Error Handling Middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal Server Error',
    errors: err.details || []
  });
});

// Smoke-test instructions for Postman/Insomnia:
// 1. Start the server with npm run dev.
// 2. POST to http://localhost:5000/api/auth/register with JSON:
// {
//   "name": "John Doe",
//   "email": "john@example.com",
//   "password": "securePass123",
//   "NIN": "1234567890123456",
//   "phone": "+250788123456"
// }
// → Expect 201 with { token, user }.
// 3. POST to http://localhost:5000/api/auth/login with:
// {
//   "emailOrPhone": "john@example.com",
//   "password": "securePass123"
// }
// → Expect { token, user }.
// 4. GET to http://localhost:5000/api/auth/profile with header Authorization: Bearer <token>.
// → Expect user object (minus passwordHash).

// Start the server
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`)); 