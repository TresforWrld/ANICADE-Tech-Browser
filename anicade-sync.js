/**
 * ANICADE Tech Browser — Real-time Sync Module
 * Syncs: global chat, collab rooms, shared projects, online presence
 * Uses JSONBin as backend with 5s polling for chat, 15s for rooms/projects
 */

// ════════════════════════════════════════════════════════
//  BIN IDs — one bin per data type
//  You must create these bins in your JSONBin account.
//  Each starts with an empty object shown below.
//  Chat bin initial value:    { "messages": [] }
//  Rooms bin initial value:   { "rooms": [] }
//  Projects bin initial value:{ "projects": [] }
//  Presence bin initial value:{ "sessions": {} }
// ════════════════════════════════════════════════════════
const AT_SYNC_BINS = {
  CHAT    : '69b14c5bc3097a1dd5173666',  // REPLACE with your chat bin ID
  ROOMS   : '69b14c5bc3097a1dd5173667',  // REPLACE with your rooms bin ID
  PROJECTS: '69b14c5bc3097a1dd5173668',  // REPLACE with your projects bin ID
  PRESENCE: '69b14c5bc3097a1dd5173669',  // REPLACE with your presence bin ID
};

// ════════════════════════════════════════════════════════
//  CONFIGURATION
// ════════════════════════════════════════════════════════
const SYNC_CFG = {
  CHAT_POLL_MS   : 5000,   // poll chat every 5 seconds
  ROOMS_POLL_MS  : 15000,  // poll rooms every 15 seconds
  PRESENCE_TTL_MS: 90000,  // session expires after 90s of no heartbeat
  MAX_CHAT_MSGS  : 80,     // keep last 80 messages in bin
  JB_BASE        : 'https://api.jsonbin.io/v3/b',
};

// ════════════════════════════════════════════════════════
//  CORE JB READ/WRITE (uses key from anicade-auth.js)
// ════════════════════════════════════════════════════════
const _jbKey = () => localStorage.getItem('anicade_jb_master') || '';

async function _jbRead(binId) {
  const headers = { 'Content-Type': 'application/json' };
  const k = _jbKey();
  if (k) headers['X-Master-Key'] = k;
  headers['X-Bin-Meta'] = 'false'; // faster — skip metadata
  const r = await fetch(`${SYNC_CFG.JB_BASE}/${binId}/latest`, { headers });
  if (!r.ok) throw new Error(`JB read ${binId}: ${r.status}`);
  return (await r.json()).record;
}

async function _jbWrite(binId, data) {
  const k = _jbKey();
  if (!k) throw new Error('No JSONBin master key — set it in Admin Panel > JSONBin Key');
  const r = await fetch(`${SYNC_CFG.JB_BASE}/${binId}`, {
    method : 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Master-Key': k },
    body   : JSON.stringify(data),
  });
  if (!r.ok) throw new Error(`JB write ${binId}: ${r.status}`);
  return (await r.json()).record;
}

// ════════════════════════════════════════════════════════
//  OFFLINE CACHE — fallback when JB is unavailable
// ════════════════════════════════════════════════════════
const _cache = {
  get(key) { try { return JSON.parse(localStorage.getItem('at_cache_' + key) || 'null'); } catch { return null; } },
  set(key, val) { try { localStorage.setItem('at_cache_' + key, JSON.stringify(val)); } catch {} },
};

// ════════════════════════════════════════════════════════
//  CHAT SYNC
// ════════════════════════════════════════════════════════
let _chatLastSeenId = null;
let _chatPollTimer  = null;
let _chatCB         = null; // callback(newMessages[])

/**
 * Send a chat message to JSONBin.
 * @param {object} msg - { id, name, text, color, avatar, time, ts }
 */
