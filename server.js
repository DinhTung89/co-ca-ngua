'use strict';
// Server cờ cá ngựa online — chỉ dùng thư viện có sẵn của Node.js (không cần npm install).
// Realtime: Server-Sent Events (server → trình duyệt) + fetch POST (trình duyệt → server).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const G = require('./game');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const TURN_MS = 30000; // thời gian mỗi lượt
const AWAY_MS = 4000;  // người chơi rớt mạng → máy đi thay sau 4 giây
const BOT_MS = Number(process.env.BOT_MS) || 900;    // tốc độ máy chơi
const COLOR_VN = { red: 'Đỏ', green: 'Xanh lá', yellow: 'Vàng', blue: 'Xanh dương' };

const rooms = new Map();

const newCode = () => {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s;
  do s = Array.from({ length: 5 }, () => A[crypto.randomInt(A.length)]).join(''); while (rooms.has(s));
  return s;
};
const cleanName = (n) => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 20) || 'Người chơi';
const httpError = (status, msg) => Object.assign(new Error(msg), { status });

function addMember(r, name, bot = false) {
  const taken = new Set(r.members.map((m) => m.color));
  const color = r.game ? null : G.COLORS.find((c) => !taken.has(c)) || null;
  const m = { pid: crypto.randomBytes(16).toString('hex'), uid: crypto.randomBytes(4).toString('hex'), name, color, conns: 0, bot };
  r.members.push(m);
  return m;
}

function getRoom(code) {
  const r = rooms.get(String(code || '').toUpperCase());
  if (!r) throw httpError(404, 'Không tìm thấy phòng');
  return r;
}
function auth(b) {
  const r = getRoom(b.room);
  const m = r.members.find((x) => x.pid === b.pid);
  if (!m) throw httpError(403, 'Bạn không ở trong phòng này');
  return { r, m };
}
const isHost = (r, m) => r.hostUid === m.uid;
function needHost(r, m) { if (!isHost(r, m)) throw httpError(403, 'Chỉ chủ phòng mới làm được'); }

function addLog(r, text) { r.log.push({ t: Date.now(), text }); if (r.log.length > 60) r.log.shift(); }

function publicState(r) {
  const g = r.game;
  return {
    code: r.code, hostUid: r.hostUid,
    members: r.members.map((m) => ({ uid: m.uid, name: m.name, color: m.color, online: m.bot || m.conns > 0, bot: m.bot })),
    game: g && { ...g, moves: g.moves && g.moves.map((x) => x.piece), timeLeft: r.deadline ? Math.max(0, r.deadline - Date.now()) : null },
    log: r.log.slice(-30), chat: r.chat.slice(-40),
  };
}

function broadcast(r) {
  const data = `data: ${JSON.stringify(publicState(r))}\n\n`;
  for (const c of r.clients) c.res.write(data);
}

function memberOfColor(r, color) { return r.members.find((m) => m.color === color); }

function logResult(r, color, res, auto) {
  const g = r.game, name = g.names[color];
  addLog(r, `${name} gieo được ${res.dice}${auto ? ' (tự động)' : ''}`);
  if (res.type === 'three-sixes') addLog(r, `${name} gieo 6 ba lần liền — mất lượt`);
  if (res.type === 'no-move') addLog(r, `${name} không có nước đi${res.dice === 6 ? ', được gieo lại' : ''}`);
  if (res.type === 'moved') logMove(r, res);
}
function logMove(r, res) {
  const g = r.game, name = g.names[res.color];
  if (res.from === -1) addLog(r, `${name} ra quân`);
  for (const c of res.captured) addLog(r, `💥 ${name} đá quân của ${g.names[c.color]}!`);
  if (res.to === G.FINISH) addLog(r, `🏠 ${name} đưa 1 quân về đích`);
  if (res.done) addLog(r, `🏆 ${name} về đích hết — hạng ${g.ranking.length}`);
  if (res.bonus) addLog(r, `${name} được gieo thêm lượt`);
  if (g.phase === 'over') addLog(r, `Ván đấu kết thúc! Người thắng: ${g.names[g.ranking[0]]}`);
}

