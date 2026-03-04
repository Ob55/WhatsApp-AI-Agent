const Groq = require('groq-sdk');
const Fuse = require('fuse.js');
const Institution = require('./models/Institution');
const {
  calculateBudget,
  formatSummary,
  formatProjection,
  formatBankOptions
} = require('./budget');

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Models to try in order (fallback chain)
const MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'llama-3.2-3b-preview'
];

// ——— Fuzzy Search Engine ———
let fuseIndex = null;
let schoolNames = [];

async function buildSearchIndex() {
  if (fuseIndex) return;
  const schools = await Institution.find({}, 'name county cooking_method school_type total_people total_meals_per_day').lean();
  schoolNames = schools;
  fuseIndex = new Fuse(schools, {
    keys: ['name'],
    threshold: 0.4,     // tolerant of typos
    distance: 100,
    includeScore: true
  });
  console.log(`🔍 Search index built: ${schools.length} schools`);
}

function fuzzySearch(query, limit = 10) {
  if (!fuseIndex) return [];
  const results = fuseIndex.search(query, { limit });
  return results.map(r => r.item);
}

// ——— Session Management ———
const sessions = new Map();
const SESSION_TTL = 30 * 60 * 1000;

function getSession(userId) {
  const s = sessions.get(userId);
  if (s && Date.now() - s.lastActive < SESSION_TTL) {
    s.lastActive = Date.now();
    return s;
  }
  const ns = { messages: [], lastActive: Date.now(), budgetState: null, awaitingFuelSpend: null };
  sessions.set(userId, ns);
  return ns;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, s] of sessions) if (now - s.lastActive > SESSION_TTL) sessions.delete(k);
}, 10 * 60 * 1000);

// ——— Knowledge Base (no LLM needed) ———

const CLEAN_COOKING_INFO = `🔥 *About Ignis Clean Cooking*
━━━━━━━━━━━━━━━━━━━━

Ignis helps institutions in Kenya transition from *wood and charcoal* to *clean cooking solutions* — saving money, protecting forests, and reducing harmful smoke.

🌍 *Why Clean Cooking?*
• Wood & charcoal cause *indoor air pollution* — a leading health risk
• Deforestation destroys *88,000 hectares* of Kenyan forest per year
• Clean cooking cuts fuel costs by *up to 50%*
• Reduces CO₂ emissions by *up to 90%*

🏫 *What We Do*
• Assess schools currently using wood/charcoal
• Calculate the *investment (CAPEX)* and *annual savings*
• Help schools get *bank financing* (Equity, ABSA, KCB)
• Install clean cooking systems (Ignis technology)

📊 *Our Pipeline*
• *1,090 schools* across *47 counties* in Kenya
• Mostly government schools using *wood* (94%)
• Primary and Secondary schools

Want me to look up a specific school or run a budget? Just ask! 😊`;

const HELP_TEXT = `📋 *Here's what I can do:*
━━━━━━━━━━━━━━━━━━━━

🔍 *Find a school*
  → "find Lugulu Girls"
  → "schools in Nairobi"
  → "schools using charcoal"
  → "secondary schools in Kisumu"

💰 *Run a budget*
  → "budget for Lugulu Girls"
  → Then I'll ask for the daily fuel spend

📊 *Get stats*
  → "pipeline summary"
  → "cooking stats"
  → "top counties"
  → "tell me about Bungoma county"

🔥 *Learn about clean cooking*
  → "what is clean cooking?"
  → "tell me about Ignis"

Just type what you need — I can handle typos too! 😎`;

const GREETING = `Hey there! 👋 Welcome to *Ignis Clean Cooking* 🔥

Here's what I can do for you:
📋 *Find a school* — search by name, county, or type
🔥 *Cooking stats* — see who uses wood, gas, charcoal
💰 *Run a budget* — get CAPEX, savings & bank plans
📊 *Pipeline stats* — the big picture

Just ask away! What do you need?`;

// ——— Smart Keyword Router (no LLM needed for common requests) ———

