// agent.js — Advanced WhatsApp Bot for Ignis Clean Cooking Pipeline

const Groq = require('groq-sdk');
const {
  buildCache, smartSearch, filterInstitutions,
  getStats, getInstitutionById, getBankRates, getPortfolios,
  getCacheSize, isCacheReady
} = require('./supabase');
const { calculateBudget, checkFuelSpend, formatSummary, formatProjection, formatBankOptions } = require('./budget');

let _groqClient = null;
function getGroqClient() {
  if (!_groqClient) _groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groqClient;
}
const MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'llama-3.2-3b-preview'];

// ——— Session Management ———
const sessions = new Map();
const SESSION_TTL = 30 * 60 * 1000;

function getSession(userId) {
  const s = sessions.get(userId);
  if (s && Date.now() - s.lastActive < SESSION_TTL) {
    s.lastActive = Date.now();
    return s;
  }
  const ns = {
    messages: [],
    lastActive: Date.now(),
    budgetState: null,
    awaitingFuelSpend: null,
    awaitingFuelConfirm: null,
    lastInstitution: null,      // last institution mentioned
    lastFilters: null,          // last multi-filter query
    lastOffset: 0,              // pagination cursor
    lastTotal: 0,               // total in last filter result
    lastSearchType: null        // 'filter' | 'fuzzy'
  };
  sessions.set(userId, ns);
  return ns;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, s] of sessions) if (now - s.lastActive > SESSION_TTL) sessions.delete(k);
}, 10 * 60 * 1000);

// ——— Kenya Counties (47) ———
const KENYA_COUNTIES = [
  'baringo','bomet','bungoma','busia','elgeyo marakwet','embu','garissa',
  'homa bay','homabay','isiolo','kajiado','kakamega','kericho','kiambu','kilifi',
  'kirinyaga','kisii','kisumu','kitui','kwale','laikipia','lamu','machakos',
  'makueni','mandera','marsabit','meru','migori','mombasa','muranga','nairobi',
  'nakuru','nandi','narok','nyamira','nyandarua','nyeri','samburu','siaya',
  'taita taveta','tana river','tharaka nithi','trans nzoia','turkana',
  'uasin gishu','vihiga','wajir','west pokot'
];

