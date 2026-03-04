const Groq = require('groq-sdk');
const Institution = require('./models/Institution');
const {
  calculateBudget,
  formatSummary,
  formatProjection,
  formatBankOptions
} = require('./budget');

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ——— Session Management ———
const sessions = new Map();
const SESSION_TTL = 30 * 60 * 1000;

function getSession(userId) {
  const session = sessions.get(userId);
  if (session && Date.now() - session.lastActive < SESSION_TTL) {
    session.lastActive = Date.now();
    return session;
  }
  const s = {
    messages: [],
    lastActive: Date.now(),
    budgetState: null,       // { school, budget } after calculation
    awaitingFuelSpend: null  // school doc when waiting for fuel spend
  };
  sessions.set(userId, s);
  return s;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, s] of sessions) {
    if (now - s.lastActive > SESSION_TTL) sessions.delete(k);
  }
}, 10 * 60 * 1000);

// ——— System Prompt ———

const SYSTEM_PROMPT = `You are *Ignis Bot* — the friendly WhatsApp assistant for the Ignis Clean Cooking Pipeline. You help the sales team and management look up school data, run budgets, and check stats.

Your vibe: like texting a helpful friend who knows everything about clean cooking in Kenya. Casual, warm, to the point. No corporate jargon.

Database: 1,090 government schools across 47 counties in Kenya.

## HOW TO TALK

*Greetings (Hi/Hello/Hey/Habari/Sasa/Mambo/What's up):*
"Hey there! 👋 Welcome to *Ignis Clean Cooking* 🔥

Here's what I can do for you:
📋 *Find a school* — search by name, county, or type
🔥 *Cooking stats* — see who uses wood, gas, charcoal
💰 *Run a budget* — get CAPEX, savings & bank plans
📊 *Pipeline stats* — the big picture

Just ask away! What do you need?"

*Thank you / Goodbye:*
"You're welcome! Hit me up anytime 👊"

*Help / What can you do:*
"Here's my menu:
📋 *Find a school* → try: "find Lugulu Girls" or "schools in Nairobi"
🔥 *Cooking stats* → try: "how many use wood?"
💰 *Budget* → try: "budget for Lugulu Girls"
📊 *Stats* → try: "pipeline summary" or "top counties"

Just type what you need!"

*All institutions request:*
"Haha, we've got *1,090 schools* across *47 counties* — way too many for WhatsApp 😅

I can narrow it down:
• 🔍 School *name* — e.g. "find Lugulu"
• 📍 *County* — e.g. "schools in Kisumu"
• 🔥 *Cooking method* — e.g. "who uses charcoal?"
• 🏫 *School type* — e.g. "secondary schools"

What works for you?"

## BUDGET REQUESTS
When user asks for a budget/cost/investment for a school:
→ Call find_school to look up the school
→ If found, respond EXACTLY like this:
"Found it! 🏫 *[name]* in *[county]*
👥 *[total_people]* students | 🍳 *[meals]* meals/day | 🪵 Currently using *[method]*

To run the budget, I need one thing:
💰 *What's the daily fuel spend in KES?*
(e.g. just type 5000)"

IMPORTANT: Do NOT call run_budget yourself. The system handles the budget calculation automatically after the user provides the fuel spend.

## SEARCH RESULTS
When showing search results:
"Found *X* schools! Here you go:

1. 🏫 *Name* — County | Type | Method | Students
2. ...

Want details on any of these?"

## PRIVACY
NEVER share phone/email. Say: "Can't share contact details over WhatsApp — privacy policy 🔒 Check with admin."

## STYLE
- Casual & friendly — like a helpful friend
- Short — this is WhatsApp
- *bold* for key info
- Emojis naturally
- Numbers: 2,598 not 2598
- English only
- Don't know? "Hmm, I don't have that info yet. Check with admin 👍"
- Don't understand? "Not sure I got that 🤔 Try: 'find [school]' or 'budget for [school]' or 'cooking stats'"`;

// ——— Tools (only search & stats — budget handled in code) ———

