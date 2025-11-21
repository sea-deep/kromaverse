const mongoose = require('mongoose');
const { Schema } = mongoose;

const UserSchema = new Schema({
  username: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  lastPlacedAt: { type: Date, default: null },
  customColors: { type: [String], default: [] },
  turnsRemaining: { type: Number, default: 64 },
  lastTurnRefill: { type: Date, default: Date.now }
});
module.exports = mongoose.model('User', UserSchema);
