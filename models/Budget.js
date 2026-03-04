const mongoose = require('mongoose');

const budgetSchema = new mongoose.Schema({
  institution_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Institution', required: true },
  estimated_budget: { type: Number, required: true },
  confirmed_budget: { type: Number, default: null },
  currency: { type: String, default: 'USD' },
  payment_terms: { type: String },
  notes: { type: String }
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

module.exports = mongoose.model('Budget', budgetSchema);
