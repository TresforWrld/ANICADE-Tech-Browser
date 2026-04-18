/**
 * ANICADE Tech Browser — Sync Module v2.0
 * All public data (chat, rooms, projects, presence, ratings) goes to JSONBin.
 * localStorage is ONLY used for: session, bot-avatar uploads, JB key.
 */

// ════════════════════════════════════════════════════════
//  REAL BIN IDs & KEYS
// ════════════════════════════════════════════════════════
const AT_SYNC = {
  BASE       : 'https://api.jsonbin.io/v3/b',
  MASTER_KEY : '$2a$10$VJXQzwtVgNhMTIJiiQvpy.hG7XaRD0.H42NyZhKzeLRungeekMmpO',
  ACCESS_KEY : '$2a$10$t1pvIZA0plsMluFZ9oGuHeEXnbeyv10dGX5p15Q0xdfXGg2fsW0.2',
  BINS: {
    USERS   : '69e20511aaba8821970be2cd',
    CHAT    : '69e1fff636566621a8c2797f',
    ROOMS   : '69e200e536566621a8c27e00',
    PROJECTS: '69e2014faaba8821970bd066',
    PRESENCE: '69e201ea856a682189439c00',
    RATINGS : '69e2501336566621a8c3e79d',
    REVIEWS : '69e2b0e6aaba8821970ecd8a',
  },
  POLL: {
    CHAT    : 5000,   // 5s
    ROOMS   : 15000,  // 15s
    PRESENCE: 30000,  // 30s
  },
  MAX_CHAT: 100,
  PRESENCE_TTL: 90000, // 90s
};

// ════════════════════════════════════════════════════════
//  CORE READ / WRITE
// ════════════════════════════════════════════════════════
async function _read(binId) {
  const r = await fetch(`${AT_SYNC.BASE}/${binId}/latest`, {
    method: 'GET',
    headers: {
      'X-Master-Key': AT_SYNC.MASTER_KEY,
      'X-Access-Key': AT_SYNC.ACCESS_KEY,
    },
  });
  if (!r.ok) throw new Error(`JB read ${binId}: ${r.status}`);
  const json = await r.json();
  // JSONBin returns { record: {...} } or directly the object
  return json.record !== undefined ? json.record : json;
}

