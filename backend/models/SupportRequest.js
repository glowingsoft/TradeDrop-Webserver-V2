// models/SupportRequest.js
const mongoose = require('mongoose');
const validator = require('validator');

const supportRequestSchema = new mongoose.Schema({
  name: {
    type: String,
    trim: true,
  },
  ticket: {
    type: String,
    required: true, 
    unique: true,
    default: () => `TCK-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
  },
  user:{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },

  subject: {
    type: String,
    required: true,
    trim: true,
  },
  message: {
    type: String,
    required: true,
    trim: true,
  },
  response: {
    type: String,
    trim: true,
    default: null,
  },
  status: {
    type: String,
    enum: ['pending', 'responded', 'resolved', 'closed', 'deleted'],
    default: 'pending',
  },
}, {
  timestamps: true,
});

const SupportRequest = mongoose.model('SupportRequest', supportRequestSchema);

module.exports = SupportRequest;
