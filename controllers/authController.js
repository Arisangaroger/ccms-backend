const Joi = require('joi');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { hashPassword, comparePassword } = require('../utils/hash');

const registerSchema = Joi.object({
  name: Joi.string().required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  NIN: Joi.string().length(16).required(),
  phone: Joi.string().pattern(/^\+?[0-9]{10,15}$/).required(),
});

exports.register = async (req, res, next) => {
  try {
    const { error, value } = registerSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }

    const { name, email, password, NIN, phone } = value;

    const existingUser = await User.findOne({ $or: [{ email }, { phone }, { NIN }] });
    if (existingUser) {
      return res.status(409).json({ message: 'Email, phone or NIN already in use' });
    }

    const passwordHash = await hashPassword(password);

    const newUser = new User({
      name,
      email,
      passwordHash,
      role: 'CITIZEN',
      NIN,
      phone
    });

    await newUser.save();

    // TODO: Send verification email/SMS

    const token = jwt.sign({ id: newUser._id, role: newUser.role }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      token,
      user: {
        _id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role
      }
    });
  } catch (err) {
    next(err);
  }
};

const loginSchema = Joi.object({
  emailOrPhone: Joi.string().required(),
  password: Joi.string().required(),
});

exports.login = async (req, res, next) => {
  try {
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }

    const { emailOrPhone, password } = value;

    const user = await User.findOne({ $or: [{ email: emailOrPhone }, { phone: emailOrPhone }] });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const isPasswordValid = await comparePassword(password, user.passwordHash);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    next(err);
  }
};

exports.getProfile = async (req, res, next) => {
  try {
    const { passwordHash, ...user } = req.user.toObject();
    res.json(user);
  } catch (err) {
    next(err);
  }
}; 