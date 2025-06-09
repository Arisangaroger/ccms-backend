const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { validationResult } = require('express-validator');

// Citizen Registration
exports.registerCitizen = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { fullName, nationalID, phone, email, password, province, district } = req.body;

    // Check if citizen exists
    let user = await User.findOne({ 
      $or: [{ email }, { nationalID }]
    });
    
    if (user) {
      return res.status(400).json({ 
        message: 'User already exists with this email or national ID' 
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    user = new User({
      role: 'citizen',
      fullName,
      nationalID,
      phone,
      email,
      password: hashedPassword,
      province,
      district
    });

    await user.save();

    const payload = {
      user: {
        id: user.id
      }
    };

    jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: '24h' },
      (err, token) => {
        if (err) throw err;
        res.json({ token });
      }
    );
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server error');
  }
};

// Institution Registration
exports.registerInstitution = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { institutionName, phone, email, password, province, district } = req.body;

    // Check if institution exists
    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ message: 'Institution already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    user = new User({
      role: 'institution',
      institutionName,
      phone,
      email,
      password: hashedPassword,
      province,
      district
    });

    await user.save();

    const payload = {
      user: {
        id: user.id
      }
    };

    jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: '24h' },
      (err, token) => {
        if (err) throw err;
        res.json({ token });
      }
    );
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server error');
  }
};

// Login for both citizens and institutions
exports.login = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const payload = {
      user: {
        id: user.id
      }
    };

    jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: '24h' },
      (err, token) => {
        if (err) throw err;
        res.json({ 
          token,
          role: user.role
        });
      }
    );
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server error');
  }
}; 