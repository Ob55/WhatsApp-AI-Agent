// budget.js — Clean Cooking Budget Calculator

const EXCHANGE_RATE = 129;
const SCHOOL_DAYS = 230;
const INFLATION = 0.05;
const OPEX_FACTOR = 0.50;
const FIREWOOD_KES_PER_KG = 18;
const CO2_PER_KG_WOOD = 1.747;
const EMISSION_CUT = 0.90;
const KG_PER_TREE = 500;

const DEFAULT_BANKS = [
  { bank_name: 'ABSA Bank', rate: 13.9 },
  { bank_name: 'Equity Bank', rate: 15.5 },
  { bank_name: 'KCB Bank', rate: 15.8 }
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
  const roi = annualSavingsUSD > 0 ? ((annualSavingsUSD / capexUSD) * 100).toFixed(1) : 0;

  return {
    totalPeople,
    dailyFuelSpendKES: dailyFuelKES,
    annualFuelKES: Math.round(annualFuelKES),
    annualFuelUSD: Math.round(annualFuelUSD),
    capexUSD,
    ignisOpexUSD: Math.round(ignisOpexUSD),
    annualSavingsUSD: Math.round(annualSavingsUSD),
    paybackYears: isFinite(paybackYears) ? Math.round(paybackYears * 10) / 10 : 999,
    annualCO2Saved: Math.round(annualCO2Saved),
    treesSaved: Math.round(treesSaved * 10) / 10,
    roi
  };
}

// Returns warning string or null
function checkFuelSpend(dailyFuelKES, totalPeople) {
  const perPerson = dailyFuelKES / totalPeople;
  const suggested = Math.round(totalPeople * 18);

  if (perPerson < 5) {
    return `⚠️ *Heads up!* KES ${fmt(dailyFuelKES)}/day for ${fmt(totalPeople)} people = *KES ${perPerson.toFixed(1)}/person/day* — way too low.\n\nTypical range: *KES 15–25/person/day* for wood fuel.\nSuggested amount: ~*KES ${fmt(suggested)}/day*\n\n💡 Enter a new amount, or type *"go"* to calculate anyway.`;
  }
  if (perPerson < 10) {
    return `⚠️ *Note:* KES ${fmt(dailyFuelKES)}/day = *KES ${perPerson.toFixed(1)}/person/day* — a bit low.\n\nTypical range: *KES 15–25/person/day*.\nSuggested: ~*KES ${fmt(suggested)}/day*\n\n💡 Type a new amount or *"go"* to proceed.`;
  }
  return null;
}

