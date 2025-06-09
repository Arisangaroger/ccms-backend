const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true,
    unique: true
  },
  passwordHash: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['CITIZEN', 'INSTITUTION', 'DISTRICT', 'ADMIN'],
    required: true
  },
  NIN: {
    type: String,
    unique: true,
    sparse: true
  },
  phone: {
    type: String,
    unique: true,
    sparse: true
  },
  isPhoneVerified: {
    type: Boolean,
    default: false
  },
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  institutionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Institution'
  },
  districtId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'District'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('User', userSchema); 