async function syncSendChat(msg) {
  try {
    let rec = await _jbRead(AT_SYNC_BINS.CHAT);
    if (!rec || !Array.isArray(rec.messages)) rec = { messages: [] };
    rec.messages.push(msg);
    // Keep last MAX_CHAT_MSGS
    if (rec.messages.length > SYNC_CFG.MAX_CHAT_MSGS) {
      rec.messages = rec.messages.slice(-SYNC_CFG.MAX_CHAT_MSGS);
    }
    await _jbWrite(AT_SYNC_BINS.CHAT, rec);
    _cache.set('chat', rec);
    return true;
  } catch (e) {
    console.warn('[SYNC] sendChat failed:', e.message);
    // Local fallback — store in cache so it shows immediately
    const cached = _cache.get('chat') || { messages: [] };
    cached.messages.push(msg);
    _cache.set('chat', cached);
    return false;
  }
}

/**
 * Post all 3 bot messages for the current slot (called once per slot per day).
 */
async function syncPostBotMessages() {
  const today = new Date().toISOString().slice(0, 10);
  const key   = 'at_bots_synced_' + today;
  const slot  = (() => { const h = new Date().getHours(); return h >= 6 && h < 12 ? 'morning' : h >= 12 && h < 20 ? 'afternoon' : 'evening'; })();
  const postKey = slot;

  // Check if already synced this slot today
  let synced = {};
  try { synced = JSON.parse(localStorage.getItem(key) || '{}'); } catch {}
  if (synced[postKey]) return; // already posted this slot

  const rot = Math.floor((Date.now() - new Date('2026-01-01').getTime()) / 86400000) % 3;
  const slotHours = { morning: 6, afternoon: 12, evening: 20 };
  const h = slotHours[slot];
  const d = new Date(); d.setHours(h, 0, 0, 0);
  const ts = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

  for (let i = 0; i < AT_BOTS.length; i++) {
    const bot = AT_BOTS[i];
    const msg = {
      id    : `bot_${bot.id}_${slot}_${today}`,
      name  : bot.name,
      text  : bot.messages[slot][rot],
      color : bot.color,
      avatar: bot.avatar || localStorage.getItem('at_bot_av_' + bot.id) || null,
      time  : ts,
      ts    : d.getTime() + i * 1000, // stagger by 1s each
      isBot : true,
    };
    await syncSendChat(msg);
    await new Promise(r => setTimeout(r, 600));
  }

  synced[postKey] = Date.now();
  localStorage.setItem(key, JSON.stringify(synced));
}

/**
 * Start polling chat for new messages.
 * @param {function} cb - called with array of new messages since last poll
 * @param {boolean} loadHistory - load existing messages on start
 */
async function syncStartChat(cb, loadHistory = true) {
  _chatCB = cb;

  if (loadHistory) {
    try {
      const rec = await _jbRead(AT_SYNC_BINS.CHAT);
      const msgs = (rec && rec.messages) ? rec.messages : [];
      _cache.set('chat', rec);
      if (msgs.length > 0) {
        _chatLastSeenId = msgs[msgs.length - 1].id;
        cb(msgs, true); // true = history load
      }
    } catch {
      // Use cached messages if JB unavailable
      const cached = _cache.get('chat');
      if (cached && cached.messages) {
        _chatLastSeenId = cached.messages[cached.messages.length - 1]?.id || null;
        cb(cached.messages, true);
      }
    }
  }

  // Post bot messages if this slot hasn't posted yet
  syncPostBotMessages().catch(() => {});

  // Start polling
  _chatPollTimer = setInterval(_pollChat, SYNC_CFG.CHAT_POLL_MS);
}

async function _pollChat() {
  try {
    const rec = await _jbRead(AT_SYNC_BINS.CHAT);
    const msgs = (rec && rec.messages) ? rec.messages : [];
    _cache.set('chat', rec);

    if (!_chatLastSeenId) {
      if (msgs.length > 0) {
        _chatLastSeenId = msgs[msgs.length - 1].id;
        if (_chatCB) _chatCB(msgs, true);
      }
      return;
    }

    const lastIdx = msgs.findIndex(m => m.id === _chatLastSeenId);
    const newMsgs = lastIdx === -1 ? msgs : msgs.slice(lastIdx + 1);

    if (newMsgs.length > 0) {
      _chatLastSeenId = newMsgs[newMsgs.length - 1].id;
      if (_chatCB) _chatCB(newMsgs, false);
    }
  } catch {
    // Silent fail — keep polling
  }
}