// ——— Utility ———
function normalizeMsg(msg) {
  return msg.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

function fmt(n) {
  if (n === null || n === undefined) return '0';
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function extractNumber(msg) {
  const clean = msg.replace(/,/g, '').replace(/kes|ksh|sh/gi, '').trim();
  const match = clean.match(/\d+/);
  return match ? parseInt(match[0]) : null;
}

// ——— Advanced School Name Extractor ———
function extractSchoolName(msg) {
  let name = msg;
  const strips = [
    /^(hey|hi|hello|please|pls|kindly|sorry|okay|ok)\s+/i,
    /^(i want to see|i want to get|i would like|can i get|can you get me|can you get|i want|i need|can i|can you|could you|would you|give me|get me|show me|let me see|let me get)\s+/i,
    /^(to get|to see|to know|to check|to view|to run)\s+/i,
    /^(the|a|an)\s+/i,
    /^(budget|capex|cost|investment|pricing|price)\s*(report|calculation|estimate|breakdown)?\s*(for|of|on)?\s*/i,
    /^(how much)\s*(for|is|does|will|would)?\s*/i,
    /^(the|a|an)\s+/i,
    /^(this|that)\s+(school|institution|hospital|one)\s*/i,
    /^(school|institution|hospital)\s*/i,
  ];
  for (const re of strips) name = name.replace(re, '');
  return name.replace(/\?/g, '').trim();
}

function isContextualRef(name) {
  const n = name.toLowerCase().trim();
  return /^(that|this|it|the same|same|that one|this one|the school|that school|this school|the hospital|this institution|that institution)$/i.test(n) || n.length <= 2;
}

// ——— Advanced Query Parser ———
// Extracts structured filters from natural language
function parseQuery(msg) {
  const m = normalizeMsg(msg);
  const filters = {
    county: null,
    institution_type: null,
    school_type: null,
    method_of_cooking: null,
    ownership_type: null,
    existing_loan: null,
    min_people: null,
    has_missing: false
  };

  // County detection
  for (const c of KENYA_COUNTIES) {
    if (m.includes(c)) { filters.county = c; break; }
  }

  // Institution type
  if (/hospital|clinic|health centre|dispensary/.test(m)) filters.institution_type = 'Hospital';
  else if (/prison|correctional|remand|borstal/.test(m)) filters.institution_type = 'Correctional';
  else if (/\bschool\b/.test(m)) filters.institution_type = 'School';

  // School type
  if (/\bprimary\b/.test(m)) filters.school_type = 'Primary';
  else if (/\bsecondary\b|\bhigh school\b/.test(m)) filters.school_type = 'Secondary';

  // Cooking method
  if (/\bwood\b|\bfirewood\b/.test(m)) filters.method_of_cooking = 'Wood';
  else if (/\bcharcoal\b/.test(m)) filters.method_of_cooking = 'Charcoal';
  else if (/\bgas\b|\blpg\b/.test(m)) filters.method_of_cooking = 'Gas';

  // Ownership type
  if (/\bgovernment\b|\bpublic\b|\bstate\b/.test(m)) filters.ownership_type = 'Government';
  else if (/\bprivate\b/.test(m)) filters.ownership_type = 'Private';
  else if (/\bfaith\b|\breligious\b|\bchurch\b|\bmission\b|\bcatholic\b|\bislamic\b|\bprotestant\b/.test(m)) filters.ownership_type = 'Faith-Based';

  // Loan status
  if (/has loan|have loan|with loan|existing loan|has a loan/.test(m)) filters.existing_loan = 'Yes';
  else if (/no loan|without loan|dont have loan|no existing loan/.test(m)) filters.existing_loan = 'No';

  // Population filter
  const overMatch = m.match(/(?:over|more than|above|at least|greater than)\s+(\d[\d,]*)\s*(?:students|people|pupils)?/);
  if (overMatch) filters.min_people = parseInt(overMatch[1].replace(/,/g, ''));

  // Missing data
  if (/missing|incomplete|missing data|missing fields/.test(m)) filters.has_missing = true;

  return filters;
}

function hasFilters(f) {
  return !!(f.county || f.institution_type || f.school_type || f.method_of_cooking ||
    f.ownership_type || f.existing_loan != null || f.min_people || f.has_missing);
}

// Build human-readable description of active filters
function describeFilters(f) {
  const parts = [];
  if (f.ownership_type) parts.push(f.ownership_type);
  if (f.school_type) parts.push(f.school_type);
  if (f.institution_type) parts.push(f.institution_type + 's');
  else parts.push('Institutions');
  if (f.method_of_cooking) parts.push(`using ${f.method_of_cooking}`);
  if (f.county) parts.push(`in ${titleCase(f.county)}`);
  if (f.existing_loan === 'Yes') parts.push('with existing loans');
  if (f.existing_loan === 'No') parts.push('without loans');
  if (f.min_people) parts.push(`(${fmt(f.min_people)}+ people)`);
  if (f.has_missing) parts.push('[incomplete data]');
  return parts.join(' ');
}

function titleCase(str) {
  return str.replace(/\w\S*/g, t => t.charAt(0).toUpperCase() + t.substr(1).toLowerCase());
}

// ——— Formatters ———
function formatInstitutionCard(inst, idx = null) {
  const num = idx != null ? `${idx + 1}. ` : '';
  const missing = Array.isArray(inst.missing_fields) && inst.missing_fields.length > 0 ? ' ⚠️' : '';
  const type = inst.school_type ? `${inst.school_type}` : (inst.institution_type || 'N/A');
  return `${num}🏫 *${inst.name}*${missing}\n   📍 ${inst.county || 'N/A'} | ${type} | ${inst.method_of_cooking || 'N/A'} | 👥 ${fmt(inst.number_of_people || 0)}`;
}

function formatInstitutionDetail(inst) {
  const missing = Array.isArray(inst.missing_fields) && inst.missing_fields.length > 0;
  let r = `🏫 *${inst.name}*\n━━━━━━━━━━━━━━━━━━━━\n`;
  r += `📍 County: *${inst.county || 'N/A'}*\n`;
  r += `🏛️ Type: *${inst.institution_type || 'N/A'}*${inst.school_type ? ` (${inst.school_type})` : ''}\n`;
  r += `🏢 Ownership: *${inst.ownership_type || 'N/A'}*\n`;
  r += `👥 People: *${fmt(inst.number_of_people || 0)}*\n`;
  r += `🍳 Meals/day: *${inst.meals_per_day || 'N/A'}*\n`;
  r += `🪵 Cooking: *${inst.method_of_cooking || 'N/A'}*\n`;
  if (inst.bank_name) r += `🏦 Bank: *${inst.bank_name}*\n`;
  if (inst.existing_loan) r += `💳 Existing Loan: *${inst.existing_loan}*\n`;
  if (missing) r += `⚠️ Missing: ${inst.missing_fields.slice(0, 4).join(', ')}${inst.missing_fields.length > 4 ? '...' : ''}\n`;
  r += `\n💰 *"budget for ${inst.name}"* → get full budget`;
  return r;
}

function formatInstitutionList(items, total, offset, limit, title = '') {
  const end = Math.min(offset + limit, total);
  let r = '';
  if (title) r += `🔍 *${title}*\n`;
  r += `📊 Showing *${offset + 1}–${end}* of *${fmt(total)}*\n\n`;
  items.forEach((s, i) => { r += formatInstitutionCard(s, offset + i) + '\n\n'; });
  if (total > end) r += `_...${fmt(total - end)} more. Say *"show more"* to continue._\n`;
  r += `\n💰 Say *"budget for [name]"* to run a budget`;
  return r;
}

// ——— Budget Flow Helpers ———
function startBudgetFlow(inst, session) {
  session.lastInstitution = inst;
  session.awaitingFuelSpend = inst;
  return `Found it! 🏫 *${inst.name}*
📍 ${inst.county} | ${inst.school_type || inst.institution_type} | ${inst.method_of_cooking || 'N/A'}
👥 *${fmt(inst.number_of_people || 0)}* people | 🍳 *${inst.meals_per_day || 'N/A'}* meals/day

💰 *What's the daily fuel spend in KES?*
_(Just type the number, e.g. 15000)_`;
}

// ——— Static Knowledge ———
const ABOUT_IGNIS = `🔥 *About Ignis Innovation Africa*
━━━━━━━━━━━━━━━━━━━━

Ignis helps institutions in Kenya transition from *wood and charcoal* to *clean, efficient cooking systems* — saving money and protecting health.

🌍 *Why Clean Cooking?*
• Indoor air pollution from wood/charcoal is a *top health risk*
• Kenya loses *88,000 hectares* of forest every year
• Clean cooking cuts fuel costs by *up to 50%*
• Reduces CO₂ emissions by *up to 90%*

🏫 *Our Pipeline*
• *1,090+ institutions* across all *47 counties*
• Schools, hospitals & correctional facilities
• Mostly government institutions using wood

💰 *CAPEX Tiers*
• Under 1,000 people → *$50,000*
• 1,000–1,500 people → *$73,000*
• Over 1,500 people → *$90,000*

🏦 *Bank Partners*
ABSA (13.9%) | Equity (15.5%) | KCB (15.8%)

Want to look up an institution or run a budget? Just ask! 😊`;

const HELP_TEXT = `📋 *What I can do — full list:*
━━━━━━━━━━━━━━━━━━━━

🔍 *Search (single or combined filters)*
  → "find Lugulu Girls"
  → "secondary schools in Nakuru"
  → "government schools using wood"
  → "hospitals in Kisumu"
  → "private schools with existing loans"
  → "faith-based schools over 1000 students"
  → "schools missing data"

💰 *Run a Budget*
  → "budget for AIC Sengani"
  → Then type the daily fuel spend
  → "projection" → 5-year breakdown
  → "bank options" → financing plans

📊 *Stats & Analytics*
  → "pipeline summary"
  → "cooking stats"
  → "loan breakdown"
  → "ownership breakdown"
  → "top counties"
  → "tell me about Nakuru county"

🔥 *About Ignis*
  → "what is clean cooking?"
  → "tell me about Ignis"

💡 *Tips*
  → I handle typos & partial names
  → Say *"show more"* to see more results
  → Context aware — ask follow-up questions!`;

const GREETING = `Hey there! 👋 Welcome to *Ignis Clean Cooking* 🔥

I can help you with:
🔍 *Find any institution* — by name, county, type, cooking method & more
💰 *Run budgets* — CAPEX, savings, payback & bank financing
📊 *Pipeline stats* — cooking methods, counties, loans & trends
🏥 *All types* — schools, hospitals, correctional facilities

What do you need? Just ask naturally — I understand typos too! 😎`;

// ——— Main Router ———
async function routeMessage(msg, session) {
  const m = normalizeMsg(msg);

  // ——— GREETINGS ———
  if (/^(hi|hello|hey|habari|sasa|mambo|yo|sup|whats up|good morning|good afternoon|good evening|hola|hii|helo|helllo)(\s|$|!|\?)/.test(m)) {
    return GREETING;
  }

  // ——— THANK YOU / BYE ———
  if (/^(thanks|thank you|thanx|tnx|cheers|bye|goodbye|see you|asante|great|awesome|perfect|nice)/.test(m)) {
    return "You're welcome! Hit me up anytime 👊🔥";
  }

  // ——— HELP ———
  if (/^(help|menu|what can you|what do you|how do i|commands|options|features)/.test(m)) {
    return HELP_TEXT;
  }

  // ——— ABOUT / CLEAN COOKING KNOWLEDGE ———
  if (/(clean cooking|about ignis|what is ignis|tell me about ignis|who are you|what do you do|what is this|about clean|ignis innovation)/.test(m)) {
    return ABOUT_IGNIS;
  }

  // ——— CACHE STATUS ———
  if (/cache|status|ready|loaded/.test(m) && /bot|system|data/.test(m)) {
    return `✅ System status: *${isCacheReady() ? 'Ready' : 'Loading...'}*\n📦 Institutions cached: *${fmt(getCacheSize())}*`;
  }

  // ——— AWAIT FUEL CONFIRM (sanity check warning was shown) ———
  if (session.awaitingFuelConfirm) {
    const { school, amount } = session.awaitingFuelConfirm;
    if (/^(go|proceed|yes|ok|okay|continue|calculate|use it|use that)/.test(m)) {
      const budget = calculateBudget(school.number_of_people || school.total_people, amount);
      session.budgetState = { name: school.name, budget };
      session.awaitingFuelConfirm = null;
      return formatSummary(school.name, budget);
    }
    const newNum = extractNumber(msg);
    if (newNum && newNum > 0) {
      const warning = checkFuelSpend(newNum, school.number_of_people || school.total_people);
      if (warning) { session.awaitingFuelConfirm.amount = newNum; return warning; }
      const budget = calculateBudget(school.number_of_people || school.total_people, newNum);
      session.budgetState = { name: school.name, budget };
      session.awaitingFuelConfirm = null;
      return formatSummary(school.name, budget);
    }
    return `Type a new fuel amount in KES, or *"go"* to calculate with KES ${fmt(amount)}.`;
  }

  // ——— AWAIT FUEL SPEND ———
  if (session.awaitingFuelSpend) {
    const num = extractNumber(msg);
    if (num && num > 0) {
      const inst = session.awaitingFuelSpend;
      const people = inst.number_of_people || inst.total_people || 1;
      const warning = checkFuelSpend(num, people);
      if (warning) {
        session.awaitingFuelConfirm = { school: inst, amount: num };
        session.awaitingFuelSpend = null;
        return warning;
      }
      const budget = calculateBudget(people, num);
      session.budgetState = { name: inst.name, budget };
      session.awaitingFuelSpend = null;
      return formatSummary(inst.name, budget);
    }
    // User might have said the school name again — let it continue routing
    // but first check if it's really not a number
    if (/^\d/.test(msg.trim())) {
      return `I need a number for the fuel spend 🤔 e.g. *15000*`;
    }
  }

  // ——— PROJECTION ———
  if (/(projection|5.?year|five.?year|forecast|yearly breakdown)/.test(m) && session.budgetState) {
    return formatProjection(session.budgetState.name, session.budgetState.budget);
  }

  // ——— BANK OPTIONS ———
  if (/(bank option|bank plan|financ|loan option|repayment|monthly payment|how much.*month)/.test(m) && session.budgetState) {
    return await formatBankOptions(session.budgetState.name, session.budgetState.budget.capexUSD);
  }

  // ——— BANK RATES (standalone query) ———
  if (/(bank rate|interest rate|best bank|which bank|compare bank|bank comparison)/.test(m) && !session.budgetState) {
    const banks = await getBankRates();
    let r = `🏦 *Current Bank Rates*\n━━━━━━━━━━━━━━━━━━━━\n_(As of Feb 2026, CBK base: 8.75%)_\n\n`;
    for (const b of banks) r += `• *${b.bank_name}*: ${b.rate}% p.a.\n`;
    r += `\nRun a budget first to see exact monthly payments!\nSay: *"budget for [institution name]"*`;
    return r;
  }

  // ——— SHOW MORE (pagination) ———
  if (/^(show more|more|next|continue|next page|see more|load more)(\s|$)/.test(m)) {
    if (session.lastFilters && session.lastTotal > session.lastOffset + 8) {
      session.lastOffset += 8;
      const { total, items } = filterInstitutions(session.lastFilters, session.lastOffset, 8);
      return formatInstitutionList(items, total, session.lastOffset, 8, describeFilters(session.lastFilters));
    }
    return `No more results 😊 Try a different search!`;
  }

  // ——— BUDGET REQUEST ———
  if (/(budget|capex|cost for|investment for|how much for|pricing for|how much is|price for|calculate for)/.test(m)) {
    let schoolName = extractSchoolName(msg);

    if (isContextualRef(schoolName) || schoolName.length <= 2) {
      if (session.lastInstitution) return startBudgetFlow(session.lastInstitution, session);
      return `Which institution do you want a budget for? 🏫\ne.g. *"budget for Lugulu Girls"*`;
    }

    if (schoolName.length > 2) {
      const matches = smartSearch(schoolName, 3);
      if (matches.length === 1) return startBudgetFlow(matches[0], session);
      if (matches.length > 1) {
        session.lastFilters = { nameQuery: schoolName };
        session.lastOffset = 0;
        session.lastTotal = matches.length;
        let r = `Found ${matches.length} matches — which one?\n\n`;
        matches.slice(0, 5).forEach((s, i) => { r += `${i + 1}. 🏫 *${s.name}* — ${s.county}\n`; });
        r += `\nSay the full name for a budget!`;
        return r;
      }
      return `Hmm, couldn't find "*${schoolName}*" 🤔\n\nTry:\n• *"find [name]"* to search\n• Check the spelling\n• Say a partial name`;
    }
    return `Which institution do you want a budget for? 🏫\ne.g. *"budget for AIC Sengani"*`;
  }

  // ——— PORTFOLIO ———
  if (/(portfolio|portfolios)/.test(m)) {
    const portfolios = await getPortfolios();
    if (!portfolios || portfolios.length === 0) return `No portfolios found in the system yet.`;
    let r = `📁 *Portfolios*\n━━━━━━━━━━━━━━━━━━━━\n`;
    portfolios.slice(0, 10).forEach((p, i) => {
      const name = p.name || p.portfolio_name || p.title || `Portfolio ${i + 1}`;
      r += `${i + 1}. *${name}*\n`;
      if (p.description) r += `   ${p.description}\n`;
    });
    return r;
  }

  // ——— PIPELINE SUMMARY ———
  if (/(pipeline|summary|overview|dashboard|big picture|overall|statistics|stats)/.test(m)) {
    const s = getStats();
    const topCounties = Object.entries(s.county).sort((a, b) => b[1].count - a[1].count).slice(0, 5);

    let r = `📊 *Ignis Pipeline Summary*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
    r += `🏫 Total institutions: *${fmt(s.total)}*\n`;
    r += `📍 Counties covered: *${Object.keys(s.county).length}*\n`;
    r += `👥 Total people served: *${fmt(s.totalPeople)}*\n\n`;

    r += `🔥 *By Cooking Method:*\n`;
    Object.entries(s.cooking).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
      const pct = ((v / s.total) * 100).toFixed(1);
      r += `  • ${k}: *${fmt(v)}* (${pct}%)\n`;
    });

    r += `\n🏛️ *By Institution Type:*\n`;
    Object.entries(s.type).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
      r += `  • ${k}: *${fmt(v)}*\n`;
    });

    r += `\n💳 *Loan Status:*\n`;
    r += `  • With loan: *${fmt(s.loanYes)}*\n`;
    r += `  • No loan: *${fmt(s.loanNo)}*\n\n`;

    r += `📍 *Top 5 Counties:*\n`;
    topCounties.forEach(([c, d], i) => {
      r += `  ${i + 1}. ${titleCase(c)}: *${fmt(d.count)}* institutions\n`;
    });
    return r;
  }

  // ——— COOKING STATS ———
  if (/(cooking stat|cooking method|who uses wood|who uses charcoal|who uses gas|fuel type|method breakdown|how many use)/.test(m)) {
    const s = getStats();
    let r = `🔥 *Cooking Method Breakdown*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
    Object.entries(s.cooking).sort((a, b) => b[1] - a[1]).forEach(([method, count]) => {
      const pct = ((count / s.total) * 100).toFixed(1);
      const emoji = method === 'Wood' ? '🪵' : method === 'Gas' ? '⛽' : method === 'Charcoal' ? '🔥' : '❓';
      r += `${emoji} *${method}*: ${fmt(count)} institutions (${pct}%)\n`;
    });
    r += `\n📊 Total: *${fmt(s.total)}* institutions`;
    return r;
  }

  // ——— LOAN STATS ———
  if (/(loan stat|loan breakdown|loan summary|how many.*loan|existing loan.*breakdown|who has loan)/.test(m) && !session.budgetState) {
    const s = getStats();
    const loanPct = s.total > 0 ? ((s.loanYes / s.total) * 100).toFixed(1) : 0;
    let r = `💳 *Loan Status Breakdown*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
    r += `✅ With existing loan: *${fmt(s.loanYes)}* (${loanPct}%)\n`;
    r += `❌ No existing loan: *${fmt(s.loanNo)}*\n\n`;
    r += `📊 Total institutions: *${fmt(s.total)}*\n\n`;
    r += `_Search: "schools with existing loans" to see the list_`;
    return r;
  }

  // ——— OWNERSHIP BREAKDOWN ———
  if (/(ownership|ownership breakdown|government.*breakdown|private.*breakdown|how many.*government|how many.*private)/.test(m) && !session.lastFilters) {
    const s = getStats();
    let r = `🏢 *Ownership Breakdown*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
    Object.entries(s.ownership).sort((a, b) => b[1] - a[1]).forEach(([o, c]) => {
      const pct = ((c / s.total) * 100).toFixed(1);
      r += `• *${o}*: ${fmt(c)} (${pct}%)\n`;
    });
    return r;
  }

  // ——— TOP COUNTIES ———
  if (/(top counties|top county|most institutions|most schools|county ranking|which county.*most)/.test(m)) {
    const s = getStats();
    const sorted = Object.entries(s.county).sort((a, b) => b[1].count - a[1].count).slice(0, 10);
    let r = `📍 *Top 10 Counties*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
    sorted.forEach(([c, d], i) => {
      r += `${i + 1}. *${titleCase(c)}* — ${fmt(d.count)} institutions (${fmt(d.people)} people)\n`;
    });
    return r;
  }

  // ——— ALL INSTITUTIONS ———
  if (/(all institutions|all schools|list all|show all|every institution|full list|how many institution|how many school|total number)/.test(m)) {
    const s = getStats();
    return `We have *${fmt(s.total)} institutions* across *${Object.keys(s.county).length} counties* — too many to list here 😅\n\nNarrow it down:\n• County → "schools in Nairobi"\n• Type → "secondary schools"\n• Method → "who uses charcoal?"\n• Ownership → "government schools"\n• Combined → "government secondary schools in Nakuru using wood"\n\nWhat works for you?`;
  }

  // ——— COUNTY-SPECIFIC DETAIL ———
  const countyMatch = KENYA_COUNTIES.find(c => m.includes(c));
  if (countyMatch && /(schools in|institutions in|tell me about|county|detail|breakdown)/.test(m)) {
    const filters = { county: countyMatch };
    const s = getStats();
    const countyData = s.county[countyMatch] || s.county[Object.keys(s.county).find(k => k.toLowerCase() === countyMatch)] || { count: 0, people: 0 };

    // Get cooking method breakdown for this county
    const { total, items } = filterInstitutions(filters, 0, 8);
    const cookingCounts = {};
    items.forEach(i => {
      const m = i.method_of_cooking || 'Unknown';
      cookingCounts[m] = (cookingCounts[m] || 0) + 1;
    });

    let r = `📍 *${titleCase(countyMatch)} County*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
    r += `🏫 Total institutions: *${fmt(total)}*\n`;
    r += `👥 Total people: *${fmt(countyData.people)}*\n\n`;
    r += `📋 *First ${Math.min(total, 8)} institutions:*\n`;
    items.forEach((inst, i) => { r += `\n${formatInstitutionCard(inst, i)}`; });
    if (total > 8) r += `\n\n_...and ${fmt(total - 8)} more. Say *"show more"* to continue._`;

    session.lastFilters = filters;
    session.lastOffset = 0;
    session.lastTotal = total;
    return r;
  }

  // ——— MULTI-FILTER SEARCH (smart combination) ———
  const parsedFilters = parseQuery(msg);

  if (hasFilters(parsedFilters)) {
    // Check if there's also a name component
    let nameComponent = msg;
    if (parsedFilters.county) nameComponent = nameComponent.replace(new RegExp(parsedFilters.county, 'gi'), '');
    nameComponent = nameComponent
      .replace(/\b(primary|secondary|school|hospital|correctional|government|private|faith.?based|wood|charcoal|gas|find|search|show|list|with|using|that use|no loan|existing loan|institutions?|missing|incomplete|over|more than)\b/gi, '')
      .replace(/\d+/g, '').replace(/\?/g, '').trim();

    // If name component is meaningful, add it as nameQuery
    if (nameComponent.length > 3) parsedFilters.nameQuery = nameComponent;

    const { total, items } = filterInstitutions(parsedFilters, 0, 8);

    session.lastFilters = parsedFilters;
    session.lastOffset = 0;
    session.lastTotal = total;

    if (total === 0) {
      return `No institutions found for: *${describeFilters(parsedFilters)}* 🤔\n\nTry removing some filters or check the spelling.`;
    }

    if (total === 1) {
      session.lastInstitution = items[0];
      return formatInstitutionDetail(items[0]);
    }

    return formatInstitutionList(items, total, 0, 8, describeFilters(parsedFilters));
  }

  // ——— FUZZY NAME SEARCH ———
  const searchTerm = msg
    .replace(/^(find|search|look up|lookup|show me|where is|details|info about|information on|information about|tell me about)\s*/i, '')
    .replace(/institution|school|hospital/gi, '').replace(/\?/g, '').trim();

  if (searchTerm.length > 2) {
    const matches = smartSearch(searchTerm, 8);
    if (matches.length > 0) {
      session.lastInstitution = matches[0];

      if (matches.length === 1) return formatInstitutionDetail(matches[0]);

      session.lastFilters = { nameQuery: searchTerm };
      session.lastOffset = 0;
      session.lastTotal = matches.length;
      return formatInstitutionList(matches, matches.length, 0, 8, `Search: "${searchTerm}"`);
    }
  }

  return null; // fall through to LLM
}

// ——— LLM System Prompt ———
const SYSTEM_PROMPT = `You are *Ignis Bot* — an expert WhatsApp assistant for the Ignis Clean Cooking pipeline across Kenya. You serve field agents and management.

*Data available:*
- 1,090+ institutions (schools, hospitals, correctional facilities) in all 47 Kenyan counties
- Fields: name, county, institution_type, school_type, number_of_people, meals_per_day, method_of_cooking, ownership_type, existing_loan (Yes/No), missing_fields, gps_location
- Budget data: CAPEX $50K/<1000 people, $73K/1000-1500, $90K/>1500. Ignis saves ~50% of annual fuel costs.
- Bank partners: ABSA 13.9%, Equity 15.5%, KCB 15.8%

*Your style:*
- Casual, warm, like texting a helpful colleague
- Use *bold* and emojis naturally
- Keep responses SHORT (WhatsApp limit!) — max 400 chars for simple answers
- Always offer next steps

*If you can't find data, be honest:* "I don't have that info — try 'find [name]' or 'help' to see what I can do 😊"

Respond in English only.`;

const LLM_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_institutions',
      description: 'Search institutions with flexible filters. All params optional. Returns matching institutions.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Partial institution name' },
          county: { type: 'string', description: 'Kenyan county name' },
          institution_type: { type: 'string', enum: ['School', 'Hospital', 'Correctional'], description: 'Type of institution' },
          school_type: { type: 'string', enum: ['Primary', 'Secondary'], description: 'School level (schools only)' },
          method_of_cooking: { type: 'string', enum: ['Wood', 'Gas', 'Charcoal'], description: 'Current cooking method' },
          ownership_type: { type: 'string', enum: ['Government', 'Private', 'Faith-Based'], description: 'Who owns the institution' },
          existing_loan: { type: 'string', enum: ['Yes', 'No'], description: 'Whether institution has an existing loan' },
          min_people: { type: 'number', description: 'Minimum number of people' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_pipeline_stats',
      description: 'Get aggregate statistics: total count, cooking methods breakdown, institution types, loan status, top counties.',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  }
];

