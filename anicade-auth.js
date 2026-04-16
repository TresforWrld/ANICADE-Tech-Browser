/**
 * ANICADE Tech Browser — Shared Auth & JSONBin Utility
 * Include this via <script src="anicade-auth.js"></script>
 */

// ── CONFIG ──────────────────────────────
const AT_CONFIG = {
  USERS_BIN  : '69e15a7836566621a8bfacda',
  JSONBIN_BASE: 'https://api.jsonbin.io/v3/b',
  MASTER_KEY_LS: '$2a$10$VJXQzwtVgNhMTIJiiQvpy.hG7XaRD0.H42NyZhKzeLRungeekMmpO',
  SESSION_KEY  : '$2a$10$VJXQzwtVgNhMTIJiiQvpy.hG7XaRD0.H42NyZhKzeLRungeekMmpO',
  LOGIN_PAGE   : 'login.html',
};

// ── SESSION ──────────────────────────────
const ATAuth = {
  get() {
    try { return JSON.parse(localStorage.getItem(AT_CONFIG.SESSION_KEY) || 'null'); }
    catch { return null; }
  },
  set(u) { localStorage.setItem(AT_CONFIG.SESSION_KEY, JSON.stringify(u)); },
  clear() { localStorage.removeItem(AT_CONFIG.SESSION_KEY); },
  isLoggedIn() { return !!this.get(); },
  isAdmin() { const u=this.get(); return !!(u&&u.isAdmin); },

  /**
   * Redirect to login if not logged in.
   * @param {string} reason - shown as notice on login page
   */
  require(reason='') {
    if(!this.isLoggedIn()){
      const here = encodeURIComponent(location.href);
      const r = reason ? `&reason=${reason}` : '';
      window.location.href = `${AT_CONFIG.LOGIN_PAGE}?redirect=${here}${r}`;
      return false;
    }
    return true;
  },

  logout() {
    this.clear();
    window.location.href = AT_CONFIG.LOGIN_PAGE;
  },
};

