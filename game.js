'use strict';
// Luật chơi cờ cá ngựa (Ludo) — chạy trên server, server quyết định mọi thứ.
const crypto = require('crypto');

const COLORS = ['red', 'green', 'yellow', 'blue']; // thứ tự theo chiều kim đồng hồ
const START = { red: 0, green: 13, yellow: 26, blue: 39 }; // ô xuất phát trên đường chung (52 ô)
const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]); // ô an toàn: không bị đá
const LAST_TRACK = 50; // bước cuối trên đường chung, sau đó vào chuồng
const FINISH = 56; // 51..55 = 5 bậc chuồng, 56 = về đích

// Vị trí quân: -1 = trong nhà, 0..50 = trên đường chung (tính từ ô xuất phát), 51..56 = chuồng/đích
function absPos(color, p) {
  return p >= 0 && p <= LAST_TRACK ? (START[color] + p) % 52 : null;
}

function createGame(colors, names) {
  const pieces = {};
  for (const c of colors) pieces[c] = [-1, -1, -1, -1];
  return {
    id: crypto.randomBytes(4).toString('hex'), colors: colors.slice(), rollColor: null, names: { ...names }, turn: 0, phase: 'roll',
    dice: null, rollSeq: 0, moveSeq: 0, sixes: 0, pieces, moves: null,
    ranking: [], lastMove: null,
  };
}

const current = (g) => g.colors[g.turn];

function legalMoves(g, color, d) {
  const res = [];
  g.pieces[color].forEach((p, i) => {
    let to;
    if (p === -1) { if (d !== 6) return; to = 0; } // phải gieo 6 mới ra quân
    else if (p === FINISH) return;
    else { to = p + d; if (to > FINISH) return; } // về đích phải đúng số
    res.push({ piece: i, from: p, to });
  });
  return res;
}

function wouldCapture(g, color, to) {
  const a = absPos(color, to);
  if (a === null || SAFE.has(a)) return false;
  return g.colors.some((c) => c !== color && g.pieces[c].some((p) => absPos(c, p) === a));
}

// Máy tự chọn nước đi (dùng cho máy chơi và khi người chơi hết giờ / rớt mạng)
function pickMove(g) {
  const color = current(g);
  let best = null, bestScore = -Infinity;
  for (const m of g.moves) {
    let s = m.to;
    if (wouldCapture(g, color, m.to)) s += 100;
    if (m.to === FINISH) s += 80;
    if (m.from === -1) s += 60;
    if (m.from <= LAST_TRACK && m.to > LAST_TRACK) s += 40;
    s += Math.random();
    if (s > bestScore) { bestScore = s; best = m; }
  }
  return best.piece;
}

function advance(g) {
  g.sixes = 0;
  const active = g.colors.filter((c) => !g.ranking.includes(c));
  if (active.length <= 1) {
    if (active.length === 1) g.ranking.push(active[0]);
    g.phase = 'over';
    return;
  }
  do g.turn = (g.turn + 1) % g.colors.length; while (g.ranking.includes(current(g)));
  g.phase = 'roll';
}

function roll(g, forced) {
  if (g.phase !== 'roll') throw new Error('Chưa đến lúc gieo');
  const color = current(g);
  const d = forced || crypto.randomInt(1, 7);
  g.dice = d; g.rollSeq++; g.rollColor = color;
  g.sixes = d === 6 ? g.sixes + 1 : 0;
  if (g.sixes === 3) { advance(g); return { type: 'three-sixes', dice: d }; }
  const moves = legalMoves(g, color, d);
  if (!moves.length) {
    if (d !== 6) advance(g);
    return { type: 'no-move', dice: d };
  }
  g.phase = 'move'; g.moves = moves;
  // Chỉ có một lựa chọn thực sự → tự đi luôn
  if (new Set(moves.map((m) => m.from)).size === 1) {
    return { ...move(g, moves[0].piece), dice: d, auto: true };
  }
  return { type: 'choose', dice: d };
}

function move(g, piece) {
  if (g.phase !== 'move') throw new Error('Chưa đến lúc đi quân');
  const color = current(g);
  const m = g.moves.find((x) => x.piece === piece);
  if (!m) throw new Error('Quân này không đi được');
  g.pieces[color][piece] = m.to;
  const captured = [];
  const a = absPos(color, m.to);
  if (a !== null && !SAFE.has(a)) {
    for (const c of g.colors) {
      if (c === color) continue;
      g.pieces[c].forEach((p, i) => {
        if (absPos(c, p) === a) { g.pieces[c][i] = -1; captured.push({ color: c, piece: i, from: p }); }
      });
    }
  }
  g.moveSeq++;
  g.lastMove = { color, piece, from: m.from, to: m.to, captured, seq: g.moveSeq };
  g.moves = null;
  const done = g.pieces[color].every((p) => p === FINISH);
  if (done) g.ranking.push(color);
  // Được gieo thêm khi: gieo 6, đá được quân, hoặc đưa quân về đích
  const bonus = !done && (g.dice === 6 || captured.length > 0 || m.to === FINISH);
  if (bonus) g.phase = 'roll'; else advance(g);
  return { type: 'moved', color, from: m.from, to: m.to, captured, done, bonus };
}

module.exports = { COLORS, START, SAFE, FINISH, LAST_TRACK, absPos, createGame, current, legalMoves, pickMove, roll, move };
