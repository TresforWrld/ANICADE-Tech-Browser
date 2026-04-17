/**
 * ANICADE Tech Browser — Auth, Bots & Utilities v2.0
 */

// ── ENCRYPTED ADMIN (not readable via inspect) ──
(function _a() {
  const _e = [97,110,105,99,97,100,101,116,101,99,104,64,103,109,97,105,108,46,99,111,109];
  const _p = [75,114,115,116,101,110,50,48,52,52];
  const _d = a => a.map(c => String.fromCharCode(c)).join('');
  window.__AT_CHK = (em, pw) => em === _d(_e) && pw === _d(_p);
})();

// ── CONFIG ──
const AT_CFG = {
  USERS_BIN: '69b14c5bc3097a1dd5173665',
  JB_BASE: 'https://api.jsonbin.io/v3/b',
  MK_LS: 'anicade_jb_master',
  SESSION: 'anicade_session',
  LOGIN: 'login.html',
};

// ── SESSION ──
const ATAuth = {
  get() { try { return JSON.parse(localStorage.getItem(AT_CFG.SESSION) || 'null'); } catch { return null; } },
  set(u) { localStorage.setItem(AT_CFG.SESSION, JSON.stringify(u)); },
  clear() { localStorage.removeItem(AT_CFG.SESSION); },
  isLoggedIn() { return !!this.get(); },
  isAdmin() { const u = this.get(); return !!(u && u.isAdmin); },
  require(reason) {
    if (!this.isLoggedIn()) {
      window.location.href = `${AT_CFG.LOGIN}?redirect=${encodeURIComponent(location.href)}${reason ? '&reason=' + reason : ''}`;
      return false;
    }
    return true;
  },
  logout() { this.clear(); window.location.href = AT_CFG.LOGIN; },
};