function syncStopChat() {
  if (_chatPollTimer) { clearInterval(_chatPollTimer); _chatPollTimer = null; }
}

// ════════════════════════════════════════════════════════
//  PRESENCE SYNC (online count)
// ════════════════════════════════════════════════════════
let _presencePollTimer = null;
let _presenceCB = null;

/**
 * Register current session and get live online count.
 * @param {string} userId
 * @param {string} name
 * @param {string} page - 'index' | 'collab'
 * @param {function} cb - called with onlineCount (number)
 */
async function syncStartPresence(userId, name, page, cb) {
  _presenceCB = cb;
  const sid = _getOrCreateSID();

  async function _heartbeat() {
    try {
      const rec = await _jbRead(AT_SYNC_BINS.PRESENCE);
      const sessions = (rec && rec.sessions) ? rec.sessions : {};
      const cutoff = Date.now() - SYNC_CFG.PRESENCE_TTL_MS;

      // Prune expired
      Object.keys(sessions).forEach(k => { if (sessions[k].ts < cutoff) delete sessions[k]; });

      // Register/update self
      sessions[sid] = { userId, name, page, ts: Date.now() };

      await _jbWrite(AT_SYNC_BINS.PRESENCE, { sessions });

      const count = Object.keys(sessions).length + 3; // +3 bots always
      if (cb) cb(count, sessions);
      _cache.set('presence', { sessions });
    } catch {
      const cached = _cache.get('presence');
      const count = cached ? Object.keys(cached.sessions || {}).length + 3 : 4;
      if (cb) cb(count, {});
    }
  }

  await _heartbeat();
  _presencePollTimer = setInterval(_heartbeat, 30000); // heartbeat every 30s
}

function syncStopPresence() {
  if (_presencePollTimer) { clearInterval(_presencePollTimer); _presencePollTimer = null; }
}

function _getOrCreateSID() {
  let sid = sessionStorage.getItem('at_sid');
  if (!sid) { sid = 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6); sessionStorage.setItem('at_sid', sid); }
  return sid;
}

// ════════════════════════════════════════════════════════
//  ROOMS SYNC
// ════════════════════════════════════════════════════════
let _roomsPollTimer = null;
let _roomsCB = null;

const ROOMS_SEED = [
  {id:'r1',name:'React + Supabase Fullstack',desc:'Building a real-time dashboard.',type:'code',tags:['React','Supabase','TS'],members:[],max:4,host:'tresfor_dev',created:Date.now()},
  {id:'r2',name:'Next.js 14 App Router',desc:'Migrating to App Router architecture.',type:'code',tags:['Next.js','React'],members:[],max:4,host:'code_nia',created:Date.now()},
  {id:'r3',name:'Design System Review',desc:'Feedback on components and tokens.',type:'design',tags:['Figma','CSS'],members:[],max:6,host:'px_ludo',created:Date.now()},
  {id:'r4',name:'Python FastAPI Review',desc:'Code review for REST API project.',type:'review',tags:['Python','FastAPI'],members:[],max:4,host:'techZM',created:Date.now()},
  {id:'r5',name:'DSA Study Group',desc:'Solving LeetCode problems together.',type:'study',tags:['DSA','Python'],members:[],max:10,host:'dev_zak',created:Date.now()},
  {id:'r6',name:'Flutter Mobile App',desc:'Fintech app with Flutter + Firebase.',type:'code',tags:['Flutter','Dart'],members:[],max:4,host:'mobile_lex',created:Date.now()},
  {id:'r7',name:'Tailwind UI Components',desc:'Component library with Tailwind.',type:'design',tags:['Tailwind','React'],members:[],max:6,host:'css_guru',created:Date.now()},
  {id:'r8',name:'Node.js Security Review',desc:'Reviewing auth implementation.',type:'review',tags:['Node','JWT'],members:[],max:4,host:'sec_audit',created:Date.now()},
];

