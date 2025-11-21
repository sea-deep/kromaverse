const mongoose = require('mongoose');
const { Schema } = mongoose;

const PixelSchema = new Schema({
  x: { type: Number, required: true },
  y: { type: Number, required: true },
  color: { type: String, required: true },
  user: { type: Schema.Types.ObjectId, ref: 'User' },
  updatedAt: { type: Date, default: Date.now }
});
PixelSchema.index({ x: 1, y: 1 }, { unique: true });
module.exports = mongoose.model('Pixel', PixelSchema);