async function executeTool(name, args, session) {
  if (name === 'search_institutions') {
    const filters = {};
    if (args.name) filters.nameQuery = args.name;
    if (args.county) filters.county = args.county;
    if (args.institution_type) filters.institution_type = args.institution_type;
    if (args.school_type) filters.school_type = args.school_type;
    if (args.method_of_cooking) filters.method_of_cooking = args.method_of_cooking;
    if (args.ownership_type) filters.ownership_type = args.ownership_type;
    if (args.existing_loan) filters.existing_loan = args.existing_loan;
    if (args.min_people) filters.min_people = args.min_people;

    const { total, items } = filterInstitutions(filters, 0, 8);
    if (session && items.length > 0) session.lastInstitution = items[0];
    return JSON.stringify({ total_found: total, showing: items.length, institutions: items.map(i => ({
      name: i.name, county: i.county, type: i.institution_type, school_type: i.school_type,
      people: i.number_of_people, cooking: i.method_of_cooking, ownership: i.ownership_type,
      existing_loan: i.existing_loan
    }))});
  }

  if (name === 'get_pipeline_stats') {
    const s = getStats();
    return JSON.stringify({
      total: s.total, total_people: s.totalPeople,
      cooking_methods: s.cooking, institution_types: s.type,
      ownership: s.ownership, loans: { yes: s.loanYes, no: s.loanNo },
      counties_covered: Object.keys(s.county).length,
      top_counties: Object.entries(s.county).sort((a, b) => b[1].count - a[1].count).slice(0, 5).map(([c, d]) => ({ county: c, count: d.count }))
    });
  }

  return JSON.stringify({ error: 'Unknown tool' });
}

