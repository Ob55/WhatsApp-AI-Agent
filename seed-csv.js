require('dotenv').config();
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const mongoose = require('mongoose');
const Institution = require('./models/Institution');

async function seedFromCSV() {
  const csvFile = process.argv[2] || '/home/brian/Desktop/ESIA pipeline.csv';

  const csvPath = path.resolve(csvFile);
  if (!fs.existsSync(csvPath)) {
    console.error(`File not found: ${csvPath}`);
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  // Read CSV and collect rows
  const rows = [];
  await new Promise((resolve, reject) => {
    fs.createReadStream(csvPath)
      .pipe(csv())
      .on('data', (row) => rows.push(row))
      .on('end', resolve)
      .on('error', reject);
  });

  console.log(`Read ${rows.length} rows from CSV`);

  // Map CSV columns to Institution schema
  const institutions = rows.map((row) => {
    const loanAmount = parseFloat(row['Existing Loan Amount']) || 0;
    const totalPeople = parseInt(row['Total People']) || 0;
    const mealsPerDay = parseInt(row['Total Meals Per Day']) || 0;

    return {
      name: (row['Institution Name'] || '').trim(),
      gps_location: (row['GPS Location'] || row['GPS Location '] || '').trim(),
      phone: (row['Phone Number'] || '').trim(),
      email: (row['Email'] || '').trim(),
      county: (row['County'] || '').trim(),
      ownership_type: (row['Ownership Type'] || '').trim(),
      institution_type: (row['Institution Type'] || '').trim(),
      contact_person: (row['Contact Person Name'] || '').trim(),
      total_people: totalPeople,
      total_meals_per_day: mealsPerDay,
      cooking_method: (row['Cooking Method'] || '').trim(),
      school_type: (row['School Type'] || '').trim(),
      bank_name: (row['Bank Name'] || '').trim(),
      existing_loan: (row['Existing Loan (Yes/No)'] || '').trim(),
      existing_loan_amount: loanAmount,
      deal_stage: 'proposal_sent'
    };
  }).filter(inst => inst.name);

  console.log(`Mapped ${institutions.length} valid institutions`);

  // Show sample
  console.log('\nSample (first 3):');
  institutions.slice(0, 3).forEach((inst, i) => {
    console.log(`  ${i + 1}. ${inst.name} | ${inst.county} | ${inst.institution_type} | ${inst.cooking_method} | ${inst.total_people} people`);
  });

  // Clear and insert
  await Institution.deleteMany({});
  console.log('\nCleared existing institutions');

  const batchSize = 100;
  let inserted = 0;
  for (let i = 0; i < institutions.length; i += batchSize) {
    const batch = institutions.slice(i, i + batchSize);
    await Institution.insertMany(batch, { ordered: false });
    inserted += batch.length;
    console.log(`Inserted ${inserted}/${institutions.length}`);
  }

  console.log(`\nDone! Seeded ${inserted} institutions from CSV.`);
  process.exit(0);
}

seedFromCSV().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});
