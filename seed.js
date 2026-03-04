require('dotenv').config();
const mongoose = require('mongoose');
const Institution = require('./models/Institution');
const Budget = require('./models/Budget');

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  // Clear existing data
  await Institution.deleteMany({});
  await Budget.deleteMany({});
  console.log('Cleared existing data');

  // Seed institutions
  const institutions = await Institution.insertMany([
    {
      name: "St. Mary's University",
      type: 'university',
      region: 'Nairobi',
      contact_person: 'Dr. James Kamau',
      contact_phone: '+254700111222',
      deal_stage: 'negotiation',
      assigned_to: 'Sarah Ochieng',
      notes: 'Large campus with 3 kitchens. Very interested in LPG transition.'
    },
    {
      name: 'Harristown Correctional Facility',
      type: 'correctional',
      region: 'Nakuru',
      contact_person: 'Warden P. Muthoni',
      contact_phone: '+254700333444',
      deal_stage: 'negotiation',
      assigned_to: 'David Njoroge',
      notes: 'Government facility. Awaiting budget approval from county office.'
    },
    {
      name: 'Greenfield Primary School',
      type: 'school',
      region: 'Kisumu',
      contact_person: 'Head Teacher Mary Akinyi',
      contact_phone: '+254700555666',
      deal_stage: 'proposal_sent',
      assigned_to: 'Sarah Ochieng',
      notes: 'Feeding program for 800 students. Proposal sent last week.'
    },
    {
      name: 'Kenyatta Technical Institute',
      type: 'other',
      region: 'Mombasa',
      contact_person: 'Prof. Hassan Ali',
      contact_phone: '+254700777888',
      deal_stage: 'prospecting',
      assigned_to: 'David Njoroge',
      notes: 'Initial meeting scheduled for next month.'
    },
    {
      name: 'Riverside Academy',
      type: 'school',
      region: 'Nairobi',
      contact_person: 'Principal John Wekesa',
      contact_phone: '+254700999000',
      deal_stage: 'approved',
      assigned_to: 'Sarah Ochieng',
      notes: 'Deal approved. Installation scheduled for March 2026.'
    }
  ]);

  console.log(`Seeded ${institutions.length} institutions`);

  // Seed budgets
  const budgets = await Budget.insertMany([
    {
      institution_id: institutions[0]._id,
      estimated_budget: 75000,
      confirmed_budget: null,
      currency: 'USD',
      payment_terms: '50% upfront, 50% on completion',
      notes: 'Budget under review by university finance committee'
    },
    {
      institution_id: institutions[1]._id,
      estimated_budget: 45000,
      confirmed_budget: null,
      currency: 'USD',
      payment_terms: '60% upfront, 40% on delivery',
      notes: 'Awaiting government approval'
    },
    {
      institution_id: institutions[2]._id,
      estimated_budget: 20000,
      confirmed_budget: null,
      currency: 'USD',
      payment_terms: '100% on delivery',
      notes: 'Small project, school seeking NGO funding'
    },
    {
      institution_id: institutions[3]._id,
      estimated_budget: 55000,
      confirmed_budget: null,
      currency: 'USD',
      payment_terms: 'TBD',
      notes: 'Preliminary estimate only'
    },
    {
      institution_id: institutions[4]._id,
      estimated_budget: 30000,
      confirmed_budget: 30000,
      currency: 'USD',
      payment_terms: '40% upfront, 60% on installation',
      notes: 'Fully approved and confirmed'
    }
  ]);

  console.log(`Seeded ${budgets.length} budgets`);
  console.log('Seed complete!');
  process.exit(0);
}

seed().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});
