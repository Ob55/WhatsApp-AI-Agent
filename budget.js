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

// Bank rates (Ignis official)
const BANKS = [
  { name: 'ABSA Bank', rate: 13.9 },
  { name: 'Equity Bank', rate: 15.5 },
  { name: 'KCB Bank', rate: 15.8 }
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

// Fuel spend sanity check — returns warning string or null
function checkFuelSpend(dailyFuelKES, totalPeople) {
  const perPerson = dailyFuelKES / totalPeople;
  const suggested = Math.round(totalPeople * 18);

  if (perPerson < 5) {
    return `⚠️ *Heads up!* KES ${fmt(dailyFuelKES)}/day for ${fmt(totalPeople)} students is only *KES ${perPerson.toFixed(1)} per student/day* — that seems very low.\n\nTypical range is *KES 15–25 per student/day* for wood fuel.\nFor ${fmt(totalPeople)} students, expect roughly *KES ${fmt(suggested)}/day*.\n\n💡 Type a new amount to adjust, or *"go"* to calculate with KES ${fmt(dailyFuelKES)} anyway.`;
  }
  if (perPerson < 10) {
    return `⚠️ *Note:* KES ${fmt(dailyFuelKES)}/day for ${fmt(totalPeople)} students is *KES ${perPerson.toFixed(1)} per student/day* — a bit low.\n\nTypical range: *KES 15–25 per student/day*.\nSuggested: ~*KES ${fmt(suggested)}/day*.\n\n💡 Type a new amount to adjust, or *"go"* to proceed anyway.`;
  }
  return null;
}

function fmt(n) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ——— PDF-Aligned WhatsApp Outputs ———

function formatSummary(schoolName, budget) {
  const capexKES = budget.capexUSD * EXCHANGE_RATE;
  const savingsKES = Math.round(budget.annualSavingsUSD * EXCHANGE_RATE);
  const tier = budget.totalPeople < 1000 ? 'Under 1,000 people' : budget.totalPeople <= 1500 ? '1,000–1,500 people' : 'Over 1,500 people';

  return `🔥 *IGNIS CLEAN COOKING BUDGET REPORT*
━━━━━━━━━━━━━━━━━━━━━━

*About Ignis*
Ignis Innovation Africa helps schools transition from wood/charcoal to clean, efficient cooking — cutting costs by up to 50% and reducing emissions by 90%.

━━━ *Executive Summary* ━━━
🏫 *${schoolName}*
👥 ${fmt(budget.totalPeople)} people
💰 Daily fuel spend: KES ${fmt(budget.dailyFuelSpendKES)}

━━━ *Quick Comparison* ━━━
🪵 Firewood annual cost: *$${fmt(budget.annualFuelUSD)}* (KES ${fmt(budget.annualFuelKES)})
⚡ Ignis annual cost: *$${fmt(budget.ignisOpexUSD)}* (KES ${fmt(Math.round(budget.ignisOpexUSD * EXCHANGE_RATE))})
✅ *Annual savings: $${fmt(budget.annualSavingsUSD)}* (KES ${fmt(savingsKES)})

━━━ *Investment Required* ━━━
💵 CAPEX: *$${fmt(budget.capexUSD)}* (KES ${fmt(Math.round(capexKES))})
📌 Tier: ${tier}

━━━ *Payback Period* ━━━
⏱️ *${budget.paybackYears} years* to recover investment

━━━ *Environmental Impact* ━━━
🌱 CO₂ reduced: ${fmt(budget.annualCO2Saved)} kg/year
🌳 Trees saved: ${budget.treesSaved}/year

━━━━━━━━━━━━━━━━━━━━━━
👉 Type *"projection"* → 5-year breakdown
👉 Type *"bank options"* → financing plans`;
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
━━━━━━━━━━━━━━━━━━━━━━
🏫 *${schoolName}*
_(5% annual inflation applied)_

`;

  for (const yr of years) {
    const marker = yr.cumSavings >= budget.capexUSD ? '🟢' : '🔵';
    msg += `${marker} *Year ${yr.y}*
  🪵 Firewood: $${fmt(yr.wood)} | ⚡ Ignis: $${fmt(yr.ignis)}
  💰 Saved: *$${fmt(yr.saved)}* | Total: *$${fmt(yr.cumSavings)}*
`;
  }

  msg += `
━━━━━━━━━━━━━━━━━━━━━━
🎯 *5-year total savings: $${fmt(years[4].cumSavings)}*
${years[4].cumSavings >= budget.capexUSD ? '🟢 Investment fully recovered!' : '🔵 $' + fmt(budget.capexUSD - years[4].cumSavings) + ' remaining to recover'}

👉 Type *"bank options"* → financing plans`;

  return msg;
}

function formatBankOptions(schoolName, capexUSD) {
  const capexKES = Math.round(capexUSD * EXCHANGE_RATE);

  let msg = `🏦 *BANK FINANCING SCENARIOS*
━━━━━━━━━━━━━━━━━━━━━━
🏫 *${schoolName}*
💰 Loan: *$${fmt(capexUSD)}* (KES ${fmt(capexKES)})

`;

  for (const bank of BANKS) {
    const r = bank.rate / 100 / 12;

    const pay12 = Math.round(capexUSD * r / (1 - Math.pow(1 + r, -12)));
    const total12 = pay12 * 12;

    const pay24 = Math.round(capexUSD * r / (1 - Math.pow(1 + r, -24)));
    const total24 = pay24 * 24;

    const pay36 = Math.round(capexUSD * r / (1 - Math.pow(1 + r, -36)));
    const total36 = pay36 * 36;

    msg += `*${bank.name}* (${bank.rate}% p.a.)
  12 mo → $${fmt(pay12)}/mo | Total: $${fmt(total12)}
  24 mo → $${fmt(pay24)}/mo | Total: $${fmt(total24)}
  36 mo → $${fmt(pay36)}/mo | Total: $${fmt(total36)}

`;
  }

  msg += `━━━ *Technical Assumptions* ━━━
📌 Exchange rate: 1 USD = KES ${EXCHANGE_RATE}
📌 School days/year: ${SCHOOL_DAYS}
📌 Inflation rate: ${INFLATION * 100}%
📌 Firewood: KES ${FIREWOOD_KES_PER_KG}/kg
📌 CO₂/kg wood: ${CO2_PER_KG_WOOD} kg
📌 Emission reduction: ${EMISSION_CUT * 100}%

━━━━━━━━━━━━━━━━━━━━━━
_Interested? Reach out to the Ignis team to get started! 🔥_
_Rates as of Feb 2026 (CBK base: 8.75%). Subject to bank approval._`;

  return msg;
}

module.exports = {
  calculateBudget,
  checkFuelSpend,
  formatSummary,
  formatProjection,
  formatBankOptions,
  BANKS,
  EXCHANGE_RATE,
  SCHOOL_DAYS
};