async function _write(binId, data) {
  const r = await fetch(`${AT_SYNC.BASE}/${binId}`, {
    method : 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Master-Key': AT_SYNC.MASTER_KEY,
    },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(`JB write ${binId}: ${r.status}`);
  return (await r.json()).record;
}

// ════════════════════════════════════════════════════════
//  GENERATE IDs
// ════════════════════════════════════════════════════════
function _uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function _now() {
  return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function _ts() { return Date.now(); }

// ════════════════════════════════════════════════════════
//  SESSION HELPER
// ════════════════════════════════════════════════════════
function _session() {
  try { return JSON.parse(localStorage.getItem('anicade_session') || 'null'); } catch { return null; }
}

function _sid() {
  let s = sessionStorage.getItem('at_sid');
  if (!s) { s = _uid('s'); sessionStorage.setItem('at_sid', s); }
  return s;
}

// ════════════════════════════════════════════════════════
//  CHAT SYNC
// ════════════════════════════════════════════════════════
let _chatPoll     = null;
let _chatLastId   = null;
let _chatOnNewMsg = null;

/**
 * Send a message to the chat bin.
 * msg must have: { name, text, color, avatar?, time, ts, userId?, roomId? }
 */
async function syncSendChat(msg) {
  msg.id = msg.id || _uid('cm');
  msg.time = msg.time || _now();
  msg.ts   = msg.ts   || _ts();
  const rec  = await _read(AT_SYNC.BINS.CHAT);
  const msgs = Array.isArray(rec?.messages) ? rec.messages : [];
  msgs.push(msg);
  if (msgs.length > AT_SYNC.MAX_CHAT) msgs.splice(0, msgs.length - AT_SYNC.MAX_CHAT);
  await _write(AT_SYNC.BINS.CHAT, { messages: msgs });
  return msg;
}

/**
 * Start polling chat. cb(messages[], isHistory)
 * isHistory=true on first load, false for incremental updates.
 */
async function syncStartChat(cb) {
  _chatOnNewMsg = cb;
  try {
    const rec  = await _read(AT_SYNC.BINS.CHAT);
    const msgs = Array.isArray(rec?.messages) ? rec.messages : [];
    if (msgs.length) {
      _chatLastId = msgs[msgs.length - 1].id;
      cb(msgs, true);
    }
  } catch (e) { console.error('[SYNC] chat init FAILED:', e.message, '\nCheck: bin IDs, master key, CORS'); }

  // Post bot messages if needed (only for global chat, not room-specific)
  _syncBotMessages().catch(() => {});

  _chatPoll = setInterval(async () => {
    try {
      const rec  = await _read(AT_SYNC.BINS.CHAT);
      const msgs = Array.isArray(rec?.messages) ? rec.messages : [];
      if (!msgs.length) return;
      if (!_chatLastId) { _chatLastId = msgs[msgs.length - 1].id; cb(msgs, true); return; }
      const lastIdx = msgs.findIndex(m => m.id === _chatLastId);
      const newMsgs = lastIdx === -1 ? msgs : msgs.slice(lastIdx + 1);
      if (newMsgs.length) {
        _chatLastId = newMsgs[newMsgs.length - 1].id;
        cb(newMsgs, false);
      }
    } catch {}
  }, AT_SYNC.POLL.CHAT);
}

function syncStopChat() {
  if (_chatPoll) { clearInterval(_chatPoll); _chatPoll = null; }
}

// ── ROOM CHAT (same bin, filtered by roomId) ──
let _roomPoll   = null;
let _roomLastId = null;

async function syncSendRoomMsg(roomId, msg) {
  msg.id     = msg.id     || _uid('rm');
  msg.roomId = roomId;
  msg.time   = msg.time   || _now();
  msg.ts     = msg.ts     || _ts();
  return syncSendChat(msg);
}

async function syncLoadRoomChat(roomId, cb) {
  // Reset room poll
  syncStopRoomChat();
  _roomLastId = null;
  try {
    const rec  = await _read(AT_SYNC.BINS.CHAT);
    const msgs = (rec?.messages || []).filter(m => m.roomId === roomId);
    if (msgs.length) { _roomLastId = msgs[msgs.length - 1].id; cb(msgs, true); }
  } catch (e) { console.warn('[SYNC] room chat init:', e.message); }

  _roomPoll = setInterval(async () => {
    try {
      const rec  = await _read(AT_SYNC.BINS.CHAT);
      const msgs = (rec?.messages || []).filter(m => m.roomId === roomId);
      if (!msgs.length) return;
      const lastIdx = _roomLastId ? msgs.findIndex(m => m.id === _roomLastId) : -1;
      const newMsgs = lastIdx === -1 ? msgs : msgs.slice(lastIdx + 1);
      if (newMsgs.length) {
        _roomLastId = newMsgs[newMsgs.length - 1].id;
        cb(newMsgs, false);
      }
    } catch {}
  }, AT_SYNC.POLL.CHAT);
}

function syncStopRoomChat() {
  if (_roomPoll) { clearInterval(_roomPoll); _roomPoll = null; }
}

// ════════════════════════════════════════════════════════
//  PRESENCE SYNC
// ════════════════════════════════════════════════════════
let _presencePoll = null;

async function syncStartPresence(userId, name, page, cb) {
  const sid = _sid();

  async function _beat() {
    try {
      const rec      = await _read(AT_SYNC.BINS.PRESENCE);
      const sessions = rec?.sessions || {};
      const cutoff   = _ts() - AT_SYNC.PRESENCE_TTL;

      // Prune stale
      Object.keys(sessions).forEach(k => { if (sessions[k].ts < cutoff) delete sessions[k]; });

      // Register self
      sessions[sid] = { userId, name, page, ts: _ts() };

      await _write(AT_SYNC.BINS.PRESENCE, { sessions });

      const count = Math.max(1, Object.keys(sessions).length) + 3; // +3 bots
      if (cb) cb(count, sessions);
    } catch {
      if (cb) cb(4, {});
    }
  }

  await _beat();
  _presencePoll = setInterval(_beat, AT_SYNC.POLL.PRESENCE);
}

function syncStopPresence() {
  if (_presencePoll) { clearInterval(_presencePoll); _presencePoll = null; }
}

// Also remove self from presence on unload
window.addEventListener('beforeunload', async () => {
  const sid = _sid();
  try {
    const rec = await _read(AT_SYNC.BINS.PRESENCE);
    const sessions = rec?.sessions || {};
    delete sessions[sid];
    await _write(AT_SYNC.BINS.PRESENCE, { sessions });
  } catch {}
});

// ════════════════════════════════════════════════════════
//  ROOMS SYNC
// ════════════════════════════════════════════════════════
const ROOMS_DEFAULT = [
  {id:'r1',name:'React + Supabase Fullstack',desc:'Building a real-time dashboard with React and Supabase.',type:'code',tags:['React','Supabase','TypeScript'],members:[],max:4,host:'tresfor_dev',created:0},
  {id:'r2',name:'Next.js 14 App Router',desc:'Migrating to the new App Router architecture.',type:'code',tags:['Next.js','React','SSR'],members:[],max:4,host:'code_nia',created:0},
  {id:'r3',name:'Design System Review',desc:'Reviewing components and design tokens. Feedback welcome.',type:'design',tags:['Figma','CSS','Tokens'],members:[],max:6,host:'px_ludo',created:0},
  {id:'r4',name:'Python FastAPI Review',desc:'Code review session for a REST API project.',type:'review',tags:['Python','FastAPI','REST'],members:[],max:4,host:'techZM',created:0},
  {id:'r5',name:'DSA Study Group',desc:'Solving LeetCode problems together. All levels welcome.',type:'study',tags:['DSA','Python','Interview'],members:[],max:10,host:'dev_zak',created:0},
  {id:'r6',name:'Flutter Mobile App',desc:'Building a fintech mobile app with Flutter + Firebase.',type:'code',tags:['Flutter','Dart','Firebase'],members:[],max:4,host:'mobile_lex',created:0},
  {id:'r7',name:'Tailwind Component Library',desc:'Building accessible UI components with Tailwind + Storybook.',type:'design',tags:['Tailwind','React','Storybook'],members:[],max:6,host:'css_guru',created:0},
  {id:'r8',name:'Node.js Security Review',desc:'Reviewing auth, JWT and API security patterns.',type:'review',tags:['Node.js','JWT','Security'],members:[],max:4,host:'sec_audit',created:0},
];

async function syncGetRooms() {
  try {
    const rec   = await _read(AT_SYNC.BINS.ROOMS);
    let rooms   = Array.isArray(rec?.rooms) ? rec.rooms : [];
    if (rooms.length === 0) {
      // Seed defaults on first use
      rooms = ROOMS_DEFAULT.map(r => ({ ...r, created: _ts() }));
      await _write(AT_SYNC.BINS.ROOMS, { rooms });
    }
    // Expire custom rooms older than 24h that are empty
    const cutoff = _ts() - 86400000;
    rooms = rooms.filter(r => !r.custom || r.created > cutoff || (r.members && r.members.length > 0));
    return rooms;
  } catch (e) {
    console.warn('[SYNC] getRooms:', e.message);
    return ROOMS_DEFAULT;
  }
}

async function syncCreateRoom(room) {
  room.id      = room.id      || _uid('r');
  room.members = room.members || [];
  room.created = _ts();
  room.custom  = true;
  try {
    const rec   = await _read(AT_SYNC.BINS.ROOMS);
    const rooms = Array.isArray(rec?.rooms) ? rec.rooms : [...ROOMS_DEFAULT];
    rooms.unshift(room);
    if (rooms.length > 30) rooms.length = 30;
    await _write(AT_SYNC.BINS.ROOMS, { rooms });
    return rooms;
  } catch (e) {
    console.warn('[SYNC] createRoom:', e.message);
    return [room, ...ROOMS_DEFAULT];
  }
}

async function syncJoinRoom(roomId, userId, userName) {
  try {
    const rec   = await _read(AT_SYNC.BINS.ROOMS);
    const rooms = Array.isArray(rec?.rooms) ? rec.rooms : [];
    const room  = rooms.find(r => r.id === roomId);
    if (!room) return rooms;
    if (!Array.isArray(room.members)) room.members = [];
    // Remove stale (joined > 2h ago)
    room.members = room.members.filter(m => _ts() - m.joinedAt < 7200000);
    if (!room.members.find(m => m.userId === userId)) {
      room.members.push({ userId, userName, joinedAt: _ts() });
    }
    await _write(AT_SYNC.BINS.ROOMS, { rooms });
    return rooms;
  } catch (e) {
    console.warn('[SYNC] joinRoom:', e.message);
    return [];
  }
}

async function syncLeaveRoom(roomId, userId) {
  try {
    const rec   = await _read(AT_SYNC.BINS.ROOMS);
    const rooms = Array.isArray(rec?.rooms) ? rec.rooms : [];
    const room  = rooms.find(r => r.id === roomId);
    if (room && Array.isArray(room.members)) {
      room.members = room.members.filter(m => m.userId !== userId);
    }
    await _write(AT_SYNC.BINS.ROOMS, { rooms });
    return rooms;
  } catch { return []; }
}

let _roomsPoll = null;
function syncStartRooms(cb) {
  syncGetRooms().then(cb);
  _roomsPoll = setInterval(() => syncGetRooms().then(cb), AT_SYNC.POLL.ROOMS);
}
function syncStopRooms() {
  if (_roomsPoll) { clearInterval(_roomsPoll); _roomsPoll = null; }
}

// ════════════════════════════════════════════════════════
//  PROJECTS SYNC
// ════════════════════════════════════════════════════════
const PROJECTS_DEFAULT = [
  {id:'p1',name:'AfriPay Dashboard',owner:'tresfor_dev',desc:'Pan-African payment dashboard built with React + Supabase.',stack:['React','Supabase','Stripe'],stars:12,forks:3,status:'active',created:0},
  {id:'p2',name:'ZamWeather PWA',owner:'dev_zak',desc:'Offline-capable weather PWA for Zambia and surrounding regions.',stack:['Svelte','OpenWeather'],stars:8,forks:1,status:'active',created:0},
  {id:'p3',name:'AniBot Discord',owner:'code_nia',desc:'Anime content Discord bot with 2,000+ servers.',stack:['Node.js','Discord.js'],stars:24,forks:7,status:'showcase',created:0},
  {id:'p4',name:'EduTrack Mobile',owner:'mobile_lex',desc:'Student progress tracking app for Zambian schools.',stack:['Flutter','Firebase'],stars:5,forks:2,status:'wip',created:0},
  {id:'p5',name:'DevPortfolio Generator',owner:'css_guru',desc:'AI-powered portfolio site generator. Build in 60 seconds.',stack:['Astro','Tailwind','OpenAI'],stars:31,forks:9,status:'active',created:0},
];

async function syncGetProjects() {
  try {
    const rec      = await _read(AT_SYNC.BINS.PROJECTS);
    let projects   = Array.isArray(rec?.projects) ? rec.projects : [];
    if (projects.length === 0) {
      projects = PROJECTS_DEFAULT.map(p => ({ ...p, created: _ts() }));
      await _write(AT_SYNC.BINS.PROJECTS, { projects });
    }
    return projects;
  } catch (e) {
    console.warn('[SYNC] getProjects:', e.message);
    return PROJECTS_DEFAULT;
  }
}

async function syncShareProject(project) {
  project.id      = _uid('p');
  project.created = _ts();
  project.stars   = 0;
  project.forks   = 0;
  try {
    const rec      = await _read(AT_SYNC.BINS.PROJECTS);
    const projects = Array.isArray(rec?.projects) ? rec.projects : [...PROJECTS_DEFAULT];
    projects.unshift(project);
    if (projects.length > 50) projects.length = 50;
    await _write(AT_SYNC.BINS.PROJECTS, { projects });
    return projects;
  } catch (e) {
    console.warn('[SYNC] shareProject:', e.message);
    return [project, ...PROJECTS_DEFAULT];
  }
}

// ════════════════════════════════════════════════════════
//  RATINGS SYNC
// ════════════════════════════════════════════════════════
/**
 * Get all ratings
 */
async function syncGetRatings() {
  try {
    const rec = await _read(AT_SYNC.BINS.RATINGS);
    return rec?.ratings || [];
  } catch { return []; }
}

/**
 * Submit or update a rating for a resource.
 * @param {string} resourceId - unique ID for the resource (e.g. tool name slug)
 * @param {string} resourceName - display name
 * @param {string} category - 'api'|'ai'|'dev'|'solution'
 * @param {number} stars - 1–5
 * @param {string} comment - optional comment
 * @param {string} userId
 * @param {string} userName
 */
async function syncSubmitRating(resourceId, resourceName, category, stars, comment, userId, userName) {
  try {
    const rec     = await _read(AT_SYNC.BINS.RATINGS);
    const ratings = Array.isArray(rec?.ratings) ? rec.ratings : [];

    // Replace existing rating by same user for same resource
    const existIdx = ratings.findIndex(r => r.resourceId === resourceId && r.userId === userId);
    const entry = {
      id        : _uid('rt'),
      resourceId,
      resourceName,
      category,
      stars,
      comment   : (comment || '').slice(0, 200),
      userId,
      userName,
      time      : _now(),
      ts        : _ts(),
    };
    if (existIdx !== -1) {
      ratings[existIdx] = entry;
    } else {
      ratings.unshift(entry);
    }
    if (ratings.length > 500) ratings.length = 500;
    await _write(AT_SYNC.BINS.RATINGS, { ratings });
    return { success: true, ratings };
  } catch (e) {
    console.warn('[SYNC] submitRating:', e.message);
    return { success: false };
  }
}

/**
 * Get average rating and count for a resource.
 */
function syncGetResourceRating(ratings, resourceId) {
  const rr = ratings.filter(r => r.resourceId === resourceId);
  if (!rr.length) return { avg: 0, count: 0 };
  const avg = rr.reduce((a, r) => a + r.stars, 0) / rr.length;
  return { avg: Math.round(avg * 10) / 10, count: rr.length };
}

/**
 * Get latest ratings (for the ratings section display).
 */
function syncGetLatestRatings(ratings, limit = 20) {
  return [...ratings].sort((a, b) => b.ts - a.ts).slice(0, limit);
}

// ════════════════════════════════════════════════════════
//  BOT MESSAGES (posted to DB, not localStorage)
// ════════════════════════════════════════════════════════
async function _syncBotMessages() {
  // Check if today's bots already exist in chat bin
  const today    = new Date().toISOString().slice(0, 10);
  const h        = new Date().getHours();
  const slot     = h >= 6 && h < 12 ? 'morning' : h >= 12 && h < 20 ? 'afternoon' : 'evening';
  const rot      = Math.floor((Date.now() - new Date('2026-01-01').getTime()) / 86400000) % 3;
  const slotH    = { morning: 6, afternoon: 12, evening: 20 }[slot];
  const d        = new Date(); d.setHours(slotH, 0, 0, 0);
  const slotTime = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

  try {
    const rec  = await _read(AT_SYNC.BINS.CHAT);
    const msgs = Array.isArray(rec?.messages) ? rec.messages : [];

    // Check which bots already posted this slot today
    const prefix = `bot_${slot}_${today}_`;
    if (typeof AT_BOTS === 'undefined' || !AT_BOTS.length) return;
  for (let i = 0; i < AT_BOTS.length; i++) {
      const bot   = AT_BOTS[i];
      const msgId = `${prefix}${bot.id}`;
      if (msgs.find(m => m.id === msgId)) continue; // already posted

      const msg = {
        id    : msgId,
        name  : bot.name,
        text  : bot.messages[slot][rot],
        color : bot.color,
        avatar: localStorage.getItem('at_bot_av_' + bot.id) || bot.avatar || null,
        time  : slotTime,
        ts    : d.getTime() + i * 2000,
        isBot : true,
      };
      msgs.push(msg);
      if (msgs.length > AT_SYNC.MAX_CHAT) msgs.splice(0, msgs.length - AT_SYNC.MAX_CHAT);
    }
    await _write(AT_SYNC.BINS.CHAT, { messages: msgs });
  } catch (e) { console.warn('[SYNC] botMessages:', e.message); }
}

// Schedule bot posts at exact slot boundaries (check every 30s)
setInterval(async () => {
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes();
  if ((h === 6 || h === 12 || h === 20) && m === 0) {
    await _syncBotMessages().catch(() => {});
  }
}, 30000);

// ════════════════════════════════════════════════════════
//  BROADCAST (admin → chat bin)
// ════════════════════════════════════════════════════════
async function syncBroadcast(fromName, text) {
  return syncSendChat({
    id          : _uid('bc'),
    name        : '📡 ' + fromName,
    text,
    color       : '#ff8080',
    time        : _now(),
    ts          : _ts(),
    isBroadcast : true,
  });
}

// ════════════════════════════════════════════════════════
//  STATUS
// ════════════════════════════════════════════════════════
function syncIsConfigured() { return true; } // always configured now

function syncShowConfigWarning() {} // no-op — bins are configured
