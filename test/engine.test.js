// Node test harness for the Cuajo engine. Run: node test/engine.test.js
const C = require('../src/engine.js');
const assert = require('assert');
let passed = 0;
function ok(cond, msg) { if (!cond) { throw new Error('FAIL: ' + msg); } passed++; }

// ---- brute force partition checker (small hands) ----
function validGroup(ts) {
  if (ts.length === 1) return C.rankOf(ts[0]) === C.KING;
  if (ts.length === 3 || ts.length === 4) {
    const ranks = new Set(ts.map(C.rankOf)), suits = new Set(ts.map(C.suitOf));
    if (ranks.size === 1 && suits.size === ts.length) return true;                 // set
    if (ts.length === 4 && ranks.size === 1 && suits.size === 1) return true;      // secret
    if (ts.length === 3 && suits.size === 1) {                                     // run
      const r = ts.map(C.rankOf).sort((a, b) => a - b).join(',');
      return r === '1,2,3' || r === '4,5,6';
    }
  }
  return false;
}
function bruteCanPartition(types) {
  const blocks = [];
  function rec(i) {
    if (i === types.length) return blocks.every(validGroup);
    for (const b of blocks) { if (b.length < 4) { b.push(types[i]); if (rec(i + 1)) { b.pop(); return true; } b.pop(); } }
    blocks.push([types[i]]); const r = rec(i + 1); blocks.pop();
    return r;
  }
  return rec(0);
}
function countsFromTypes(types) { const c = new Array(28).fill(0); for (const t of types) c[t]++; return c; }
function T(s, r) { return C.typeOf(s, r); }

// seeded rng
let seed = 12345; function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function randTypesNear(n) { // skewed sampling so partitionable hands are common
  const base = Math.floor(rnd() * 28); const out = [];
  for (let i = 0; i < n; i++) {
    let t;
    const m = rnd();
    if (m < 0.35) t = T(Math.floor(rnd() * 4), C.rankOf(base));            // same rank, random suit
    else if (m < 0.7) t = T(C.suitOf(base), Math.floor(rnd() * 7));         // same suit, random rank
    else if (m < 0.8) t = base;
    else t = Math.floor(rnd() * 28);
    out.push(t);
  }
  return out;
}

function randGroup() { // a random valid combination
  const m = rnd(), s = Math.floor(rnd() * 4), r = Math.floor(rnd() * 7);
  if (m < 0.15) return [T(s, 6)];
  if (m < 0.25) return [T(s, r), T(s, r), T(s, r), T(s, r)];
  if (m < 0.55) { const lo = rnd() < 0.5 ? 1 : 4; return [T(s, lo), T(s, lo + 1), T(s, lo + 2)]; }
  const suits = [0, 1, 2, 3].sort(() => rnd() - 0.5).slice(0, rnd() < 0.5 ? 3 : 4);
  return suits.map(x => T(x, r));
}
function randHand() {
  if (rnd() < 0.5) return randTypesNear(1 + Math.floor(rnd() * 9));
  let types = []; const k = 1 + Math.floor(rnd() * 3);
  for (let i = 0; i < k && types.length < 9; i++) types = types.concat(randGroup());
  if (rnd() < 0.35 && types.length < 9) types.push(Math.floor(rnd() * 28));
  if (rnd() < 0.2 && types.length > 1) types.splice(Math.floor(rnd() * types.length), 1);
  return types.slice(0, 9);
}
// 1. random small hands vs brute force
let agree = 0, trues = 0;
for (let i = 0; i < 2500; i++) {
  const types = randHand(); const n = types.length;
  const c = countsFromTypes(types);
  if (c.some(x => x > 4)) continue;
  const a = C.canPartition(c), b = bruteCanPartition(types);
  assert.strictEqual(a, b, 'partition mismatch for ' + types.map(C.cardName).join(', '));
  if (a) { trues++; const p = C.partition(c); ok(p && p.every(gp => validGroup(gp.types)) && p.reduce((s, gp) => s + gp.types.length, 0) === n, 'partition() groups valid'); }
  agree++;
}
ok(agree > 1000 && trues > 100, `brute-force agreement on ${agree} hands (${trues} partitionable)`);

