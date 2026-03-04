const mongoose = require('mongoose');

const institutionSchema = new mongoose.Schema({
  name: { type: String, required: true },
  gps_location: { type: String },
  phone: { type: String },
  email: { type: String },
  county: { type: String },
  ownership_type: { type: String },
  institution_type: { type: String },
  contact_person: { type: String },
  total_people: { type: Number },
  total_meals_per_day: { type: Number },
  cooking_method: { type: String },
  school_type: { type: String },
  bank_name: { type: String },
  existing_loan: { type: String },
  existing_loan_amount: { type: Number, default: 0 },
  deal_stage: {
    type: String,
    enum: ['prospecting', 'proposal_sent', 'negotiation', 'approved', 'lost'],
    default: 'proposal_sent'
  },
  assigned_to: { type: String }
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

module.exports = mongoose.model('Institution', institutionSchema);
