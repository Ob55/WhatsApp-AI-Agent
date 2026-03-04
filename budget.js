// ——— ESIA Clean Cooking Budget Calculator ———

// Constants
const EXCHANGE_RATE = 129;
const SCHOOL_DAYS = 230;
const INFLATION = 0.05;
const OPEX_FACTOR = 0.50;
const FIREWOOD_KES_PER_KG = 18;
const CO2_PER_KG_WOOD = 1.747;
const EMISSION_CUT = 0.90;
const KG_PER_TREE = 500;

// Bank rates (CBK Jan 2026)
const BANKS = [
  { name: 'Equity Bank', rate: 14.50 },
  { name: 'ABSA Bank', rate: 13.75 },
  { name: 'KCB Bank', rate: 14.80 }
];

function getCapex(people) {
  if (people < 1000) return 50000;
  if (people <= 1500) return 73000;
  return 90000;
}

function calculateBudget(totalPeople, dailyFuelKES) {
  const annualFuelKES = dailyFuelKES * SCHOOL_DAYS;
  const annualFuelUSD = annualFuelKES / EXCHANGE_RATE;
  const capexUSD = getCapex(totalPeople);
  const ignisOpexUSD = annualFuelUSD * OPEX_FACTOR;
  const annualSavingsUSD = annualFuelUSD - ignisOpexUSD;
  const paybackYears = annualSavingsUSD > 0 ? capexUSD / annualSavingsUSD : Infinity;

  const dailyWoodKG = dailyFuelKES / FIREWOOD_KES_PER_KG;
  const annualWoodKG = dailyWoodKG * SCHOOL_DAYS;
  const annualCO2Saved = annualWoodKG * CO2_PER_KG_WOOD * EMISSION_CUT;
  const treesSaved = annualWoodKG / KG_PER_TREE;

  return {
    totalPeople,
    dailyFuelSpendKES: dailyFuelKES,
    annualFuelKES: Math.round(annualFuelKES),
    annualFuelUSD: Math.round(annualFuelUSD),
    capexUSD,
    ignisOpexUSD: Math.round(ignisOpexUSD),
    annualSavingsUSD: Math.round(annualSavingsUSD),
    paybackYears: Math.round(paybackYears * 10) / 10,
    annualCO2Saved: Math.round(annualCO2Saved),
    treesSaved: Math.round(treesSaved * 10) / 10
  };
}

function fmt(n) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ——— WhatsApp Styled Outputs ———

function formatSummary(schoolName, budget) {
  return `🔥 *IGNIS CLEAN COOKING BUDGET*
━━━━━━━━━━━━━━━━━━━━

🏫 *${schoolName}*
📍 *${budget.totalPeople}* students

━━━ 💰 *CURRENT FUEL COST* ━━━
  📌 Daily spend: *KES ${fmt(budget.dailyFuelSpendKES)}*
  📌 Annual cost: *$${fmt(budget.annualFuelUSD)}*
      _(KES ${fmt(budget.annualFuelKES)})_

━━━ 🔧 *IGNIS INVESTMENT* ━━━
  💵 One-time CAPEX: *$${fmt(budget.capexUSD)}*
  ⚡ Annual Ignis cost: *$${fmt(budget.ignisOpexUSD)}*

━━━ 📊 *YOUR SAVINGS* ━━━
  ✅ Annual savings: *$${fmt(budget.annualSavingsUSD)}*
  ⏱️ Payback period: *${budget.paybackYears} years*

━━━ 🌍 *ENVIRONMENTAL IMPACT* ━━━
  🌱 CO₂ reduced: *${fmt(budget.annualCO2Saved)} kg/year*
  🌳 Trees saved: *${budget.treesSaved} per year*

━━━━━━━━━━━━━━━━━━━━
👉 Type *"projection"* → 5-year breakdown
👉 Type *"bank options"* → loan plans`;
}

function formatProjection(schoolName, budget) {
  const years = [];
  let cumSavings = 0;

  for (let y = 1; y <= 5; y++) {
    const factor = Math.pow(1 + INFLATION, y - 1);
    const wood = Math.round(budget.annualFuelUSD * factor);
    const ignis = Math.round(budget.ignisOpexUSD * factor);
    const saved = wood - ignis;
    cumSavings += saved;
    years.push({ y, wood, ignis, saved, cumSavings });
  }

  let msg = `📈 *5-YEAR COST PROJECTION*
━━━━━━━━━━━━━━━━━━━━
🏫 *${schoolName}*
_(with 5% annual inflation)_

`;

  for (const yr of years) {
    const bar = yr.y <= 1 ? '▫️' : yr.cumSavings >= budget.capexUSD ? '🟢' : '🔵';
    msg += `${bar} *Year ${yr.y}*
  🪵 Firewood: $${fmt(yr.wood)}
  ⚡ Ignis: $${fmt(yr.ignis)}
  💰 Saved this year: *$${fmt(yr.saved)}*
  📊 Total saved so far: *$${fmt(yr.cumSavings)}*

`;
  }

  msg += `━━━━━━━━━━━━━━━━━━━━
🎯 *5-year total savings: $${fmt(years[4].cumSavings)}*

👉 Type *"bank options"* → loan plans`;

  return msg;
}

function formatBankOptions(schoolName, capexUSD) {
  let msg = `🏦 *BANK FINANCING OPTIONS*
━━━━━━━━━━━━━━━━━━━━
🏫 *${schoolName}*
💰 Loan amount: *$${fmt(capexUSD)}*

`;

  for (const bank of BANKS) {
    const r = bank.rate / 100 / 12;

    const pay12 = Math.round(capexUSD * r / (1 - Math.pow(1 + r, -12)));
    const total12 = pay12 * 12;

    const pay24 = Math.round(capexUSD * r / (1 - Math.pow(1 + r, -24)));
    const total24 = pay24 * 24;

    const pay36 = Math.round(capexUSD * r / (1 - Math.pow(1 + r, -36)));
    const total36 = pay36 * 36;

    msg += `━━━ *${bank.name}* ━━━
📊 Interest rate: *${bank.rate}% p.a.*

  📅 *1 Year (12 months)*
     Monthly: *$${fmt(pay12)}*
     Total repay: $${fmt(total12)}

  📅 *2 Years (24 months)*
     Monthly: *$${fmt(pay24)}*
     Total repay: $${fmt(total24)}

  📅 *3 Years (36 months)*
     Monthly: *$${fmt(pay36)}*
     Total repay: $${fmt(total36)}

`;
  }

  msg += `━━━━━━━━━━━━━━━━━━━━
_📌 Rates from CBK Jan 2026_
_Actual rate depends on your profile_`;

  return msg;
}

module.exports = {
  calculateBudget,
  formatSummary,
  formatProjection,
  formatBankOptions,
  BANKS,
  EXCHANGE_RATE,
  SCHOOL_DAYS
};
