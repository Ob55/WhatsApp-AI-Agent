// supabase.js — Data layer: Supabase client + in-memory cache + all queries
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');
const Fuse = require('fuse.js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tvymnsrudrggshjnkiqw.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_KEY) console.warn('⚠️  SUPABASE_ANON_KEY not set — data queries will fail');

// Use node-fetch to avoid native fetch failures in some Node environments
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY || 'placeholder', {
  global: { fetch }
});

// ——— In-Memory Cache ———
let cache = [];
let fuseIdx = null;
let cacheReady = false;
let bankRateCache = null;
let bankRateFetchedAt = 0;

const DEFAULT_BANKS = [
  { bank_name: 'ABSA Bank', rate: 13.9 },
  { bank_name: 'Equity Bank', rate: 15.5 },
  { bank_name: 'KCB Bank', rate: 15.8 }
];

// ——— Build / Refresh Cache ———
async function buildCache() {
  try {
    console.log('📦 Loading institutions from Supabase...');
    let all = [];
    let from = 0;
    const batch = 1000;

    while (true) {
      const { data, error } = await supabase
        .from('institutions')
        .select('id,name,county,institution_type,school_type,number_of_people,meals_per_day,method_of_cooking,ownership_type,existing_loan,missing_fields,gps_location,bank_name')
        .range(from, from + batch - 1)
        .order('name');

      if (error) { console.error('Supabase error:', error.message); break; }
      if (!data || data.length === 0) break;
      all = all.concat(data);
      if (data.length < batch) break;
      from += batch;
    }

    cache = all;
    fuseIdx = new Fuse(all, { keys: ['name'], threshold: 0.4, distance: 100, includeScore: true });
    cacheReady = true;
    console.log(`✅ Cache ready: ${all.length} institutions`);
  } catch (err) {
    console.error('buildCache error:', err.message);
  }
}

// Auto-refresh every hour
setInterval(buildCache, 60 * 60 * 1000);

// ——— Search Functions ———
function fuzzySearch(query, limit = 8) {
  if (!fuseIdx) return [];
  return fuseIdx.search(query, { limit }).map(r => r.item);
}

// Smart search: try full query → strip words from front progressively
function smartSearch(query, limit = 8) {
  let matches = fuzzySearch(query, limit);
  if (matches.length) return matches;
  const words = query.split(/\s+/);
  for (let i = 1; i < words.length; i++) {
    const partial = words.slice(i).join(' ');
    if (partial.length > 2) {
      matches = fuzzySearch(partial, limit);
      if (matches.length) return matches;
    }
  }
  return [];
}

// ——— Multi-Filter Search ———
function filterInstitutions(filters = {}, offset = 0, limit = 8) {
  let results = cache;

  if (filters.county)
    results = results.filter(i => i.county?.toLowerCase().includes(filters.county.toLowerCase()));
  if (filters.institution_type)
    results = results.filter(i => i.institution_type?.toLowerCase().includes(filters.institution_type.toLowerCase()));
  if (filters.school_type)
    results = results.filter(i => i.school_type?.toLowerCase().includes(filters.school_type.toLowerCase()));
  if (filters.method_of_cooking)
    results = results.filter(i => i.method_of_cooking?.toLowerCase().includes(filters.method_of_cooking.toLowerCase()));
  if (filters.ownership_type)
    results = results.filter(i => i.ownership_type?.toLowerCase().includes(filters.ownership_type.toLowerCase()));
  if (filters.existing_loan != null)
    results = results.filter(i => i.existing_loan?.toLowerCase() === filters.existing_loan.toLowerCase());
  if (filters.min_people)
    results = results.filter(i => (i.number_of_people || 0) >= filters.min_people);
  if (filters.has_missing)
    results = results.filter(i => Array.isArray(i.missing_fields) ? i.missing_fields.length > 0 : !!i.missing_fields);
  if (filters.nameQuery) {
    const q = filters.nameQuery.toLowerCase();
    results = results.filter(i => i.name?.toLowerCase().includes(q));
  }

  return { total: results.length, items: results.slice(offset, offset + limit) };
}

// ——— Aggregate Stats from Cache ———
function getStats() {
  const cooking = {}, type = {}, county = {}, ownership = {};
  let loanYes = 0, loanNo = 0, totalPeople = 0;

  for (const i of cache) {
    const m = i.method_of_cooking || 'Unknown';
    cooking[m] = (cooking[m] || 0) + 1;

    const t = i.institution_type || 'Unknown';
    type[t] = (type[t] || 0) + 1;

    const c = i.county || 'Unknown';
    if (!county[c]) county[c] = { count: 0, people: 0 };
    county[c].count++;
    county[c].people += (i.number_of_people || 0);

    const o = i.ownership_type || 'Unknown';
    ownership[o] = (ownership[o] || 0) + 1;

    const loan = i.existing_loan?.toLowerCase();
    if (loan === 'yes') loanYes++;
    else if (loan === 'no') loanNo++;

    totalPeople += (i.number_of_people || 0);
  }

  return { total: cache.length, cooking, type, county, ownership, loanYes, loanNo, totalPeople };
}

// ——— Individual Institution (full fields from Supabase) ———
async function getInstitutionById(id) {
  const { data, error } = await supabase.from('institutions').select('*').eq('id', id).single();
  return error ? null : data;
}

// ——— Bank Rates (live from Supabase, fallback to defaults) ———
async function getBankRates() {
  const TTL = 60 * 60 * 1000;
  if (bankRateCache && Date.now() - bankRateFetchedAt < TTL) return bankRateCache;

  try {
    const { data, error } = await supabase.from('bank_interest_rates').select('*');
    if (!error && data?.length > 0) {
      const normalized = data.map(r => ({
        bank_name: r.bank_name || r.name || r.bank || 'Bank',
        rate: parseFloat(r.rate || r.interest_rate || r.lending_rate || 0)
      })).filter(r => r.bank_name && r.rate > 0);

      if (normalized.length > 0) {
        bankRateCache = normalized;
        bankRateFetchedAt = Date.now();
        console.log(`💰 Bank rates loaded: ${normalized.map(b => `${b.bank_name} ${b.rate}%`).join(', ')}`);
        return bankRateCache;
      }
    }
  } catch (e) {
    console.log('Bank rates fetch failed, using defaults:', e.message);
  }
  return DEFAULT_BANKS;
}

// ——— Portfolios ———
async function getPortfolios() {
  const { data, error } = await supabase.from('portfolios').select('*').limit(20);
  return error ? [] : (data || []);
}

module.exports = {
  supabase,
  buildCache,
  fuzzySearch,
  smartSearch,
  filterInstitutions,
  getStats,
  getInstitutionById,
  getBankRates,
  getPortfolios,
  getCacheSize: () => cache.length,
  isCacheReady: () => cacheReady
};
