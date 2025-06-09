const bcrypt = require('bcrypt');
const SALT_ROUNDS = 10;

async function hashPassword(plainText) {
  return bcrypt.hash(plainText, SALT_ROUNDS);
}

async function comparePassword(plainText, hash) {
  return bcrypt.compare(plainText, hash);
}

module.exports = { hashPassword, comparePassword }; 