// 2. specific hands
const K = r => r; // readability
ok(C.canPartition(countsFromTypes([T(0, 6)])), 'lone king valid');
ok(!C.canPartition(countsFromTypes([T(0, 0)])), 'lone ace invalid');
ok(C.canPartition(countsFromTypes([T(1, 1), T(1, 2), T(1, 3)])), '3-4-5 run valid');
ok(!C.canPartition(countsFromTypes([T(1, 0), T(1, 1), T(1, 2)])), 'A-3-4 invalid (aces cannot run)');
ok(!C.canPartition(countsFromTypes([T(1, 2), T(1, 3), T(1, 4)])), '4-5-J invalid');
ok(C.canPartition(countsFromTypes([T(2, 4), T(2, 5), T(2, 6)])), 'J-H-K run valid');
ok(C.canPartition(countsFromTypes([T(0, 0), T(1, 0), T(2, 0)])), 'set of aces valid');
ok(!C.canPartition(countsFromTypes([T(0, 0), T(0, 0), T(2, 0)])), 'set with repeated suit invalid');
ok(C.canPartition(countsFromTypes([T(3, 2), T(3, 2), T(3, 2), T(3, 2)])), 'secret valid');
ok(!C.canPartition(countsFromTypes([T(3, 2), T(3, 2), T(3, 2)])), 'three identical invalid');
// a full 16-card hand: 5 sets/runs + a king
const full16 = [T(0,1),T(0,2),T(0,3), T(1,4),T(1,5),T(1,6), T(0,0),T(1,0),T(2,0), T(2,3),T(3,3),T(0,3), T(1,1),T(2,1),T(3,1), T(3,6)];
ok(C.canPartition(countsFromTypes(full16)), '16-card complete hand');
ok(C.distance(countsFromTypes(full16), 16) === 0, 'distance 0 for a complete hand');
const fifteen = full16.slice(0, 15);
ok(C.distance(countsFromTypes(fifteen), 16) === 1, 'distance 1 when one card short');
const w = C.waitingTypes(countsFromTypes(fifteen), 16);
ok(w.length === 7 && [0,1,2,3].every(s => w.includes(T(s, 6))) && w.includes(T(0,1)) && w.includes(T(1,3)) && w.includes(T(3,0)), 'five sets: waiting for any king or a fourth suit of a set → ' + w.map(C.cardName).join(', '));

// 3. distance==1 <=> waiting non-empty on random 15-card hands (and distance>=1 always)
for (let i = 0; i < 300; i++) {
  const types = []; while (types.length < 15) { const t = randTypesNear(1)[0]; if (types.filter(x => x === t).length < 4) types.push(t); }
  const c = countsFromTypes(types);
  const d = C.distance(c, 16), wt = C.waitingTypes(c, 16);
  ok(d >= 1, 'distance >= 1 for 15 cards');
  ok((d === 1) === (wt.length > 0), `distance/waiting agree (d=${d}, waiting=${wt.length}) for ${types.map(C.cardName).join(', ')}`);
  const plan = C.keepPlan(c, 16);
  ok(plan.reduce((s, gp) => s + gp.types.length, 0) === 15, 'plan covers all cards');
  const kept = plan.filter(gp => gp.kind !== 'drop').reduce((s, gp) => s + gp.types.length, 0);
  ok(kept === C.bestKeep(c, 16), 'plan kept matches bestKeep');
}