function normalizeMsg(msg) {
  return msg.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

// All 47 Kenya counties for matching
const KENYA_COUNTIES = [
  'baringo','bomet','bungoma','busia','elgeyo marakwet','embu','garissa',
  'homabay','homa bay','isiolo','kajiado','kakamega','kericho','kiambu','kilifi',
  'kirinyaga','kisii','kisumu','kitui','kwale','laikipia','lamu','machakos',
  'makueni','mandera','marsabit','meru','migori','mombasa','muranga','murang\'a',
  'nairobi','nakuru','nandi','narok','nyamira','nyandarua','nyeri','samburu',
  'siaya','taita taveta','tana river','tharaka nithi','trans nzoia','turkana',
  'uasin gishu','vihiga','wajir','west pokot'
];

async function routeMessage(msg, session) {
  const m = normalizeMsg(msg);
  await buildSearchIndex();

  // ——— GREETINGS ———
  if (/^(hi|hello|hey|habari|sasa|mambo|yo|sup|whats up|good morning|good afternoon|good evening|hola|ola|hii|helo|helllo)(\s|$|!)/.test(m)) {
    return GREETING;
  }

  // ——— THANK YOU / GOODBYE ———
  if (/^(thanks|thank you|thanx|tnx|cheers|bye|goodbye|see you|asante|pole)/.test(m)) {
    return "You're welcome! Hit me up anytime you need something 👊🔥";
  }

  // ——— HELP / WHAT CAN YOU DO ———
  if (/^(help|menu|what can you|what do you|how do i|how does this|commands|options)/.test(m)) {
    return HELP_TEXT;
  }

  // ——— CLEAN COOKING KNOWLEDGE ———
  if (/(clean cooking|about ignis|what is ignis|tell me about ignis|what do you do|about clean|what is this|who are you)/.test(m)) {
    return CLEAN_COOKING_INFO;
  }

  // ——— AWAITING FUEL SPEND (budget flow step 2) ———
  if (session.awaitingFuelSpend) {
    const num = extractNumber(msg);
    if (num && num > 0) {
      const school = session.awaitingFuelSpend;
      const budget = calculateBudget(school.total_people, num);
      session.budgetState = { school: school.name, budget };
      session.awaitingFuelSpend = null;
      return formatSummary(school.name, budget);
    }
    return `I need a number for the daily fuel spend in KES 🤔\n\nJust type the amount, like *5000* or *12000*`;
  }

  // ——— PROJECTION ———
  if (/(projection|5.?year|five.?year|forecast|yearly breakdown)/.test(m) && session.budgetState) {
    return formatProjection(session.budgetState.school, session.budgetState.budget);
  }

  // ——— BANK OPTIONS ———
  if (/(bank|financ|loan|lending|repay|monthly payment)/.test(m) && session.budgetState) {
    return formatBankOptions(session.budgetState.school, session.budgetState.budget.capexUSD);
  }

  // ——— BUDGET REQUEST ———
  if (/(budget|capex|cost for|investment for|how much for|pricing for|cost of|price of|price for)/.test(m)) {
    const schoolName = extractSchoolName(msg);
    if (schoolName.length > 2) {
      const matches = fuzzySearch(schoolName, 1);
      if (matches.length > 0) {
        const school = matches[0];
        session.awaitingFuelSpend = school;
        return `Found it! 🏫 *${school.name}* in *${school.county}*\n👥 *${fmt(school.total_people)}* students | 🍳 *${school.total_meals_per_day}* meals/day | 🪵 Currently using *${school.cooking_method}*\n\nTo run the budget, I need one thing:\n💰 *What's the daily fuel spend in KES?*\n_(e.g. just type 5000)_`;
      }
      return `Hmm, I couldn't find a school matching "${schoolName}" 🤔\n\nTry the full name or check the spelling. You can also say *"find [name]"* to search.`;
    }
    return `Sure! Which school do you want a budget for? 🏫\n\nJust say something like: *"budget for Lugulu Girls"*`;
  }

  // ——— ALL INSTITUTIONS REQUEST ———
  if (/(all institutions|all schools|list all|show all|every school|full list|how many school)/.test(m)) {
    const total = await Institution.countDocuments();
    return `We've got *${fmt(total)} schools* across *47 counties* — way too many for WhatsApp 😅\n\nI can narrow it down:\n• 🔍 School *name* — e.g. "find Lugulu"\n• 📍 *County* — e.g. "schools in Kisumu"\n• 🔥 *Cooking method* — e.g. "who uses charcoal?"\n• 🏫 *School type* — e.g. "secondary schools"\n\nWhat works for you?`;
  }

  // ——— COOKING STATS ———
  if (/(cooking stat|cooking method|how many use|who uses|wood|charcoal|gas|fuel type)/.test(m)) {
    const stats = await Institution.aggregate([
      { $group: { _id: '$cooking_method', count: { $sum: 1 }, students: { $sum: '$total_people' } } },
      { $sort: { count: -1 } }
    ]);
    const total = await Institution.countDocuments();
    let reply = `🔥 *Cooking Method Breakdown*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
    for (const s of stats) {
      const pct = ((s.count / total) * 100).toFixed(1);
      const emoji = s._id === 'Wood' ? '🪵' : s._id === 'Gas' ? '⛽' : '🔥';
      reply += `${emoji} *${s._id}*: ${fmt(s.count)} schools (${pct}%) — ${fmt(s.students)} students\n`;
    }
    reply += `\n📊 Total: *${fmt(total)}* schools`;
    return reply;
  }

  // ——— PIPELINE SUMMARY ———
  if (/(pipeline|summary|overview|dashboard|big picture|overall)/.test(m)) {
    const total = await Institution.countDocuments();
    const counties = (await Institution.distinct('county')).length;
    const pop = await Institution.aggregate([{ $group: { _id: null, total: { $sum: '$total_people' } } }]);
    const methods = await Institution.aggregate([
      { $group: { _id: '$cooking_method', count: { $sum: 1 } } }, { $sort: { count: -1 } }
    ]);
    const types = await Institution.aggregate([
      { $group: { _id: '$school_type', count: { $sum: 1 } } }
    ]);
    let reply = `📊 *Pipeline Summary*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
    reply += `🏫 Total schools: *${fmt(total)}*\n`;
    reply += `📍 Counties: *${counties}*\n`;
    reply += `👥 Total students: *${fmt(pop[0]?.total || 0)}*\n\n`;
    reply += `🔥 *By Cooking Method:*\n`;
    for (const m of methods) reply += `  • ${m._id}: *${fmt(m.count)}*\n`;
    reply += `\n🏫 *By School Type:*\n`;
    for (const t of types) reply += `  • ${t._id}: *${fmt(t.count)}*\n`;
    return reply;
  }

  // ——— TOP COUNTIES ———
  if (/(top counties|top county|most schools|county ranking|which counties)/.test(m)) {
    const stats = await Institution.aggregate([
      { $group: { _id: '$county', count: { $sum: 1 }, students: { $sum: '$total_people' } } },
      { $sort: { count: -1 } }, { $limit: 10 }
    ]);
    let reply = `📍 *Top 10 Counties*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
    stats.forEach((s, i) => {
      reply += `${i + 1}. *${s._id}* — ${s.count} schools (${fmt(s.students)} students)\n`;
    });
    return reply;
  }

  // ——— COUNTY-SPECIFIC QUERY ———
  const countyMatch = KENYA_COUNTIES.find(c => m.includes(c.replace("'", '')));
  if (countyMatch || /(schools in|county|tell me about .+ county)/.test(m)) {
    let county = countyMatch;
    if (!county) {
      // Extract county name from "schools in X" or "X county"
      const match = m.match(/(?:schools? in|about|county of)\s+(\w+)/) || m.match(/(\w+)\s+county/);
      if (match) county = match[1];
    }
    if (county) {
      const insts = await Institution.find({ county: { $regex: county, $options: 'i' } },
        'name county cooking_method school_type total_people total_meals_per_day'
      ).limit(10).lean();
      const total = await Institution.countDocuments({ county: { $regex: county, $options: 'i' } });

      if (insts.length === 0) return `No schools found in "${county}" 🤔 Check the county name and try again.`;

      let reply = `📍 *Schools in ${insts[0].county}*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
      insts.forEach((s, i) => {
        reply += `${i + 1}. 🏫 *${s.name}*\n   ${s.school_type} | ${s.cooking_method} | ${fmt(s.total_people)} students\n\n`;
      });
      if (total > 10) reply += `_...and ${total - 10} more. Say a school name for details!_`;
      return reply;
    }
  }

  // ——— SCHOOL TYPE QUERY ———
  if (/(primary school|secondary school|primary schools|secondary schools)/.test(m)) {
    const type = m.includes('primary') ? 'Primary' : 'Secondary';
    const insts = await Institution.find({ school_type: { $regex: type, $options: 'i' } },
      'name county cooking_method school_type total_people'
    ).limit(10).lean();
    const total = await Institution.countDocuments({ school_type: { $regex: type, $options: 'i' } });

    let reply = `🏫 *${type} Schools*\n━━━━━━━━━━━━━━━━━━━━\n*${fmt(total)}* ${type.toLowerCase()} schools total. Here's the first 10:\n\n`;
    insts.forEach((s, i) => {
      reply += `${i + 1}. *${s.name}* — ${s.county} | ${s.cooking_method} | ${fmt(s.total_people)} students\n`;
    });
    if (total > 10) reply += `\n_...and ${total - 10} more. Narrow by county for more!_`;
    return reply;
  }

  // ——— FIND / SEARCH SCHOOL ———
  if (/(find|search|look up|lookup|show me|where is|details|info about|information)/.test(m) || m.length > 3) {
    // Try fuzzy search with whatever they typed
    let searchTerm = msg
      .replace(/^(find|search|look up|lookup|show me|where is|details|info about|information on|information about|tell me about)\s*/i, '')
      .replace(/school|schools|institution/gi, '')
      .replace(/\?/g, '')
      .trim();

    if (searchTerm.length > 2) {
      const matches = fuzzySearch(searchTerm, 5);
      if (matches.length > 0) {
        if (matches.length === 1) {
          const s = matches[0];
          return `🏫 *${s.name}*\n━━━━━━━━━━━━━━━━━━━━\n📍 County: *${s.county}*\n🏫 Type: *${s.school_type}*\n👥 Students: *${fmt(s.total_people)}*\n🍳 Meals/day: *${s.total_meals_per_day}*\n🪵 Cooking: *${s.cooking_method}*\n\n💰 Want a budget? Say *"budget for ${s.name}"*`;
        }
        let reply = `Found *${matches.length}* schools matching that:\n\n`;
        matches.forEach((s, i) => {
          reply += `${i + 1}. 🏫 *${s.name}*\n   ${s.county} | ${s.school_type} | ${s.cooking_method} | ${fmt(s.total_people)} students\n\n`;
        });
        reply += `Want details on any? Just say the name!`;
        return reply;
      }
    }
  }

  // ——— FALLBACK TO LLM ———
  return null; // signals to use LLM
}