function doRoll(r, auto) {
  const g = r.game, color = G.current(g);
  const res = G.roll(g);
  logResult(r, color, res, auto);
}
function doMove(r, piece, auto) {
  const res = G.move(r.game, piece);
  if (auto) addLog(r, `${r.game.names[res.color]} hết giờ — máy đi thay`);
  logMove(r, res);
}

// Hẹn giờ cho lượt hiện tại: máy chơi, người rớt mạng, hoặc hết 30 giây
function schedule(r) {
  clearTimeout(r.timer);
  r.deadline = null;
  const g = r.game;
  if (!g || g.phase === 'over') return;
  const m = memberOfColor(r, G.current(g));
  const ms = m && m.bot ? BOT_MS : m && m.conns > 0 ? TURN_MS : AWAY_MS;
  if (!(m && m.bot)) r.deadline = Date.now() + ms;
  r.timer = setTimeout(() => {
    try {
      if (r.game !== g || g.phase === 'over') return;
      const quiet = m && m.bot;
      if (g.phase === 'roll') doRoll(r, !quiet);
      else if (g.phase === 'move') doMove(r, G.pickMove(g), !quiet);
    } catch (e) { console.error(e); }
    after(r);
  }, ms);
}
function after(r) { r.lastActive = Date.now(); schedule(r); broadcast(r); }

const api = {
  create(b) {
    const r = { code: newCode(), members: [], clients: new Set(), chat: [], log: [], game: null, hostUid: null, timer: null, deadline: null, lastActive: Date.now() };
    rooms.set(r.code, r);
    const m = addMember(r, cleanName(b.name));
    r.hostUid = m.uid;
    return { room: r.code, pid: m.pid, uid: m.uid };
  },
  join(b) {
    const r = getRoom(b.room);
    if (r.members.length >= 12) throw httpError(400, 'Phòng đã quá đông');
    const m = addMember(r, cleanName(b.name));
    addLog(r, `${m.name} vào phòng${m.color ? '' : ' (xem)'}`);
    after(r);
    return { room: r.code, pid: m.pid, uid: m.uid };
  },
  hello(b) { const { r, m } = auth(b); return { room: r.code, uid: m.uid }; },
  color(b) {
    const { r, m } = auth(b);
    if (r.game) throw httpError(400, 'Ván đã bắt đầu');
    if (b.color !== null && !G.COLORS.includes(b.color)) throw httpError(400, 'Màu không hợp lệ');
    if (b.color && r.members.some((x) => x.color === b.color)) throw httpError(400, 'Màu này đã có người chọn');
    m.color = b.color; after(r); return {};
  },
  addBot(b) {
    const { r, m } = auth(b); needHost(r, m);
    if (r.game) throw httpError(400, 'Ván đã bắt đầu');
    if (r.members.filter((x) => x.color).length >= 4) throw httpError(400, 'Đã đủ 4 người chơi');
    const n = r.members.filter((x) => x.bot).length + 1;
    addMember(r, `Máy ${n}`, true); after(r); return {};
  },
  kick(b) {
    const { r, m } = auth(b); needHost(r, m);
    if (r.game) throw httpError(400, 'Ván đã bắt đầu');
    const t = r.members.find((x) => x.uid === b.uid);
    if (!t || t === m) throw httpError(400, 'Không thể mời ra');
    r.members = r.members.filter((x) => x !== t);
    for (const c of [...r.clients]) if (c.m === t) { c.res.end(); r.clients.delete(c); }
    after(r); return {};
  },
  leave(b) {
    const { r, m } = auth(b);
    r.members = r.members.filter((x) => x !== m);
    for (const c of [...r.clients]) if (c.m === m) { c.res.end(); r.clients.delete(c); }
    addLog(r, `${m.name} rời phòng${r.game && m.color ? ' — máy chơi thay' : ''}`);
    if (isHost(r, m)) { const h = r.members.find((x) => !x.bot); r.hostUid = h ? h.uid : null; }
    if (!r.members.some((x) => !x.bot)) { clearTimeout(r.timer); rooms.delete(r.code); return {}; }
    after(r); return {};
  },
  start(b) {
    const { r, m } = auth(b); needHost(r, m);
    if (r.game && r.game.phase !== 'over') throw httpError(400, 'Ván đang diễn ra');
    const players = r.members.filter((x) => x.color);
    if (players.length < 2) throw httpError(400, 'Cần ít nhất 2 người chơi (có thể thêm máy)');
    const colors = G.COLORS.filter((c) => players.some((p) => p.color === c));
    const names = Object.fromEntries(players.map((p) => [p.color, p.name]));
    r.game = G.createGame(colors, names);
    r.log = [];
    addLog(r, `Ván mới bắt đầu! ${names[colors[0]]} đi trước.`);
    after(r); return {};
  },
  lobby(b) {
    const { r, m } = auth(b); needHost(r, m);
    clearTimeout(r.timer); r.game = null; r.deadline = null;
    const taken = new Set();
    for (const x of r.members) { if (x.color && !taken.has(x.color)) taken.add(x.color); else x.color = null; }
    after(r); return {};
  },
  roll(b) {
    const { r, m } = auth(b);
    if (!r.game || !m.color || G.current(r.game) !== m.color) throw httpError(400, 'Chưa đến lượt bạn');
    doRoll(r, false); after(r); return {};
  },
  move(b) {
    const { r, m } = auth(b);
    if (!r.game || !m.color || G.current(r.game) !== m.color) throw httpError(400, 'Chưa đến lượt bạn');
    doMove(r, Number(b.piece), false); after(r); return {};
  },
  chat(b) {
    const { r, m } = auth(b);
    const text = String(b.text || '').trim().slice(0, 200);
    if (!text) return {};
    if (Date.now() - (m.lastChat || 0) < 500) throw httpError(429, 'Gửi chậm lại một chút');
    m.lastChat = Date.now();
    r.chat.push({ name: m.name, color: m.color, text, t: Date.now() });
    if (r.chat.length > 80) r.chat.shift();
    broadcast(r); return {};
  },
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 10000) { reject(httpError(413, 'Quá lớn')); req.destroy(); } });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { reject(httpError(400, 'JSON lỗi')); } });
    req.on('error', reject);
  });
}