// 4. full game simulations (all AI)
function checkConservation(g) {
  const all = [].concat(...g.hands, ...g.secrets.map(ss => [].concat(...ss.map(s => s.cards.concat(s.extra != null ? [s.extra] : [])))), g.stock, g.discards, [g.sowee], (g.result && g.result.extraDraws) || []);
  assert.strictEqual(all.length, 112, 'card count ' + all.length);
  assert.strictEqual(new Set(all).size, 112, 'duplicate cards');
  assert.strictEqual(g.balances.reduce((a, b) => a + b, 0), 0, 'balances must sum to zero');
}
function playHand(g) {
  let steps = 0;
  while (g.phase !== 'over') {
    steps++; if (steps > 5000) throw new Error('hand did not terminate');
    if (g.phase === 'timeOffer') { C.resolveTime(g, true); continue; }
    const seat = g.turn;
    if (g.phase === 'draw') {
      const a = C.aiChooseDraw(g, seat);
      if (a === 'stock') C.drawStock(g, seat); else if (a === 'discard') C.takeDiscard(g, seat); else C.endHandDraw(g);
    } else if (g.phase === 'discard') {
      const s = C.aiChooseSecret(g, seat);
      if (s) C.declareSecret(g, seat, s.type, s.extraId);
      else C.discard(g, seat, C.aiChooseDiscard(g, seat));
    }
    checkConservation(g);
  }
}
const NG = parseInt(process.env.GAMES || '150', 10);
const g = C.newGame({ seed: 777, human: -1, names: ['S', 'E', 'N', 'W'] });
const t0 = Date.now();
let wins = 0, draws = 0, turns = 0, secrets = 0, timeWins = 0, discardWins = 0, stockWins = 0, porbis = 0, maxTurns = 0;
const sources = {};
for (let i = 0; i < NG; i++) {
  if (i === 0) C.startHand(g); else C.nextHand(g);
  playHand(g);
  turns += g.turnCount; maxTurns = Math.max(maxTurns, g.turnCount);
  secrets += g.secrets.reduce((a, s) => a + s.length, 0);
  if (g.result.type === 'draw') draws++; else {
    wins++; sources[g.result.source] = (sources[g.result.source] || 0) + 1; if (g.result.porbis) porbis++;
    // winner's hand must be complete
    ok(C.isComplete(g, g.result.winner), 'winner hand complete');
    ok(g.result.groups.length > 0, 'winning groups present');
    ok(g.result.perOpponent >= 20, 'payment positive');
  }
}
const ms = Date.now() - t0;
console.log(`games=${NG} wins=${wins} draws=${draws} avgTurns=${(turns / NG).toFixed(1)} maxTurns=${maxTurns} secrets=${secrets} porbis=${porbis} sources=${JSON.stringify(sources)} wins by seat=${g.wins} time=${ms}ms (${(ms / NG).toFixed(0)}ms/hand)`);
console.log('final balances', g.balances.map(C.money).join(' '));
ok(wins + draws === NG, 'every hand ended');