// ——— Helpers ———

function extractNumber(msg) {
  const match = msg.replace(/,/g, '').match(/\d+/);
  return match ? parseInt(match[0]) : null;
}

function extractSchoolName(msg) {
  return msg
    .replace(/^(i want|i need|give me|can you|please|run|calculate|get me)\s*/i, '')
    .replace(/^(budget|capex|cost|investment|pricing)\s*(for|of)?\s*/i, '')
    .replace(/^(how much)\s*(for|is)?\s*/i, '')
    .replace(/^(a|the)\s*/i, '')
    .replace(/\?/g, '').trim();
}

function fmt(n) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ——— LLM System Prompt ———

const SYSTEM_PROMPT = `You are *Ignis Bot* — a friendly WhatsApp assistant for the Ignis Clean Cooking Pipeline in Kenya.

You help look up schools, run budgets, and answer questions about clean cooking.

Vibe: like texting a helpful friend. Casual, warm, short. Use *bold* and emojis naturally.

IMPORTANT: Keep responses SHORT (under 300 words). This is WhatsApp.

If you don't know something, say: "Hmm, I don't have that info. Try asking about a specific school or say *help* to see what I can do! 😊"

Always respond in English.`;

// ——— LLM Tools ———

const tools = [
  {
    type: 'function',
    function: {
      name: 'find_school',
      description: 'Search schools by name, county, cooking method, or type.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'School name' },
          county: { type: 'string', description: 'County name' },
          cooking_method: { type: 'string', description: 'Wood, Gas, or Charcoal' },
          school_type: { type: 'string', description: 'Primary or Secondary' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_stats',
      description: 'Get pipeline statistics. type: summary, cooking, county (pass county param), top_counties.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['summary', 'cooking', 'county', 'top_counties'] },
          county: { type: 'string', description: 'County name (for type=county)' }
        },
        required: ['type']
      }
    }
  }
];

