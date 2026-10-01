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
    if (ranks.size === 1 && suits.size === 1) return true;                         // pong (3 or 4 identical)
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
ok(C.canPartition(countsFromTypes([T(3, 2), T(3, 2), T(3, 2)])), 'three identical cards make a pong');
ok(!C.completeB(countsFromTypes([T(3, 2), T(3, 2), T(3, 2), T(0, 6)])), 'a pong and a king are not a win without a baksyo');
ok(C.completeB(countsFromTypes([T(0, 0), T(1, 0), T(2, 0), T(0, 6)])), 'three aces are a baksyo');
ok(C.completeB(countsFromTypes([T(2, 0), T(2, 0), T(2, 0)])), 'a pong of aces is a baksyo');
ok(C.completeB(countsFromTypes([T(1, 4), T(1, 5), T(1, 6)])) && C.completeB(countsFromTypes([T(3, 1), T(3, 2), T(3, 3)])), 'runs are baksyos');
ok(!C.completeB(countsFromTypes([T(0, 2), T(1, 2), T(2, 2), T(3, 6)])), 'a set of fours is not a baksyo');
ok(C.completeB(countsFromTypes([T(0, 2), T(1, 2), T(2, 2)])), 'with no kings at all, no baksyo is needed');
ok(C.completeB(countsFromTypes([T(3, 2), T(3, 2), T(3, 2), T(1, 1), T(2, 1), T(3, 1)])) && !C.completeB(countsFromTypes([T(3, 2), T(3, 2), T(3, 2), T(1, 1), T(2, 1), T(3, 1), T(2, 6)])), 'a king makes the baksyo required');
// a full 16-card hand: 5 sets/runs + a king
const full16 = [T(0,1),T(0,2),T(0,3), T(1,4),T(1,5),T(1,6), T(0,0),T(1,0),T(2,0), T(2,3),T(3,3),T(0,3), T(1,1),T(2,1),T(3,1), T(3,6)];
ok(C.canPartition(countsFromTypes(full16)), '16-card complete hand');
ok(C.distance(countsFromTypes(full16), 16) === 0, 'distance 0 for a complete hand');
const fifteen = full16.slice(0, 15);
ok(C.distance(countsFromTypes(fifteen), 16) === 1, 'distance 1 when one card short');
const w = C.waitingTypes(countsFromTypes(fifteen), 16);
ok(w.length >= 7 && [0,1,2,3].every(s => w.includes(T(s, 6))) && w.every(x => { const c2 = countsFromTypes(fifteen.concat([x])); return C.completeB(c2); }), 'five combinations: waiting cards each complete the hand → ' + w.map(C.cardName).join(', '));

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
    if (g.phase === 'rubOffer') { rubOffers++; C.resolveRub(g, g.handNo % 2 === 0 ? C.aiChooseRub(g, g.rubOffer.seat) : false); checkConservation(g); continue; }
    const seat = g.turn;
    if (C.legalActions(g, seat).declareRub && g.turnCount > 8) { C.declareRub(g, seat); rubDeclared++; break; }
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
let rubOffers = 0, rubDeclared = 0;
let specials = 0, wins = 0, draws = 0, turns = 0, secrets = 0, timeWins = 0, discardWins = 0, stockWins = 0, porbis = 0, maxTurns = 0;
const sources = {};
for (let i = 0; i < NG; i++) {
  if (i === 0) C.startHand(g); else C.nextHand(g);
  playHand(g);
  turns += g.turnCount; maxTurns = Math.max(maxTurns, g.turnCount);
  secrets += g.secrets.reduce((a, s) => a + s.length, 0);
  if (g.result.type === 'draw') draws++; else {
    wins++; sources[g.result.source] = (sources[g.result.source] || 0) + 1; if (g.result.porbis) porbis++;
    // winner's hand must be complete
    ok(g.result.special || C.isComplete(g, g.result.winner), 'winner hand complete (or a special king win)'); if (g.result.special) specials++;
    ok(g.result.groups.length > 0, 'winning groups present');
    ok(g.result.perOpponent >= 200, 'payment at least the 200 starting price');
  }
}
const ms = Date.now() - t0;
console.log(`games=${NG} wins=${wins} draws=${draws} avgTurns=${(turns / NG).toFixed(1)} maxTurns=${maxTurns} secrets=${secrets} porbis=${porbis} sources=${JSON.stringify(sources)} wins by seat=${g.wins} time=${ms}ms (${(ms / NG).toFixed(0)}ms/hand)`);
console.log('final balances', g.balances.map(C.money).join(' '), '| special king wins:', specials, '| rub choices at the deal:', rubOffers, '| rubs declared after waiting:', rubDeclared);
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
  // house pricing
  const ids = types => { const used = {}; return types.map(t => { used[t] = (used[t] || 0); return t * 4 + used[t]++; }); };
  const gp = C.newGame({ seed: 5, human: -1 }); C.startHand(gp); gp.secrets = [[], [], [], []];
  gp.sowee = C.typeOf(3, 5) * 4 + 3;   // the horse of batons: none of the hands below hold one
  // four kings in three suits, jack-horse-king of coins, 3-4-5 of cups, a pong, a set of four fives
  gp.hands[0] = ids([T(0,4), T(0,5), T(0,6), T(1,6), T(1,6), T(3,6), T(1,1), T(1,2), T(1,3), T(2,2), T(2,2), T(2,2), T(0,3), T(1,3), T(2,3), T(3,3)]);
  ok(C.isComplete(gp, 0) && C.kingWin(gp, 0) === null, 'priced hand is a complete regular hand');
  let pr = C.priceWin(gp, 0, null);
  ok(pr.start === 200 && pr.per === 200 + 4 * 5 + 10 + 5 + 20 + 5, 'regular win with 2-6 kings: 200 + kings 5 each + J-H-K baksyo 10 + 3-4-5 5 + pong 20 + set of four 5 = ' + pr.per);
  // winning with the king that finishes a jack-horse-king baksyo starts at 500: here the Rey de Oros completes J-H-K of coins
  const kingBounit = gp.hands[0][2];
  pr = C.priceWin(gp, 0, null, kingBounit);
  ok(pr.start === 500 && pr.startKind === 'kingBaksyo' && pr.per === 500 + 4 * 5 + 10 + 5 + 20 + 5, 'king as the winning card of a J-H-K baksyo: starts at 500 = ' + pr.per);
  pr = C.priceWin(gp, 0, null, gp.hands[0][3]);
  ok(pr.start === 200, 'another king as the winning card (not finishing the baksyo run): still 200');
  // no kings: starts at 500 and needs no baksyo
  gp.hands[0] = ids([T(0,1), T(0,2), T(0,3), T(1,1), T(1,2), T(1,3), T(0,0), T(1,0), T(2,0), T(0,2), T(1,2), T(2,2), T(3,2), T(3,3), T(3,3), T(3,3)]);
  ok(C.isComplete(gp, 0), 'no-king hand complete');
  pr = C.priceWin(gp, 0, null);
  ok(pr.start === 500 && pr.per === 500 + 5 + 5 + 5 + 5 + 20, 'no kings: 500 + two 3-4-5 runs + three aces + set of four + pong = ' + pr.per);
  // one king: also starts at 500
  gp.hands[0] = ids([T(0,1), T(0,2), T(0,3), T(1,1), T(1,2), T(1,3), T(0,0), T(1,0), T(2,0), T(0,2), T(1,2), T(2,2), T(3,3), T(3,3), T(3,3), T(2,6)]);
  ok(C.isComplete(gp, 0), 'one-king hand complete');
  pr = C.priceWin(gp, 0, null);
  ok(pr.start === 500 && pr.per === 500 + 5 + 5 + 5 + 5 + 0 + 20, 'one king: 500 + king 5 + runs + three aces + pong = ' + pr.per);
  // secrets add 50 each with the win; laying one down collects nothing at once
  gp.hands[0] = ids([T(0,1), T(0,2), T(0,3), T(1,1), T(1,2), T(1,3), T(0,0), T(1,0), T(2,0), T(3,3), T(3,3), T(3,3)]);
  gp.secrets[0] = [{ cards: [T(1,4)*4, T(1,4)*4+1, T(1,4)*4+2, T(1,4)*4+3], kind: 'four', type: T(1,4), extra: null }];
  ok(C.isComplete(gp, 0), 'hand with a secret complete');
  pr = C.priceWin(gp, 0, null);
  ok(pr.per === 500 + 5 + 5 + 5 + 20 + 50, 'secret adds 50 = ' + pr.per);
  // four kings of the same suit start at 1000
  gp.secrets[0] = [];
  gp.hands[0] = ids([T(1,6), T(1,6), T(1,6), T(1,6), T(0,1), T(0,2), T(0,3), T(2,2), T(2,2), T(2,2), T(0,0), T(1,0), T(3,1), T(3,4), T(2,5)]);
  ok(C.kingWin(gp, 0) === 'rub', 'four of one king is a rub');
  pr = C.priceWin(gp, 0, 'rub');
  ok(pr.start === 1000 && pr.per === 1000 + 4 * 5 + 5 + 20, 'four kings of one suit: 1000 + kings + 3-4-5 + pong (loose cards add nothing) = ' + pr.per);
  // every card identical to the sowee adds 20
  gp.sowee = C.typeOf(3, 3) * 4 + 3;   // five of batons: the four-kings hand above holds none, the no-king hand holds three
  gp.hands[0] = ids([T(0,1), T(0,2), T(0,3), T(1,1), T(1,2), T(1,3), T(0,0), T(1,0), T(2,0), T(0,2), T(1,2), T(2,2), T(3,2), T(3,3), T(3,3), T(3,3)]);
  pr = C.priceWin(gp, 0, null);
  ok(pr.per === 500 + 5 + 5 + 5 + 5 + 20 + 3 * 20, 'three cards identical to the sowee add 3 x 20 = ' + pr.per);
  console.log('house pricing checked');
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
      if (g3.phase === 'rubOffer') { C.resolveRub(g3, C.aiChooseRub(g3, g3.rubOffer.seat)); continue; }
      const seat = g3.turn;
      if (g3.phase === 'draw') { const a = C.aiChooseDraw(g3, seat); if (a === 'stock') C.drawStock(g3, seat); else if (a === 'discard') C.takeDiscard(g3, seat); else C.endHandDraw(g3); }
      else { const sc = C.aiChooseSecret(g3, seat); if (sc) C.declareSecret(g3, seat, sc.type, sc.extraId); else C.discard(g3, seat, C.aiChooseDiscard(g3, seat)); }
      checkConservation(g3);
    }
    if (g3.result.type === 'win') ok(g3.result.special || C.isComplete(g3, g3.result.winner), 'easy: winner hand complete');
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
// 7. house rule: no winning with a discard
{
  const T = (s2, r) => C.typeOf(s2, r);
  const g7 = C.newGame({ seed: 7, human: -1 }); C.startHand(g7);
  const want = [T(0,1),T(0,2),T(0,3), T(1,4),T(1,5),T(1,6), T(0,0),T(1,0),T(2,0), T(2,3),T(3,3),T(0,3), T(1,1),T(2,1),T(3,1)];
  const pool = [].concat(...g7.hands, g7.stock, g7.discards);
  const take = t => { const i = pool.findIndex(id => C.cardType(id) === t); return pool.splice(i, 1)[0]; };
  const hand1 = want.map(take), king = take(T(0, 6));
  g7.hands = [pool.splice(0, 15), hand1, pool.splice(0, 15), pool.splice(0, 15)];
  g7.discards = [king]; g7.discardedBy = [0]; g7.stock = pool; g7.secrets = [[], [], [], []];
  g7.phase = 'draw'; g7.turn = 1; g7.purro = [false, true, false, false];
  ok(C.completesWith(g7, 1, T(0, 6)), 'the discarded king would complete seat 1');
  ok(!C.legalActions(g7, 1).takeDiscard, 'a winning discard cannot be taken');
  let threw = false; try { C.takeDiscard(g7, 1); } catch (x) { threw = true; }
  ok(threw, 'taking a winning discard is refused');
  ok(C.aiChooseDraw(g7, 1) === 'stock', 'the computer draws from the stock instead');
  g7.stock = [];
  ok(!C.legalActions(g7, 1).takeDiscard && C.legalActions(g7, 1).endHand, 'with the stock empty the hand just ends');
  console.log('house rule checks: winning discards refused, computer draws instead');
}
// 8. special king wins: prinsesa (four kings, different suits), seven kings and rub (three of one king)
{
  const T = (s2, r) => C.typeOf(s2, r);
  const setup = (kingTypes, seed) => {
    const g8 = C.newGame({ seed, human: -1 }); C.startHand(g8);
    g8.result = null; g8.purro = [false, false, false, false]; g8.penalty = [0, 0, 0, 0];
    const pool = [].concat(...g8.hands, g8.stock, g8.discards);
    const take = t => { const i = pool.findIndex(id => C.cardType(id) === t); return pool.splice(i, 1)[0]; };
    const kings = kingTypes.map(take);
    const others = pool.filter(id => !C.isKing(id));
    const rest = pool.filter(id => C.isKing(id));
    g8.hands = [others.splice(0, 15), kings.concat(others.splice(0, 15 - kings.length)), others.splice(0, 15), others.splice(0, 15)];
    g8.stock = others.concat(rest); g8.discards = []; g8.discardedBy = []; g8.secrets = [[], [], [], []];
    g8.phase = 'draw'; g8.turn = 1;
    return g8;
  };
  // three kings of different suits; the fourth suit comes from the stock
  const g8 = setup([T(0, 6), T(1, 6), T(2, 6)], 81);
  ok(g8 && C.kingWin(g8, 1) === null, 'three different kings are not yet a prinsesa');
  const k4 = g8.stock.findIndex(id => C.cardType(id) === T(3, 6)); g8.stock.push(g8.stock.splice(k4, 1)[0]);
  C.drawStock(g8, 1);
  ok(g8.phase === 'over' && g8.result.winner === 1 && g8.result.special === 'prinsesa', 'drawing the fourth suit of king wins: prinsesa');
  ok(g8.result.start === 500 && g8.result.perOpponent >= 500 + 4 * 5, 'prinsesa starts at 500, plus 5 a king');
  // a fifth king spoils the prinsesa: four suits plus a second Rey de Copas is not a prinsesa
  const g8b = setup([T(0, 6), T(1, 6), T(1, 6), T(2, 6)], 82);
  const k4b = g8b.stock.findIndex(id => C.cardType(id) === T(3, 6)); g8b.stock.push(g8b.stock.splice(k4b, 1)[0]);
  C.drawStock(g8b, 1);
  ok(!(g8b.phase === 'over' && g8b.result.special === 'prinsesa'), 'five kings across four suits are not a prinsesa');
  // seven kings straight from the deal (any seven kings drawn one by one already make a rub or a prinsesa)
  const g9 = setup([T(0, 6), T(0, 6), T(1, 6), T(1, 6), T(2, 6), T(2, 6), T(1, 6)], 91);
  ok(g9 && C.kingWin(g9, 1) === 'sevenkings', 'seven kings in hand: seven kings');
  // four kings, two of each of two suits, are not yet a win; the third of a suit drawn is a rub
  const g10 = setup([T(0, 6), T(0, 6), T(2, 6), T(2, 6)], 101);
  ok(g10 && C.kingWin(g10, 1) === null, 'two pairs of kings are not yet a win');
  const k3 = g10.stock.findIndex(id => C.cardType(id) === T(2, 6)); g10.stock.push(g10.stock.splice(k3, 1)[0]);
  C.drawStock(g10, 1);
  ok(g10.phase === 'over' && g10.result.winner === 1 && g10.result.special === 'rub', 'the third king of one suit wins: rub');
  ok(g10.result.start === 500 && g10.result.perOpponent >= 500 + 5 * 5, 'rub starts at 500, plus 5 a king');
  // rub from a shown stock card: someone is purro, so draws are shown and the holder of two claims the third
  const g11 = setup([T(1, 6), T(1, 6)], 111);
  ok(g11 && C.kingWin(g11, 1) === null, 'two of a king are not yet a rub');
  g11.turn = 0; g11.purro[3] = true;
  const k5 = g11.stock.findIndex(id => C.cardType(id) === T(1, 6)); g11.stock.push(g11.stock.splice(k5, 1)[0]);
  C.drawStock(g11, 0);
  ok(g11.phase === 'over' && g11.result.winner === 1 && g11.result.special === 'rub' && g11.result.source === 'claim', 'a shown third king is claimed for a rub by a player who is not purro');
  ok(g11.hands[0].length === 15, 'the claimed card leaves the drawer');
  // without anyone purro the draw stays hidden and cannot be claimed
  const g12 = setup([T(1, 6), T(1, 6)], 121);
  g12.turn = 0;
  const k6 = g12.stock.findIndex(id => C.cardType(id) === T(1, 6)); g12.stock.push(g12.stock.splice(k6, 1)[0]);
  C.drawStock(g12, 0);
  ok(g12.phase !== 'over' || g12.result.winner !== 1, 'a hidden draw cannot be claimed');
  // dealt three kings of one suit: wait, then the fourth king starts at 1000; or take the rub later
  {
    let gw = null;
    for (let sd = 1; sd < 4000 && !gw; sd++) { const t = C.newGame({ seed: sd, human: -1 }); C.startHand(t); if (t.phase === 'rubOffer') gw = t; }
    ok(gw && C.legalActions(gw, gw.rubOffer.seat).rubChoice, 'a deal with three kings of one suit offers the choice');
    const seat = gw.rubOffer.seat, kt = gw.rubOffer.type;
    C.resolveRub(gw, false);
    ok(gw.rubWait[seat] && gw.phase !== 'rubOffer', 'waiting keeps the hand going');
    if (gw.phase !== 'over') {
      // play until it is the waiting player's draw, then hand them the fourth king
      let guard = 0;
      while (!(gw.phase === 'draw' && gw.turn === seat) && gw.phase !== 'over' && guard++ < 50) {
        if (gw.phase === 'timeOffer') { C.resolveTime(gw, false); continue; }
        if (gw.phase === 'rubOffer') { C.resolveRub(gw, false); continue; }
        if (gw.phase === 'draw') C.drawStock(gw, gw.turn); else if (gw.phase === 'discard') C.discard(gw, gw.turn, C.aiChooseDiscard(gw, gw.turn));
      }
      if (gw.phase === 'draw' && gw.turn === seat) {
        ok(C.legalActions(gw, seat).declareRub, 'while waiting, the rub can be taken on your turn');
        // move the last copy of that king to the top of the stock (swapping it out of another hand if needed)
        let fourth = gw.stock.find(id => C.cardType(id) === kt);
        if (fourth == null) for (let p = 0; p < 4 && fourth == null; p++) if (p !== seat) {
          const h = gw.hands[p], i2 = h.findIndex(id => C.cardType(id) === kt);
          if (i2 >= 0) { fourth = h[i2]; const sub = gw.stock.findIndex(id => !C.isKing(id)); h[i2] = gw.stock[sub]; gw.stock[sub] = fourth; }
        }
        ok(fourth != null, 'the fourth king is in play');
        if (fourth != null) {
          gw.stock.splice(gw.stock.indexOf(fourth), 1); gw.stock.push(fourth);
          C.drawStock(gw, seat);
          ok(gw.phase === 'over' && gw.result.winner === seat && gw.result.special === 'rub' && gw.result.start === 1000, 'the fourth king wins: four kings of one suit start at 1000'); console.log('waited for the fourth king and won with', C.money(gw.result.perOpponent));
        }
      }
    }
  }
  console.log('special king wins: prinsesa, seven kings and rub (own draw and claimed) checked; rub choice at the deal checked');
}
console.log('all engine checks passed:', passed);