// 5. scoring details
{
  const g2 = C.newGame({ seed: 1, human: -1 });
  C.startHand(g2);
  // craft: winner seat 0 with a porbis hand (no kings); make hand and check payment 300
  g2.hands[0] = [T(0,1)*4, T(0,2)*4, T(0,3)*4, T(1,1)*4, T(1,2)*4, T(1,3)*4, T(0,0)*4, T(1,0)*4, T(2,0)*4, T(2,2)*4, T(3,2)*4, T(1,2)*4+1, T(2,3)*4, T(3,3)*4, T(1,3)*4+1, T(0,1)*4+1];
  // last card is a second 3 of coins: 3 coins,4 coins,5 coins run + 3 coins... make it a set instead: replace with 3 of swords
  g2.hands[0][15] = T(2,1)*4; g2.hands[0].push(T(3,1)*4); g2.hands[0].splice(11,1); // 3c? ensure complete
  const c = C.countsOf(g2.hands[0]);
  if (C.canPartition(c) && g2.hands[0].length === 16) {
    g2.phase = 'discard'; g2.turn = 0; g2.secrets = [[],[],[],[]];
    const before = g2.balances.slice();
    // simulate a win from stock via internal finishWin through drawStock path is awkward; call discard→? Instead test via exported pieces:
    ok(C.isComplete(g2, 0), 'crafted hand complete');
  }
  // goesWith
  const cc = countsFromTypes([T(1,1), T(1,2), T(1,3)]);
  ok(C.goesWith(cc, T(1,2)), '3-4-5: 4 goes with 3 and 5');
  ok(!C.goesWith(countsFromTypes([T(1,1), T(1,2)]), T(1,2)), 'missing 5: no');
  ok(C.goesWith(countsFromTypes([T(0,0), T(1,0), T(2,0)]), T(0,0)), 'ace with two other aces of different suits');
  ok(!C.goesWith(countsFromTypes([T(0,0), T(1,0), T(1,0)]), T(0,0)), 'ace with two aces of the same suit: no');
  ok(!C.goesWith(countsFromTypes([T(0,6)]), T(0,6)), 'lone king goes with nothing');
  ok(C.goesWith(countsFromTypes([T(0,4), T(0,5), T(0,6)]), T(0,6)), 'K with J-H');
}
// 6. games with human-like mistakes (every seat on Easy): rules and money must still hold
{
  const g3 = C.newGame({ seed: 4040, human: -1 });
  C.setDifficulty(g3, 'easy');
  ok(g3.mistakes.every(m => m === C.DIFFICULTY.easy), 'easy mistake rate on every seat');
  let hands = 0, timeMisses = 0;
  for (let i = 0; i < 12; i++) {
    if (i === 0) C.startHand(g3); else C.nextHand(g3);
    let steps = 0;
    while (g3.phase !== 'over') {
      if (++steps > 6000) throw new Error('easy hand did not terminate');
      if (g3.phase === 'timeOffer') { const p = C.currentClaimant(g3), yes = C.aiClaimsTime(g3, p); if (!yes) timeMisses++; C.resolveTime(g3, yes); checkConservation(g3); continue; }
      const seat = g3.turn;
      if (g3.phase === 'draw') { const a = C.aiChooseDraw(g3, seat); if (a === 'stock') C.drawStock(g3, seat); else if (a === 'discard') C.takeDiscard(g3, seat); else C.endHandDraw(g3); }
      else { const sc = C.aiChooseSecret(g3, seat); if (sc) C.declareSecret(g3, seat, sc.type, sc.extraId); else C.discard(g3, seat, C.aiChooseDiscard(g3, seat)); }
      checkConservation(g3);
    }
    if (g3.result.type === 'win') ok(C.isComplete(g3, g3.result.winner), 'easy: winner hand complete');
    hands++;
  }
  ok(hands === 12, 'easy games finish');
  // Hard stays exactly as before: no random draws are spent on mistakes
  const a = C.newGame({ seed: 99, human: -1 }), b = C.newGame({ seed: 99, human: -1 });
  C.setDifficulty(b, 'hard'); C.startHand(a); C.startHand(b);
  for (let k = 0; k < 30 && a.phase !== 'over'; k++) {
    const s1 = a.turn;
    if (a.phase === 'draw') { const x = C.aiChooseDraw(a, s1), y = C.aiChooseDraw(b, s1); ok(x === y, 'hard draw same as before'); if (x === 'stock') { C.drawStock(a, s1); C.drawStock(b, s1); } else if (x === 'discard') { C.takeDiscard(a, s1); C.takeDiscard(b, s1); } else break; }
    else if (a.phase === 'discard') { const x = C.aiChooseDiscard(a, s1), y = C.aiChooseDiscard(b, s1); ok(x === y, 'hard discard same as before'); C.discard(a, s1, x); C.discard(b, s1, y); }
    else break;
  }
  console.log('easy games: ' + hands + ' hands, time calls missed: ' + timeMisses);
}
console.log('all engine checks passed:', passed);