async function executeFindSchool(args) {
  let query = {};
  if (args.name) query.name = { $regex: args.name, $options: 'i' };
  if (args.county) query.county = { $regex: args.county, $options: 'i' };
  if (args.cooking_method) query.cooking_method = { $regex: args.cooking_method, $options: 'i' };
  if (args.school_type) query.school_type = { $regex: args.school_type, $options: 'i' };
  if (Object.keys(query).length === 0) return JSON.stringify({ message: 'Specify a name, county, method, or type.' });
  const results = await Institution.find(query, 'name county cooking_method school_type total_people total_meals_per_day').limit(10).lean();
  const total = await Institution.countDocuments(query);
  if (results.length === 0) return JSON.stringify({ message: 'No schools found.' });
  return JSON.stringify({ showing: results.length, total_found: total, institutions: results });
}

async function executeGetStats(args) {
  if (args.type === 'summary') {
    const total = await Institution.countDocuments();
    const counties = (await Institution.distinct('county')).length;
    const pop = await Institution.aggregate([{ $group: { _id: null, total: { $sum: '$total_people' } } }]);
    return JSON.stringify({ total_schools: total, counties, total_students: pop[0]?.total || 0 });
  }
  if (args.type === 'cooking') {
    const stats = await Institution.aggregate([
      { $group: { _id: '$cooking_method', count: { $sum: 1 }, students: { $sum: '$total_people' } } },
      { $sort: { count: -1 } }
    ]);
    return JSON.stringify({ methods: stats });
  }
  if (args.type === 'county' && args.county) {
    const insts = await Institution.find({ county: { $regex: args.county, $options: 'i' } }).lean();
    if (insts.length === 0) return JSON.stringify({ message: `No schools in "${args.county}".` });
    return JSON.stringify({ county: insts[0].county, total: insts.length });
  }
  if (args.type === 'top_counties') {
    const stats = await Institution.aggregate([
      { $group: { _id: '$county', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 10 }
    ]);
    return JSON.stringify({ top: stats });
  }
  return JSON.stringify({ message: 'Use: summary, cooking, county, top_counties.' });
}

// ——— LLM Call with Fallback ———

async function callLLM(messages) {
  for (const model of MODELS) {
    try {
      const response = await client.chat.completions.create({
        model,
        max_tokens: 512,
        messages,
        tools,
        tool_choice: 'auto'
      });
      return response;
    } catch (error) {
      console.log(`⚠️ Model ${model} failed: ${error.message?.substring(0, 80)}`);
      if (!error.message?.includes('429') && !error.message?.includes('rate_limit') && !error.message?.includes('tool_use_failed')) {
        throw error; // real error, don't retry
      }
      // try next model
    }
  }
  return null; // all models failed
}

// ——— Main Handler ———

async function processMessage(userMessage, userId = 'default') {
  const session = getSession(userId);
  const msg = userMessage.trim();

  if (!msg) return "Send me a message and I'll help you out! 😊";

  // Try keyword router first (no LLM needed)
  try {
    const directReply = await routeMessage(msg, session);
    if (directReply) {
      session.messages.push({ role: 'user', content: msg });
      session.messages.push({ role: 'assistant', content: '[handled directly]' });
      return directReply;
    }
  } catch (err) {
    console.error('Router error:', err.message);
  }

  // Fallback to LLM for anything the router didn't catch
  session.messages.push({ role: 'user', content: msg });
  if (session.messages.length > 8) session.messages = session.messages.slice(-8);

  try {
    const response = await callLLM([{ role: 'system', content: SYSTEM_PROMPT }, ...session.messages]);
    if (!response) {
      // ALL models failed — give helpful offline response
      return `I'm a bit overloaded right now 😅 But I can still help!\n\nTry these:\n• *"find [school name]"* — search schools\n• *"budget for [school]"* — run a budget\n• *"schools in [county]"* — browse by county\n• *"cooking stats"* — see the breakdown\n• *"help"* — see everything I can do`;
    }

    let assistantMsg = response.choices[0].message;

    // Handle tool calls
    let attempts = 0;
    while (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0 && attempts < 3) {
      attempts++;
      session.messages.push(assistantMsg);

      for (const tc of assistantMsg.tool_calls) {
        const name = tc.function.name;
        const args = JSON.parse(tc.function.arguments);
        console.log(`🔧 ${name}`, args);

        let result;
        if (name === 'find_school') result = await executeFindSchool(args);
        else if (name === 'get_stats') result = await executeGetStats(args);
        else result = JSON.stringify({ error: 'Unknown tool' });

        session.messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
      }

      const nextResponse = await callLLM([{ role: 'system', content: SYSTEM_PROMPT }, ...session.messages]);
      if (!nextResponse) break;
      assistantMsg = nextResponse.choices[0].message;
    }

    const reply = assistantMsg.content || "Not sure I got that 🤔 Try *help* to see what I can do!";
    session.messages.push({ role: 'assistant', content: reply });
    return reply;
  } catch (error) {
    console.error('LLM error:', error.message);
    return `I'm a bit overloaded right now 😅 But try these:\n• *"find [school name]"*\n• *"budget for [school]"*\n• *"cooking stats"*\n• *"help"*`;
  }
}

module.exports = { processMessage, buildSearchIndex };