async function syncGetRooms() {
  try {
    const rec = await _jbRead(AT_SYNC_BINS.ROOMS);
    let rooms = (rec && rec.rooms) ? rec.rooms : null;
    if (!rooms || rooms.length === 0) {
      // Seed with defaults on first load
      await _jbWrite(AT_SYNC_BINS.ROOMS, { rooms: ROOMS_SEED });
      rooms = ROOMS_SEED;
    }
    // Prune expired custom rooms (older than 24h) but keep seeds
    const cutoff = Date.now() - 86400000;
    rooms = rooms.filter(r => !r.custom || r.created > cutoff);
    _cache.set('rooms', { rooms });
    return rooms;
  } catch {
    const cached = _cache.get('rooms');
    return cached ? cached.rooms : ROOMS_SEED;
  }
}

async function syncCreateRoom(room) {
  try {
    const rec = await _jbRead(AT_SYNC_BINS.ROOMS);
    const rooms = (rec && rec.rooms) ? rec.rooms : [...ROOMS_SEED];
    room.custom = true;
    room.created = Date.now();
    room.members = [];
    rooms.unshift(room);
    await _jbWrite(AT_SYNC_BINS.ROOMS, { rooms });
    _cache.set('rooms', { rooms });
    return rooms;
  } catch (e) {
    console.warn('[SYNC] createRoom failed:', e.message);
    const cached = _cache.get('rooms') || { rooms: [...ROOMS_SEED] };
    cached.rooms.unshift(room);
    _cache.set('rooms', cached);
    return cached.rooms;
  }
}

async function syncJoinRoom(roomId, userId) {
  try {
    const rec = await _jbRead(AT_SYNC_BINS.ROOMS);
    const rooms = (rec && rec.rooms) ? rec.rooms : [];
    const room = rooms.find(r => r.id === roomId);
    if (!room) return rooms;
    if (!Array.isArray(room.members)) room.members = [];
    // Clean stale members (joined > 2h ago and not active)
    const cutoff = Date.now() - 7200000;
    room.members = room.members.filter(m => m.joinedAt > cutoff);
    if (!room.members.find(m => m.userId === userId)) {
      room.members.push({ userId, joinedAt: Date.now() });
    }
    await _jbWrite(AT_SYNC_BINS.ROOMS, { rooms });
    _cache.set('rooms', { rooms });
    return rooms;
  } catch {
    return _cache.get('rooms')?.rooms || ROOMS_SEED;
  }
}

async function syncLeaveRoom(roomId, userId) {
  try {
    const rec = await _jbRead(AT_SYNC_BINS.ROOMS);
    const rooms = (rec && rec.rooms) ? rec.rooms : [];
    const room = rooms.find(r => r.id === roomId);
    if (room && Array.isArray(room.members)) {
      room.members = room.members.filter(m => m.userId !== userId);
      await _jbWrite(AT_SYNC_BINS.ROOMS, { rooms });
      _cache.set('rooms', { rooms });
    }
    return rooms;
  } catch { return []; }
}

function syncStartRooms(cb) {
  _roomsCB = cb;
  syncGetRooms().then(rooms => cb(rooms));
  _roomsPollTimer = setInterval(async () => {
    const rooms = await syncGetRooms();
    if (cb) cb(rooms);
  }, SYNC_CFG.ROOMS_POLL_MS);
}

function syncStopRooms() {
  if (_roomsPollTimer) { clearInterval(_roomsPollTimer); _roomsPollTimer = null; }
}

