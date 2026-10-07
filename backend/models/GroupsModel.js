const mongoose = require('mongoose');

const groupSchema = new mongoose.Schema({
  creator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  members: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: [],
  }],
  title: {
    type: String,
    required: true,
    trim: true,
  },
  emoji: {
    type: String,
    trim: true,
    default: '',
  },
  colorAccent: {
    type: String,
    trim: true,
    default: '#4F46E5',
  },
  description: {
    type: String,
    trim: true,
    default: '',
  },
}, {
  timestamps: true,
});

const Group = mongoose.model('Group', groupSchema);

module.exports = Group;