function fmt(n) {
  if (n === null || n === undefined) return '0';
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ——— Part 1: Budget Summary ———
function formatSummary(instName, budget) {
  const capexKES = budget.capexUSD * EXCHANGE_RATE;
  const savingsKES = Math.round(budget.annualSavingsUSD * EXCHANGE_RATE);
  const opexKES = Math.round(budget.ignisOpexUSD * EXCHANGE_RATE);
  const tier = budget.totalPeople < 1000 ? 'Under 1,000 people'
    : budget.totalPeople <= 1500 ? '1,000–1,500 people' : 'Over 1,500 people';

  return `🔥 *IGNIS CLEAN COOKING BUDGET*
━━━━━━━━━━━━━━━━━━━━━━

*About Ignis*
Ignis Innovation Africa helps institutions transition from wood/charcoal to clean cooking — cutting costs by up to 50% and emissions by 90%.

━━━ *Executive Summary* ━━━
🏫 *${instName}*
👥 ${fmt(budget.totalPeople)} people
💰 Daily fuel: KES ${fmt(budget.dailyFuelSpendKES)}

━━━ *Quick Comparison* ━━━
🪵 Firewood/year: *$${fmt(budget.annualFuelUSD)}* (KES ${fmt(budget.annualFuelKES)})
⚡ Ignis/year: *$${fmt(budget.ignisOpexUSD)}* (KES ${fmt(opexKES)})
✅ *Annual saving: $${fmt(budget.annualSavingsUSD)}* (KES ${fmt(savingsKES)})
📈 ROI: *${budget.roi}%/year*

━━━ *Investment Required* ━━━
💵 CAPEX: *$${fmt(budget.capexUSD)}* (KES ${fmt(Math.round(capexKES))})
📌 Tier: ${tier}

━━━ *Payback Period* ━━━
⏱️ *${budget.paybackYears} years* to recover investment

━━━ *Environmental Impact* ━━━
🌱 CO₂ reduced: ${fmt(budget.annualCO2Saved)} kg/year
🌳 Trees saved: ${budget.treesSaved}/year

━━━━━━━━━━━━━━━━━━━━━━
👉 *"projection"* → 5-year breakdown
👉 *"bank options"* → financing plans`;
}

// ——— Part 2: 5-Year Projection ———
function formatProjection(instName, budget) {
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
━━━━━━━━━━━━━━━━━━━━━━
🏫 *${instName}*
_(5% annual inflation applied)_

`;

  for (const yr of years) {
    const marker = yr.cumSavings >= budget.capexUSD ? '🟢' : '🔵';
    msg += `${marker} *Year ${yr.y}*
  🪵 Firewood: $${fmt(yr.wood)} | ⚡ Ignis: $${fmt(yr.ignis)}
  💰 Saved: *$${fmt(yr.saved)}* | Cumulative: *$${fmt(yr.cumSavings)}*
`;
  }

  const last = years[4];
  msg += `\n━━━━━━━━━━━━━━━━━━━━━━
🎯 *5-yr total savings: $${fmt(last.cumSavings)}*
${last.cumSavings >= budget.capexUSD
  ? '🟢 Investment fully recovered!'
  : '🔵 $' + fmt(budget.capexUSD - last.cumSavings) + ' still to recover'}

👉 *"bank options"* → financing plans`;

  return msg;
}

// ——— Part 3: Bank Financing (async — fetches live rates) ———
async function formatBankOptions(instName, capexUSD, banksOverride = null) {
  const { getBankRates } = require('./supabase');
  const banks = banksOverride || await getBankRates();
  const capexKES = Math.round(capexUSD * EXCHANGE_RATE);

  let msg = `🏦 *BANK FINANCING SCENARIOS*
━━━━━━━━━━━━━━━━━━━━━━
🏫 *${instName}*
💰 Loan amount: *$${fmt(capexUSD)}* (KES ${fmt(capexKES)})

`;

  for (const bank of banks) {
    const r = bank.rate / 100 / 12;
    const p = (n) => Math.round(capexUSD * r / (1 - Math.pow(1 + r, -n)));
    const pay12 = p(12), pay24 = p(24), pay36 = p(36);

    msg += `*${bank.bank_name}* (${bank.rate}% p.a.)
  12 mo → $${fmt(pay12)}/mo | Total: $${fmt(pay12 * 12)}
  24 mo → $${fmt(pay24)}/mo | Total: $${fmt(pay24 * 24)}
  36 mo → $${fmt(pay36)}/mo | Total: $${fmt(pay36 * 36)}

`;
  }

  msg += `━━━ *Technical Assumptions* ━━━
📌 1 USD = KES ${EXCHANGE_RATE}
📌 School days/year: ${SCHOOL_DAYS}
📌 Annual inflation: ${INFLATION * 100}%
📌 Firewood cost: KES ${FIREWOOD_KES_PER_KG}/kg
📌 CO₂ factor: ${CO2_PER_KG_WOOD} kg/kg wood
📌 Emission cut: ${EMISSION_CUT * 100}%

━━━━━━━━━━━━━━━━━━━━━━
_Rates as of Feb 2026 (CBK base: 8.75%). Subject to approval._
_Contact the Ignis team to get started! 🔥_`;

  return msg;
}

module.exports = {
  calculateBudget,
  checkFuelSpend,
  formatSummary,
  formatProjection,
  formatBankOptions,
  DEFAULT_BANKS,
  EXCHANGE_RATE,
  SCHOOL_DAYS
};