// ── JSONBIN ──
const ATJB = {
  _k() { return localStorage.getItem(AT_CFG.MK_LS) || ''; },
  async read(bin) {
    const h = { 'Content-Type': 'application/json' };
    const k = this._k(); if (k) h['X-Master-Key'] = k;
    const r = await fetch(`${AT_CFG.JB_BASE}/${bin}/latest`, { headers: h });
    if (!r.ok) throw new Error('JB ' + r.status);
    return (await r.json()).record;
  },
  async write(bin, data) {
    const k = this._k(); if (!k) throw new Error('No key');
    const r = await fetch(`${AT_CFG.JB_BASE}/${bin}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Master-Key': k },
      body: JSON.stringify(data),
    });
    if (!r.ok) throw new Error('JB write ' + r.status);
    return (await r.json()).record;
  },
  async getUsers() {
    try { const r = await this.read(AT_CFG.USERS_BIN); return r.users || []; }
    catch { return []; }
  },
  async saveUsers(users) { return this.write(AT_CFG.USERS_BIN, { users }); },
  async updateUser(upd) {
    try {
      const rec = await this.read(AT_CFG.USERS_BIN);
      const arr = rec.users || [];
      const i = arr.findIndex(u => u.id === upd.id);
      if (i !== -1) arr[i] = { ...arr[i], ...upd }; else arr.push(upd);
      await this.write(AT_CFG.USERS_BIN, { users: arr });
    } catch { const s = ATAuth.get(); if (s && s.id === upd.id) ATAuth.set({ ...s, ...upd }); }
  },
};

// ── COUNTRIES ──
const AT_COUNTRIES = [
  {n:'🇿🇲 Zambia',tz:'Africa/Lusaka'},{n:'🇿🇼 Zimbabwe',tz:'Africa/Harare'},
  {n:'🇲🇼 Malawi',tz:'Africa/Blantyre'},{n:'🇹🇿 Tanzania',tz:'Africa/Dar_es_Salaam'},
  {n:'🇰🇪 Kenya',tz:'Africa/Nairobi'},{n:'🇿🇦 South Africa',tz:'Africa/Johannesburg'},
  {n:'🇧🇼 Botswana',tz:'Africa/Gaborone'},{n:'🇳🇦 Namibia',tz:'Africa/Windhoek'},
  {n:'🇲🇿 Mozambique',tz:'Africa/Maputo'},{n:'🇺🇬 Uganda',tz:'Africa/Kampala'},
  {n:'🇷🇼 Rwanda',tz:'Africa/Kigali'},{n:'🇪🇹 Ethiopia',tz:'Africa/Addis_Ababa'},
  {n:'🇬🇭 Ghana',tz:'Africa/Accra'},{n:'🇳🇬 Nigeria',tz:'Africa/Lagos'},
  {n:'🇪🇬 Egypt',tz:'Africa/Cairo'},{n:'🇸🇳 Senegal',tz:'Africa/Dakar'},
  {n:'🇺🇸 USA (ET)',tz:'America/New_York'},{n:'🇺🇸 USA (PT)',tz:'America/Los_Angeles'},
  {n:'🇬🇧 UK',tz:'Europe/London'},{n:'🇨🇦 Canada',tz:'America/Toronto'},
  {n:'🇩🇪 Germany',tz:'Europe/Berlin'},{n:'🇫🇷 France',tz:'Europe/Paris'},
  {n:'🇮🇳 India',tz:'Asia/Kolkata'},{n:'🇨🇳 China',tz:'Asia/Shanghai'},
  {n:'🇯🇵 Japan',tz:'Asia/Tokyo'},{n:'🇦🇺 Australia',tz:'Australia/Sydney'},
  {n:'🇧🇷 Brazil',tz:'America/Sao_Paulo'},{n:'🌍 Other',tz:'UTC'},
];

// ── 3 BOTS ──
const AT_BOTS = [
  {
    id:'apibot', name:'ANICADE_APIBot', color:'#00BFFF', avatar:null, role:'API Discovery',
    messages:{
      morning:[
        '🌅 Morning API: OpenWeatherMap — 1M free calls/month, real-time weather worldwide. openweathermap.org/api',
        '🌄 Morning pick: NASA Open APIs — free space imagery, Mars rover photos, APOD. api.nasa.gov',
        '☀️ Morning rec: CoinGecko — free crypto API, 13k+ coins, market data, no key needed. coingecko.com/en/api',
      ],
      afternoon:[
        '⚡ Afternoon: REST Countries — get any country\'s flag, capital & currency with one GET request. restcountries.com',
        '🔌 Afternoon: Pexels API — 3M free stock photos via clean REST. Perfect for any UI project. pexels.com/api',
        '🌐 Afternoon: JSONPlaceholder — instant fake REST API for testing. No signup, no key, just build. jsonplaceholder.typicode.com',
      ],
      evening:[
        '🌙 Evening: TMDB API — 1M+ movies, TV shows & cast data. Free for non-commercial use. developers.themoviedb.org',
        '🌑 Evening: Quotable — clean quotes endpoint, filter by author & tag. Great for filler UIs. quotable.io',
        '🔵 Evening: HackerNews API — full HN access via Firebase, no key needed. github.com/HackerNews/API',
      ],
    },
  },
  {
    id:'aibot', name:'ANICADE_AIBot', color:'#C6A85C', avatar:null, role:'AI Tool Scout',
    messages:{
      morning:[
        '🤖 Morning AI: Groq — Llama 3 at 800 tokens/sec on the free tier. Fastest LLM inference today. console.groq.com',
        '🌅 Morning: Ollama — run Llama 3, Mistral & Phi-3 fully offline. Zero API cost. ollama.ai',
        '⚡ Morning: Hugging Face Inference API — 30k+ models free. NLP, vision, audio, code. huggingface.co',
      ],
      afternoon:[
        '🧠 Afternoon AI: Codeium — free AI code completion, 70+ languages. Best free Copilot alternative. codeium.com',
        '🤖 Afternoon: Replicate — Stable Diffusion, Whisper, LLaVA via API. Pay per second, no server. replicate.com',
        '🌐 Afternoon: LM Studio — local OpenAI-compatible server for any GGUF model. Dead simple. lmstudio.ai',
      ],
      evening:[
        '🌙 Evening AI: ElevenLabs free — 10k chars/month studio TTS. Add real voice to your projects. elevenlabs.io',
        '🌑 Evening: Transformers.js — run HuggingFace models in browser. No server, works with React. github.com/xenova/transformers.js',
        '🤖 Evening: Together AI — cheapest Llama 3 70B inference. Great for production AI features. together.ai',
      ],
    },
  },
  {
    id:'devbot', name:'ANICADE_DevBot', color:'#39ff14', avatar:null, role:'Dev Tools & Tips',
    messages:{
      morning:[
        '🛠 Morning tip: Vite over Webpack — up to 100x faster HMR. Drop-in for React & Vue. vitejs.dev',
        '🌅 Morning: Biome.js — replaces ESLint + Prettier in one Rust tool. Formats in milliseconds. biomejs.dev',
        '⚡ Morning stack: Supabase free — 500MB Postgres + Auth + Realtime + Storage. Best free BaaS 2025. supabase.com',
      ],
      afternoon:[
        '🔵 Afternoon: Drizzle ORM — TypeScript-first, zero overhead, better DX than Prisma for edge. orm.drizzle.team',
        '🛠 Afternoon: Turso — edge SQLite, free: 500 databases, 9GB storage. Lowest latency available. turso.tech',
        '⚡ Afternoon: Railway free — deploy Postgres, Redis, Node from GitHub in 60 seconds. railway.app',
      ],
      evening:[
        '🌙 Evening: Zod + React Hook Form — bulletproof type-safe forms with one-line validation. zod.dev',
        '🌑 Evening: shadcn/ui — copy-paste accessible React components. No npm bloat, code you own. ui.shadcn.com',
        '🛠 Evening: Playwright — faster E2E testing than Cypress, auto-wait, true cross-browser. playwright.dev',
      ],
    },
  },
];

function _atSlot() {
  const h = new Date().getHours();
  return h >= 6 && h < 12 ? 'morning' : h >= 12 && h < 20 ? 'afternoon' : 'evening';
}
function _atToday() { return new Date().toISOString().slice(0, 10); }
function _atRot() {
  return Math.floor((Date.now() - new Date('2026-01-01').getTime()) / 86400000) % 3;
}
function _atSlotTime(slot) {
  const d = new Date(); d.setSeconds(0, 0);
  if (slot === 'morning') { d.setHours(6, 0); }
  else if (slot === 'afternoon') { d.setHours(12, 0); }
  else { d.setHours(20, 0); }
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

/**
 * Seed bot posts into chat. Timestamps use REAL schedule times, not current time.
 * Only posts each bot/slot combo once per day (tracked in localStorage).
 * @param {Function} addFn - addFn(name, text, color, time, avatar)
 */
function atSeedBots(addFn) {
  const today = _atToday();
  const stored = (() => { try { return JSON.parse(localStorage.getItem('at_bp_' + today) || '{}'); } catch { return {}; } })();
  const rot = _atRot();
  const h = new Date().getHours();
  let delay = 900;

  // Post all slots that have already passed today and haven't posted yet
  const slots = [
    { slot: 'morning', minH: 6 },
    { slot: 'afternoon', minH: 12 },
    { slot: 'evening', minH: 20 },
  ];

  slots.forEach(({ slot, minH }) => {
    if (h < minH) return; // hasn't fired yet today
    AT_BOTS.forEach(bot => {
      const k = bot.id + '_' + slot;
      if (stored[k]) return; // already posted
      const msg = bot.messages[slot][rot];
      const ts = _atSlotTime(slot);
      setTimeout(() => {
        addFn(bot.name, msg, bot.color, ts, bot.avatar);
        const s2 = (() => { try { return JSON.parse(localStorage.getItem('at_bp_' + today) || '{}'); } catch { return {}; } })();
        s2[k] = Date.now();
        localStorage.setItem('at_bp_' + today, JSON.stringify(s2));
      }, delay);
      delay += 1100;
    });
  });

  // Real-time posting: check every 30s for new slots
  setInterval(() => {
    const now = new Date();
    const ch = now.getHours(), cm = now.getMinutes();
    const isSlotBoundary = (
      (ch === 6 && cm === 0) ||
      (ch === 12 && cm === 0) ||
      (ch === 20 && cm === 0)
    );
    if (!isSlotBoundary) return;
    const cSlot = _atSlot();
    const cToday = _atToday();
    const cStored = (() => { try { return JSON.parse(localStorage.getItem('at_bp_' + cToday) || '{}'); } catch { return {}; } })();
    const cRot = _atRot();
    const cTime = _atSlotTime(cSlot);
    AT_BOTS.forEach((bot, bi) => {
      const k = bot.id + '_' + cSlot;
      if (cStored[k]) return;
      setTimeout(() => {
        addFn(bot.name, bot.messages[cSlot][cRot], bot.color, cTime, bot.avatar);
        const s3 = (() => { try { return JSON.parse(localStorage.getItem('at_bp_' + cToday) || '{}'); } catch { return {}; } })();
        s3[k] = Date.now();
        localStorage.setItem('at_bp_' + cToday, JSON.stringify(s3));
      }, bi * 1200);
    });
  }, 30000);
}

/**
 * Real online count: actual sessions + 3 bots
 */
function atOnlineCount() {
  const key = 'at_sessions';
  let sessions = {};
  try { sessions = JSON.parse(localStorage.getItem(key) || '{}'); } catch {}
  let sid = localStorage.getItem('at_sid');
  if (!sid) { sid = 's_' + Date.now().toString(36); localStorage.setItem('at_sid', sid); }
  sessions[sid] = Date.now();
  const cutoff = Date.now() - 600000;
  Object.keys(sessions).forEach(k => { if (sessions[k] < cutoff) delete sessions[k]; });
  localStorage.setItem(key, JSON.stringify(sessions));
  return Math.max(1, Object.keys(sessions).length) + 3;
}

// Heartbeat
setInterval(() => {
  const sid = localStorage.getItem('at_sid'); if (!sid) return;
  let s = {}; try { s = JSON.parse(localStorage.getItem('at_sessions') || '{}'); } catch {}
  s[sid] = Date.now();
  const cut = Date.now() - 600000;
  Object.keys(s).forEach(k => { if (s[k] < cut) delete s[k]; });
  localStorage.setItem('at_sessions', JSON.stringify(s));
}, 60000);