const tools = [
  {
    type: 'function',
    function: {
      name: 'find_school',
      description: 'Search schools by name, county, cooking method, or type. Returns up to 10 results.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'School name or partial name' },
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
      description: 'Pipeline stats. type: "summary" = overall, "cooking" = method breakdown, "county" = one county (pass county), "top_counties" = ranking.',
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

// ——— Tool Execution ———

async function executeFindSchool(args) {
  let query = {};
  if (args.name) query.name = { $regex: args.name, $options: 'i' };
  if (args.county) query.county = { $regex: args.county, $options: 'i' };
  if (args.cooking_method) query.cooking_method = { $regex: args.cooking_method, $options: 'i' };
  if (args.school_type) query.school_type = { $regex: args.school_type, $options: 'i' };

  if (Object.keys(query).length === 0) {
    return JSON.stringify({ message: 'Tell me a school name, county, cooking method, or type to search.' });
  }

  const results = await Institution.find(query,
    'name county cooking_method school_type total_people total_meals_per_day'
  ).limit(10).lean();
  const total = await Institution.countDocuments(query);

  if (results.length === 0) return JSON.stringify({ message: 'No schools found matching that.' });
  return JSON.stringify({
    showing: results.length, total_found: total, institutions: results,
    note: total > 10 ? `${total} total — showing first 10. Narrow your search.` : undefined
  });
}

async function executeGetStats(args) {
  if (args.type === 'summary') {
    const total = await Institution.countDocuments();
    const methods = await Institution.aggregate([
      { $group: { _id: '$cooking_method', count: { $sum: 1 }, students: { $sum: '$total_people' } } },
      { $sort: { count: -1 } }
    ]);
    const types = await Institution.aggregate([{ $group: { _id: '$school_type', count: { $sum: 1 } } }]);
    const counties = (await Institution.distinct('county')).length;
    const pop = await Institution.aggregate([{ $group: { _id: null, total: { $sum: '$total_people' } } }]);
    return JSON.stringify({
      total_schools: total, counties, total_students: pop[0]?.total || 0,
      cooking_methods: Object.fromEntries(methods.map(m => [m._id, { schools: m.count, students: m.students }])),
      school_types: Object.fromEntries(types.map(t => [t._id, t.count]))
    });
  }
  if (args.type === 'cooking') {
    const stats = await Institution.aggregate([
      { $group: { _id: '$cooking_method', count: { $sum: 1 }, students: { $sum: '$total_people' } } },
      { $sort: { count: -1 } }
    ]);
    const total = await Institution.countDocuments();
    return JSON.stringify({ total, methods: stats.map(s => ({ method: s._id, schools: s.count, pct: ((s.count / total) * 100).toFixed(1) + '%', students: s.students })) });
  }
  if (args.type === 'county' && args.county) {
    const insts = await Institution.find({ county: { $regex: args.county, $options: 'i' } }).lean();
    if (insts.length === 0) return JSON.stringify({ message: `No schools in "${args.county}".` });
    const methods = {}, types = {};
    let students = 0;
    for (const i of insts) {
      methods[i.cooking_method] = (methods[i.cooking_method] || 0) + 1;
      types[i.school_type] = (types[i.school_type] || 0) + 1;
      students += i.total_people || 0;
    }
    return JSON.stringify({ county: insts[0].county, schools: insts.length, students, cooking_methods: methods, school_types: types });
  }
  if (args.type === 'top_counties') {
    const stats = await Institution.aggregate([
      { $group: { _id: '$county', count: { $sum: 1 }, students: { $sum: '$total_people' } } },
      { $sort: { count: -1 } }, { $limit: 15 }
    ]);
    return JSON.stringify({ top: stats.map(s => ({ county: s._id, schools: s.count, students: s.students })) });
  }
  return JSON.stringify({ message: 'Use type: summary, cooking, county, or top_counties.' });
}

async function executeTool(name, args) {
  switch (name) {
    case 'find_school': return await executeFindSchool(args);
    case 'get_stats': return await executeGetStats(args);
    default: return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

// ——— Budget Flow Helpers (handled in code, not LLM) ———

function isBudgetRequest(msg) {
  const m = msg.toLowerCase();
  return m.includes('budget') || m.includes('capex') || m.includes('cost for') ||
         m.includes('investment for') || m.includes('how much for') || m.includes('pricing for');
}

function isProjectionRequest(msg) {
  const m = msg.toLowerCase();
  return m.includes('projection') || m.includes('5 year') || m.includes('5-year') ||
         m.includes('five year') || m.includes('forecast');
}

function isBankRequest(msg) {
  const m = msg.toLowerCase();
  return m.includes('bank') || m.includes('financing') || m.includes('loan') ||
         m.includes('finance');
}

function extractNumber(msg) {
  const match = msg.replace(/,/g, '').match(/\d+/);
  return match ? parseInt(match[0]) : null;
}

function extractSchoolName(msg) {
  const m = msg.toLowerCase();
  // Remove budget-related words to get the school name
  return msg
    .replace(/budget\s*(for|of)?/i, '')
    .replace(/capex\s*(for|of)?/i, '')
    .replace(/cost\s*(for|of)?/i, '')
    .replace(/investment\s*(for|of)?/i, '')
    .replace(/how\s*much\s*(for|of)?/i, '')
    .replace(/pricing\s*(for|of)?/i, '')
    .replace(/can\s*you\s*/i, '')
    .replace(/i\s*need\s*(a|the)?\s*/i, '')
    .replace(/give\s*me\s*(a|the)?\s*/i, '')
    .replace(/run\s*(a|the)?\s*/i, '')
    .replace(/calculate\s*(a|the)?\s*/i, '')
    .replace(/get\s*(me)?\s*(a|the)?\s*/i, '')
    .replace(/please/i, '')
    .replace(/\?/g, '')
    .trim();
}

// ——— Main Handler ———

async function processMessage(userMessage, userId = 'default') {
  const session = getSession(userId);
  const msg = userMessage.trim();

  // ===== DIRECT BUDGET FLOW (bypasses LLM for reliability) =====

  // Step: User is providing fuel spend (we're waiting for a number)
  if (session.awaitingFuelSpend) {
    const fuelKES = extractNumber(msg);
    if (fuelKES && fuelKES > 0) {
      const school = session.awaitingFuelSpend;
      const budget = calculateBudget(school.total_people, fuelKES);
      session.budgetState = { school: school.name, budget };
      session.awaitingFuelSpend = null;

      // Store in conversation for context
      session.messages.push({ role: 'user', content: msg });
      session.messages.push({ role: 'assistant', content: '[Budget calculated]' });

      return formatSummary(school.name, budget);
    }
    // Not a number — let them try again
    return `Hmm, I need a number for the daily fuel spend in KES 🤔\n\nJust type the amount, like *5000* or *12000*`;
  }

  // Step: User asks for projection
  if (isProjectionRequest(msg) && session.budgetState) {
    session.messages.push({ role: 'user', content: msg });
    session.messages.push({ role: 'assistant', content: '[Projection shown]' });
    return formatProjection(session.budgetState.school, session.budgetState.budget);
  }

  // Step: User asks for bank options
  if (isBankRequest(msg) && session.budgetState) {
    session.messages.push({ role: 'user', content: msg });
    session.messages.push({ role: 'assistant', content: '[Bank options shown]' });
    return formatBankOptions(session.budgetState.school, session.budgetState.budget.capexUSD);
  }

  // Step: User asks for a budget — find the school first
  if (isBudgetRequest(msg)) {
    const schoolName = extractSchoolName(msg);
    if (schoolName.length > 2) {
      const school = await Institution.findOne(
        { name: { $regex: schoolName, $options: 'i' } },
        'name county cooking_method school_type total_people total_meals_per_day'
      ).lean();

      if (school) {
        session.awaitingFuelSpend = school;
        session.messages.push({ role: 'user', content: msg });
        session.messages.push({ role: 'assistant', content: `Found ${school.name}, asking for fuel spend.` });

        return `Found it! 🏫 *${school.name}* in *${school.county}*
👥 *${fmt(school.total_people)}* students | 🍳 *${school.total_meals_per_day}* meals/day | 🪵 Currently using *${school.cooking_method}*

To run the budget, I need one thing:
💰 *What's the daily fuel spend in KES?*
_(e.g. just type 5000)_`;
      }
      // School not found — fall through to LLM
    }
  }

  // ===== LLM HANDLING (search, stats, general chat) =====

  session.messages.push({ role: 'user', content: msg });
  if (session.messages.length > 10) {
    session.messages = session.messages.slice(-10);
  }

  try {
    let response = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 1024,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...session.messages],
      tools,
      tool_choice: 'auto'
    });

    let assistantMsg = response.choices[0].message;

    while (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
      session.messages.push(assistantMsg);

      for (const tc of assistantMsg.tool_calls) {
        const toolName = tc.function.name;
        const toolArgs = JSON.parse(tc.function.arguments);
        console.log(`🔧 ${toolName}`, toolArgs);

        const result = await executeTool(toolName, toolArgs);
        session.messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: typeof result === 'string' ? result : JSON.stringify(result)
        });

        // If LLM searched for a budget-related school, set up fuel spend flow
        if (toolName === 'find_school' && isBudgetRequest(msg)) {
          const parsed = JSON.parse(result);
          if (parsed.institutions && parsed.institutions.length === 1) {
            const school = parsed.institutions[0];
            session.awaitingFuelSpend = school;
          }
        }
      }

      response = await client.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 1024,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...session.messages],
        tools,
        tool_choice: 'auto'
      });

      assistantMsg = response.choices[0].message;
    }

    const reply = assistantMsg.content || "Hmm, something went wrong 🤔 Try again?";
    session.messages.push({ role: 'assistant', content: reply });
    return reply;
  } catch (error) {
    if (error.message?.includes('tool_use_failed') && !session._retrying) {
      console.log('⚠️ Tool hiccup, retrying...');
      session._retrying = true;
      session.messages.pop();
      const result = await processMessage(userMessage, userId);
      session._retrying = false;
      return result;
    }
    console.error('Agent error:', error.message);
    return "Oops, something went wrong 😅 Give it another try!";
  }
}

function fmt(n) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

module.exports = { processMessage };