// ════════════════════════════════════════════════════════
//  PROJECTS SYNC
// ════════════════════════════════════════════════════════
const PROJECTS_SEED = [
  {id:'p1',name:'AfriPay Dashboard',owner:'tresfor_dev',desc:'Pan-African payment dashboard.',stack:['React','Supabase','Stripe'],stars:12,forks:3,status:'active',created:Date.now()},
  {id:'p2',name:'ZamWeather PWA',owner:'dev_zak',desc:'Weather PWA for Zambia.',stack:['Svelte','OpenWeather'],stars:8,forks:1,status:'active',created:Date.now()},
  {id:'p3',name:'AniBot Discord',owner:'code_nia',desc:'Anime Discord bot.',stack:['Node.js','Discord.js'],stars:24,forks:7,status:'showcase',created:Date.now()},
  {id:'p4',name:'EduTrack Mobile',owner:'mobile_lex',desc:'Education tracker app.',stack:['Flutter','Firebase'],stars:5,forks:2,status:'wip',created:Date.now()},
  {id:'p5',name:'DevPortfolio Gen',owner:'css_guru',desc:'AI portfolio generator.',stack:['Astro','Tailwind'],stars:31,forks:9,status:'active',created:Date.now()},
];

async function syncGetProjects() {
  try {
    const rec = await _jbRead(AT_SYNC_BINS.PROJECTS);
    let projects = (rec && rec.projects) ? rec.projects : null;
    if (!projects || projects.length === 0) {
      await _jbWrite(AT_SYNC_BINS.PROJECTS, { projects: PROJECTS_SEED });
      projects = PROJECTS_SEED;
    }
    _cache.set('projects', { projects });
    return projects;
  } catch {
    return _cache.get('projects')?.projects || PROJECTS_SEED;
  }
}

async function syncShareProject(project) {
  try {
    const rec = await _jbRead(AT_SYNC_BINS.PROJECTS);
    const projects = (rec && rec.projects) ? rec.projects : [...PROJECTS_SEED];
    project.id = 'p_' + Date.now().toString(36);
    project.created = Date.now();
    project.stars = 0; project.forks = 0;
    projects.unshift(project);
    if (projects.length > 50) projects.length = 50;
    await _jbWrite(AT_SYNC_BINS.PROJECTS, { projects });
    _cache.set('projects', { projects });
    return projects;
  } catch (e) {
    console.warn('[SYNC] shareProject failed:', e.message);
    const cached = _cache.get('projects') || { projects: [...PROJECTS_SEED] };
    cached.projects.unshift(project);
    _cache.set('projects', cached);
    return cached.projects;
  }
}

// ════════════════════════════════════════════════════════
//  ROOM CHAT SYNC (per-room messages in same chat bin with room prefix)
// ════════════════════════════════════════════════════════
async function syncSendRoomMsg(roomId, msg) {
  msg.roomId = roomId;
  msg.id = 'rm_' + roomId + '_' + Date.now().toString(36);
  await syncSendChat(msg); // uses same bin, filtered by roomId client-side
}

// ════════════════════════════════════════════════════════
//  ADMIN: BROADCAST
// ════════════════════════════════════════════════════════
async function syncBroadcast(fromName, text) {
  const msg = {
    id    : 'bc_' + Date.now().toString(36),
    name  : '📡 ' + fromName,
    text,
    color : '#ff8080',
    time  : new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
    ts    : Date.now(),
    isBroadcast: true,
  };
  return syncSendChat(msg);
}

// ════════════════════════════════════════════════════════
//  STATUS: Check if sync is configured
// ════════════════════════════════════════════════════════
function syncIsConfigured() {
  return !!_jbKey();
}

function syncShowConfigWarning(containerEl) {
  if (syncIsConfigured()) return;
  const div = document.createElement('div');
  div.style.cssText = 'font-family:Space Mono,monospace;font-size:10px;color:#f59e0b;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);border-radius:8px;padding:10px 14px;margin-bottom:14px;letter-spacing:1px;line-height:1.6;';
  div.innerHTML = '⚠ CHAT IS LOCAL ONLY — Add your JSONBin master key in <a href="profile.html" style="color:#00BFFF;text-decoration:none;">Admin Panel → JSONBin Key</a> to enable real-time sync across all users.';
  if (containerEl) containerEl.prepend(div);
}