async function callLLM(messages) {
  for (const model of MODELS) {
    try {
      const res = await getGroqClient().chat.completions.create({
        model, max_tokens: 500, messages, tools: LLM_TOOLS, tool_choice: 'auto'
      });
      return res;
    } catch (e) {
      console.log(`⚠️ ${model}: ${e.message?.substring(0, 60)}`);
      if (!e.message?.includes('429') && !e.message?.includes('rate_limit') && !e.message?.includes('tool_use_failed')) throw e;
    }
  }
  return null;
}

// ——— Main Entry ———
async function processMessage(userMessage, userId = 'default') {
  const session = getSession(userId);
  const msg = userMessage.trim();
  if (!msg) return "Send me a message and I'll help! 😊";

  // Keyword router (handles ~95% of queries without LLM)
  try {
    const reply = await routeMessage(msg, session);
    if (reply) {
      session.messages.push({ role: 'user', content: msg });
      session.messages.push({ role: 'assistant', content: '[direct]' });
      return reply;
    }
  } catch (err) {
    console.error('Router error:', err.message);
  }

  // LLM fallback
  session.messages.push({ role: 'user', content: msg });
  if (session.messages.length > 10) session.messages = session.messages.slice(-10);

  try {
    const res = await callLLM([{ role: 'system', content: SYSTEM_PROMPT }, ...session.messages]);
    if (!res) {
      return `I'm a bit busy right now 😅 But try these:\n• *"find [name]"*\n• *"budget for [name]"*\n• *"schools in [county]"*\n• *"help"* — see everything I can do`;
    }

    let msg2 = res.choices[0].message;
    let attempts = 0;

    while (msg2.tool_calls?.length > 0 && attempts < 3) {
      attempts++;
      session.messages.push(msg2);
      for (const tc of msg2.tool_calls) {
        const args = JSON.parse(tc.function.arguments || '{}');
        console.log(`🔧 ${tc.function.name}`, args);
        const result = await executeTool(tc.function.name, args, session);
        session.messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
      }
      const next = await callLLM([{ role: 'system', content: SYSTEM_PROMPT }, ...session.messages]);
      if (!next) break;
      msg2 = next.choices[0].message;
    }

    const reply = msg2.content || "Not sure I got that 🤔 Try *help* to see what I can do!";
    session.messages.push({ role: 'assistant', content: reply });
    return reply;
  } catch (err) {
    console.error('LLM error:', err.message);
    return `Something went wrong 😅 Try:\n• *"find [name]"*\n• *"budget for [name]"*\n• *"help"*`;
  }
}

// ——— Exported buildSearchIndex shim (called by server.js) ———
async function buildSearchIndex() {
  await buildCache();
}

module.exports = { processMessage, buildSearchIndex };