function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

function serveStatic(req, res, pathname) {
  const file = path.normalize(path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'Cấm' });
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, { error: 'Không có' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

function events(req, res, q) {
  let r, m;
  try { ({ r, m } = auth({ room: q.get('room'), pid: q.get('pid') })); } catch (e) { return send(res, e.status || 400, { error: e.message }); }
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 2000\n\n');
  const client = { res, m };
  r.clients.add(client);
  m.conns++;
  const wasAway = r.game && G.current(r.game) === m.color && m.conns === 1;
  if (wasAway) schedule(r);
  broadcast(r);
  req.on('close', () => {
    r.clients.delete(client);
    m.conns = Math.max(0, m.conns - 1);
    if (r.game && m.color && G.current(r.game) === m.color && m.conns === 0) schedule(r);
    broadcast(r);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && url.pathname === '/events') return events(req, res, url.searchParams);
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, rooms: rooms.size });
    if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
      const fn = api[url.pathname.slice(5)];
      if (!fn) throw httpError(404, 'Không có API này');
      return send(res, 200, fn(await readBody(req)));
    }
    if (req.method === 'GET') return serveStatic(req, res, url.pathname);
    send(res, 405, { error: 'Không hỗ trợ' });
  } catch (e) {
    if (!e.status) console.error(e);
    send(res, e.status || 400, { error: e.message });
  }
});

// Giữ kết nối SSE sống (proxy của Render cắt kết nối im lặng quá lâu)
setInterval(() => { for (const r of rooms.values()) for (const c of r.clients) c.res.write(': ping\n\n'); }, 20000);
// Dọn phòng bỏ trống quá 2 giờ
setInterval(() => {
  const now = Date.now();
  for (const r of rooms.values()) if (r.clients.size === 0 && now - r.lastActive > 2 * 3600e3) { clearTimeout(r.timer); rooms.delete(r.code); }
}, 600e3);

server.listen(PORT, () => console.log(`Cờ cá ngựa đang chạy tại http://localhost:${PORT}`));