// ── JSONBIN ──────────────────────────────
const ATJB = {
  _key() { return localStorage.getItem(AT_CONFIG.MASTER_KEY_LS) || ''; },

  async read(binId) {
    const headers = { 'Content-Type': 'application/json' };
    const k = this._key();
    if(k) headers['X-Master-Key'] = k;
    const r = await fetch(`${AT_CONFIG.JSONBIN_BASE}/${binId}/latest`, { headers });
    if(!r.ok) throw new Error('JB read failed: '+r.status);
    return (await r.json()).record;
  },

  async write(binId, data) {
    const k = this._key();
    if(!k) throw new Error('No JSONBin master key configured');
    const r = await fetch(`${AT_CONFIG.JSONBIN_BASE}/${binId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Master-Key': k },
      body: JSON.stringify(data),
    });
    if(!r.ok) throw new Error('JB write failed: '+r.status);
    return (await r.json()).record;
  },

  /** Read users array from users bin */
  async getUsers() {
    try {
      const rec = await this.read(AT_CONFIG.USERS_BIN);
      return rec.users || [];
    } catch { return []; }
  },

  /** Save full users array back */
  async saveUsers(users) {
    return this.write(AT_CONFIG.USERS_BIN, { users });
  },

  /** Update a single user by id */
  async updateUser(updatedUser) {
    const k = this._key();
    if(!k){ // local-only fallback
      const s = ATAuth.get();
      if(s && s.id === updatedUser.id){ ATAuth.set({...s,...updatedUser}); }
      return;
    }
    try {
      const rec = await this.read(AT_CONFIG.USERS_BIN);
      const users = rec.users || [];
      const idx = users.findIndex(u => u.id === updatedUser.id);
      if(idx !== -1) users[idx] = { ...users[idx], ...updatedUser };
      else users.push(updatedUser);
      await this.write(AT_CONFIG.USERS_BIN, { users });
    } catch(e) { console.warn('updateUser fallback:', e); }
  },

  /** Increment search counter for current user */
  async bumpSearch() {
    const u = ATAuth.get();
    if(!u) return;
    u.searches = (u.searches||0) + 1;
    ATAuth.set(u);
    // Async update to bin (fire-and-forget)
    this.updateUser({ id:u.id, searches:u.searches }).catch(()=>{});
  },
};

// ── COUNTRIES ────────────────────────────
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
  {n:'🇧🇷 Brazil',tz:'America/Sao_Paulo'},{n:'🌍 Other (UTC)',tz:'UTC'},
];

function atCountryName(tz){
  const c = AT_COUNTRIES.find(x=>x.tz===tz);
  return c ? c.n.split(' ').slice(1).join(' ') : 'Zambia';
}

// ── 3 ANICADE BOTS ───────────────────────
const AT_BOTS = {
  apiBot: {
    name: 'ANICADE_APIBot',
    color: '#00BFFF',
    role: 'API Discovery',
    tasks: [
      // Morning
      'Good morning devs! 🌅 Morning API pick: OpenWeatherMap — free tier gives 1M calls/month. Perfect for weather widgets. → openweathermap.org/api',
      'Rise and code! 🌄 Try the NASA Open APIs today — free space imagery, APOD, Mars rover photos. Great for portfolio projects. → api.nasa.gov',
      'Morning! 🔵 API of the day: CoinGecko — free crypto market data, no key needed. 13k+ coins. → coingecko.com/en/api',
      // Afternoon
      'Afternoon devs! ⚡ Free API spotlight: REST Countries — get every country\'s flag, capital, currency, language with one GET. → restcountries.com',
      'Mid-day pick 🔌: Pexels API — 3 million free stock photos. Add pro visuals to any project at zero cost. → pexels.com/api',
      'Afternoon recommendation 🌐: JSONPlaceholder — the best fake REST API for testing. No signup, instant use. → jsonplaceholder.typicode.com',
      // Evening
      'Evening devs! 🌙 Wind down with this gem: The Movie DB API — 1M+ movies, TV, cast data. Free for non-commercial. → developers.themoviedb.org',
      'Night build session? 🌑 Check out Quotable API — clean quotes endpoint, filter by author and tag. → quotable.io',
      'Evening pick 🔵: HackerNews API — access all HN posts, comments and users via Firebase. Free, no key. → github.com/HackerNews/API',
    ]
  },
  aiBot: {
    name: 'ANICADE_AIBot',
    color: '#C6A85C',
    role: 'AI Tool Scout',
    tasks: [
      // Morning
      'Morning AI pick! 🤖 Groq API — Llama 3 at 800 tokens/sec. Free tier is insanely fast. Use it for chatbots with instant responses. → console.groq.com',
      'Good morning! 🌅 Today\'s AI rec: Ollama — run LLMs like Llama 3, Mistral and Phi-3 completely offline. Zero API cost. → ollama.ai',
      'Rise & grind! ⚡ Hugging Face Inference API — free tier for 30k+ models. Test NLP, vision and audio AI without a server. → huggingface.co',
      // Afternoon
      'Afternoon AI drop! 🧠 Codeium — free AI code completion for 70+ languages and 40+ editors. Zero cost Copilot alternative. → codeium.com',
      'Mid-day rec 🤖: Replicate API — run Stable Diffusion, Whisper, LLaVA via simple API calls. Pay per second. → replicate.com',
      'Afternoon tip! 🌐 LM Studio — run any GGUF model locally with an OpenAI-compatible server. Desktop app, dead simple. → lmstudio.ai',
      // Evening
      'Evening AI pick! 🌙 ElevenLabs free tier — 10k characters/month of insanely realistic TTS. Add voice to your apps. → elevenlabs.io',
      'Night build? 🌑 Transformers.js — run Hugging Face models in the browser. No server. Works with React, Vanilla JS. → github.com/xenova/transformers.js',
      'Evening rec 🤖: Together AI — cheapest Llama 3 70B inference available. Great for production AI features. → together.ai',
    ]
  },
  devBot: {
    name: 'ANICADE_DevBot',
    color: '#39ff14',
    role: 'Dev Tools & Tips',
    tasks: [
      // Morning
      'Morning dev tip! 🛠 Use Vite instead of Webpack — 10–100x faster dev server HMR. Drop-in for most React/Vue projects. → vitejs.dev',
      'Good morning! 🌅 Tool pick: Biome.js — replaces ESLint + Prettier in one Rust-powered tool. Lightning fast. → biomejs.dev',
      'Rise and code! ⚡ Supabase free tier: 500MB Postgres + Auth + Storage + Realtime. Best free BaaS in 2025. → supabase.com',
      // Afternoon
      'Afternoon stack rec! 🔵 Drizzle ORM — TypeScript-first, zero runtime overhead, great DX. Beats Prisma for edge deployments. → orm.drizzle.team',
      'Mid-day pick 🛠: Turso — edge SQLite powered by libSQL. Free tier: 500 DBs, 9GB storage. Insanely low latency. → turso.tech',
      'Afternoon tip! ⚡ Railway.app free tier — deploy Postgres, Redis, Node, Python with zero config. GitHub → deploy in 60 seconds. → railway.app',
      // Evening
      'Evening dev pick! 🌙 Zod — TypeScript-first validation. Pair with React Hook Form for bulletproof forms. → zod.dev',
      'Night build tip 🌑: shadcn/ui — copy-paste accessible React components. No npm install bloat, just code you own. → ui.shadcn.com',
      'Evening rec! 🛠 Playwright — Microsoft\'s E2E test framework. Faster than Cypress, cross-browser, auto-wait. → playwright.dev',
    ]
  }
};

/**
 * Get which bot messages to show based on current time
 * Returns an array of {bot, message} for morning/afternoon/evening
 * Cycles through the 3 messages per slot daily
 */
function atGetBotMessages(slotOverride) {
  const h = new Date().getHours();
  let slot, slotIdx;

  if(slotOverride !== undefined){
    slot = slotOverride;
  } else if(h >= 5 && h < 12){
    slot = 0; // morning (indices 0,1,2)
  } else if(h >= 12 && h < 18){
    slot = 1; // afternoon (indices 3,4,5)
  } else {
    slot = 2; // evening (indices 6,7,8)
  }

  // Rotate daily so it doesn't repeat every day
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(),0,0)) / 86400000);
  const rotation = dayOfYear % 3;
  slotIdx = slot * 3 + rotation;

  return [
    { bot: AT_BOTS.apiBot, msg: AT_BOTS.apiBot.tasks[slotIdx] || AT_BOTS.apiBot.tasks[0] },
    { bot: AT_BOTS.aiBot,  msg: AT_BOTS.aiBot.tasks[slotIdx]  || AT_BOTS.aiBot.tasks[0]  },
    { bot: AT_BOTS.devBot, msg: AT_BOTS.devBot.tasks[slotIdx] || AT_BOTS.devBot.tasks[0] },
  ];
}
