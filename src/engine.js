/* Cuajo engine — rules, hand evaluation and AI. No DOM.
   Loads in the browser as window.Cuajo and in Node via require().
   Rules follow the description at https://www.pagat.com/rummy/cuajo.html */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Cuajo = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---------- Cards ----------
  // 4 Spanish suits x 7 ranks (A,3,4,5,J,H,K) x 4 identical copies = 112 cards.
  const SUITS = ['coins', 'cups', 'swords', 'batons'];
  const SUIT_LABEL = ['Coins', 'Cups', 'Swords', 'Batons'];
  const SUIT_ES = ['Oros', 'Copas', 'Espadas', 'Bastos'];
  const RANKS = ['A', '3', '4', '5', 'J', 'H', 'K'];
  const RANK_LABEL = ['Ace', 'Three', 'Four', 'Five', 'Jack', 'Horse', 'King'];
  const RANK_ES = ['As', 'Tres', 'Cuatro', 'Cinco', 'Sota', 'Caballo', 'Rey'];
  const ACE = 0, KING = 6, NTYPES = 28, NCARDS = 112, HAND = 16;
  const SECRET_PAY = 50; // added to the win price for each secret laid down

  function typeOf(s, r) { return s * 7 + r; }
  function suitOf(t) { return (t / 7) | 0; }
  function rankOf(t) { return t % 7; }
  function cardType(id) { return (id / 4) | 0; }      // copies of type t are ids 4t..4t+3
  function isKingType(t) { return rankOf(t) === KING; }
  function isKing(id) { return isKingType(cardType(id)); }
  function cardName(t) { return RANK_LABEL[rankOf(t)] + ' of ' + SUIT_LABEL[suitOf(t)]; }
  function partnerOf(seat) { return (seat + 2) % 4; }
  function opponentsOf(seat) { return [0, 1, 2, 3].filter(p => p !== seat && p !== partnerOf(seat)); }
  let CURRENCY = '\u20B1';
  /** The money symbol shown in amounts (pesos by default). */
  function setCurrency(sym) { CURRENCY = sym || '\u20B1'; }
  /** Amounts are whole units (the house prices: 200, 500, 1000, plus 5s, 10s, 20s and 50s). */
  function money(n) {
    const v = Math.abs(Math.round(n));
    return (n < 0 ? '\u2212' : '') + CURRENCY + String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function countsOf(ids) { const c = new Array(NTYPES).fill(0); for (const id of ids) c[cardType(id)]++; return c; }
  function sum(c) { let n = 0; for (let i = 0; i < c.length; i++) n += c[i]; return n; }
  function assert(cond, msg) { if (!cond) throw new Error('Cuajo: ' + (msg || 'illegal action')); }

  // ---------- Combination logic ----------
  // Valid combinations: set of 3 or 4 cards of one rank in different suits; run of 3-4-5 or
  // J-H-K in one suit; secret = 4 identical cards; a king on its own.

  // Memo keys: counts packed base-6 into two numbers (types 0-13 -> lo, 14-27 -> hi), updated incrementally.
  const P6 = []; for (let i = 0; i < 14; i++) P6.push(Math.pow(6, i));
  function packLo(c) { let v = 0; for (let i = 0; i < 14; i++) v += c[i] * P6[i]; return v; }
  function packHi(c) { let v = 0; for (let i = 0; i < 14; i++) v += c[i + 14] * P6[i]; return v; }

  const partMemo = new Map(); let partSize = 0;
  /** True if every card in `counts` (28 ints) can be arranged into valid combinations:
      sets (3-4 of a rank in different suits), pongs (3-4 identical cards), runs (3-4-5, J-H-K in one suit), lone kings. */
  function canPartition(counts) {
    const c = counts.slice();
    let lo = packLo(c), hi = packHi(c);
    const dec = t => { c[t]--; if (t < 14) lo -= P6[t]; else hi -= P6[t - 14]; };
    const inc = t => { c[t]++; if (t < 14) lo += P6[t]; else hi += P6[t - 14]; };
    function rec(from) {
      let t = from; while (t < NTYPES && c[t] === 0) t++;
      if (t === NTYPES) return true;
      let m = partMemo.get(lo); if (!m) { m = new Map(); partMemo.set(lo, m); }
      const hit = m.get(hi); if (hit !== undefined) return hit;
      let ok = false;
      const s = suitOf(t), r = rankOf(t);
      if (r === KING) { dec(t); ok = rec(t); inc(t); }
      if (!ok && c[t] >= 4) { dec(t); dec(t); dec(t); dec(t); ok = rec(t); inc(t); inc(t); inc(t); inc(t); }
      if (!ok && c[t] >= 3) { dec(t); dec(t); dec(t); ok = rec(t); inc(t); inc(t); inc(t); }          // pong
      if (!ok) {
        const o = [];
        for (let s2 = 0; s2 < 4; s2++) if (s2 !== s && c[typeOf(s2, r)] > 0) o.push(typeOf(s2, r));
        for (let i = 0; i < o.length && !ok; i++) for (let j = i + 1; j < o.length && !ok; j++) {
          dec(t); dec(o[i]); dec(o[j]);
          ok = rec(t);
          if (!ok && o.length === 3) { const q = o[3 - i - j]; dec(q); ok = rec(t); inc(q); }
          inc(o[j]); inc(o[i]); inc(t);
        }
      }
      if (!ok && (r === 1 || r === 4) && c[t + 1] > 0 && c[t + 2] > 0) {
        dec(t); dec(t + 1); dec(t + 2); ok = rec(t); inc(t + 2); inc(t + 1); inc(t);
      }
      if (++partSize > 400000) { partMemo.clear(); partSize = 0; m = new Map(); partMemo.set(lo, m); }
      m.set(hi, ok);
      return ok;
    }
    return rec(0);
  }

  /** One valid arrangement of the cards as groups [{types, kind}], or null. */
  function partition(counts) {
    const c = counts.slice();
    function rec(from) {
      let t = from; while (t < NTYPES && c[t] === 0) t++;
      if (t === NTYPES) return [];
      if (!canPartition(c)) return null;
      const s = suitOf(t), r = rankOf(t);
      const attempt = (types, kind) => {
        for (const x of types) c[x]--;
        const sub = rec(t);
        for (const x of types) c[x]++;
        return sub ? [{ types: types.slice(), kind }].concat(sub) : null;
      };
      let res = null;
      if (r === KING) res = attempt([t], 'king');
      if (!res && c[t] >= 4) res = attempt([t, t, t, t], 'pong');
      if (!res && c[t] >= 3) res = attempt([t, t, t], 'pong');
      if (!res) {
        const o = [];
        for (let s2 = 0; s2 < 4; s2++) if (s2 !== s && c[typeOf(s2, r)] > 0) o.push(typeOf(s2, r));
        if (o.length === 3) res = attempt([t, o[0], o[1], o[2]], 'set');
        for (let i = 0; i < o.length && !res; i++) for (let j = i + 1; j < o.length && !res; j++) res = attempt([t, o[i], o[j]], 'set');
      }
      if (!res && (r === 1 || r === 4) && c[t + 1] > 0 && c[t + 2] > 0) res = attempt([t, t + 1, t + 2], 'run');
      return res;
    }
    return rec(0);
  }

  // Options for using the first remaining card `t` of a hand when planning toward a complete hand.
  // kept = cards from the hand this group keeps; used = slots of the final 16 it will occupy.
  function optionsAt(c, t) {
    const s = suitOf(t), r = rankOf(t);
    const ops = [];
    const o = [];
    for (let s2 = 0; s2 < 4; s2++) if (s2 !== s && c[typeOf(s2, r)] > 0) o.push(typeOf(s2, r));
    // complete groups
    if (r === KING) ops.push({ types: [t], used: 1, kind: 'king' });
    if (c[t] >= 4) ops.push({ types: [t, t, t, t], used: 4, kind: 'pong' });
    if (c[t] >= 3) ops.push({ types: [t, t, t], used: 3, kind: 'pong' });
    if (o.length === 3) ops.push({ types: [t, o[0], o[1], o[2]], used: 4, kind: 'set' });
    for (let i = 0; i < o.length; i++) for (let j = i + 1; j < o.length; j++) ops.push({ types: [t, o[i], o[j]], used: 3, kind: 'set' });
    if ((r === 1 || r === 4) && c[t + 1] > 0 && c[t + 2] > 0) ops.push({ types: [t, t + 1, t + 2], used: 3, kind: 'run' });
    // partial groups (one card short)
    if (c[t] >= 2) ops.push({ types: [t, t], used: 3, kind: 'pong2' });
    for (let i = 0; i < o.length; i++) ops.push({ types: [t, o[i]], used: 3, kind: 'set2' });
    if (r === 1 || r === 2 || r === 4 || r === 5) {
      const top = r <= 3 ? 3 : 6;
      for (let r2 = r + 1; r2 <= top; r2++) if (c[typeOf(s, r2)] > 0) ops.push({ types: [t, typeOf(s, r2)], used: 3, kind: 'run2' });
    }
    // a single card kept as the start of a future combination
    if (r !== KING) ops.push({ types: [t], used: 3, kind: 'seed' });
    // give the card up
    ops.push({ types: [t], used: 0, kind: 'drop', kept: 0 });
    for (const op of ops) if (op.kept === undefined) op.kept = op.types.length;
    return ops;
  }

  const keepMemo = new Map(); let keepSize = 0;
  /** Max number of cards of the hand that can be part of a complete hand using at most `slots` of its 16 places.
      Same option set as optionsAt(), written out inline for speed. (No baksyo requirement; see bestKeepB.) */
  function bestKeep(counts, slots) {
    const c = counts.slice();
    let lo = packLo(c), hi = packHi(c);
    const dec = t => { c[t]--; if (t < 14) lo -= P6[t]; else hi -= P6[t - 14]; };
    const inc = t => { c[t]++; if (t < 14) lo += P6[t]; else hi += P6[t - 14]; };
    function rec(from, sl) {
      let t = from; while (t < NTYPES && c[t] === 0) t++;
      if (t === NTYPES || sl === 0) return 0;
      let m = keepMemo.get(lo); if (!m) { m = new Map(); keepMemo.set(lo, m); }
      const k = hi * 17 + sl;
      const hit = m.get(k); if (hit !== undefined) return hit;
      const s = suitOf(t), r = rankOf(t);
      let best, v;
      dec(t); best = rec(t, sl); inc(t);                                              // drop
      if (r === KING) { dec(t); v = 1 + rec(t, sl - 1); inc(t); if (v > best) best = v; }   // lone king
      else if (sl >= 3) { dec(t); v = 1 + rec(t, sl - 3); inc(t); if (v > best) best = v; } // seed
      if (sl >= 3) {                                                                   // pongs (identical cards)
        if (c[t] >= 2) { dec(t); dec(t); v = 2 + rec(t, sl - 3); inc(t); inc(t); if (v > best) best = v; }
        if (c[t] >= 3) { dec(t); dec(t); dec(t); v = 3 + rec(t, sl - 3); inc(t); inc(t); inc(t); if (v > best) best = v; }
      }
      if (sl >= 4 && c[t] >= 4) { dec(t); dec(t); dec(t); dec(t); v = 4 + rec(t, sl - 4); inc(t); inc(t); inc(t); inc(t); if (v > best) best = v; }
      if (sl >= 3) {
        let o0 = -1, o1 = -1, o2 = -1, no = 0;
        for (let s2 = 0; s2 < 4; s2++) if (s2 !== s) { const u = typeOf(s2, r); if (c[u] > 0) { if (no === 0) o0 = u; else if (no === 1) o1 = u; else o2 = u; no++; } }
        for (let i = 0; i < no; i++) {
          const a = i === 0 ? o0 : i === 1 ? o1 : o2;
          dec(t); dec(a); v = 2 + rec(t, sl - 3); inc(a); inc(t); if (v > best) best = v;            // set of 2
          for (let j = i + 1; j < no; j++) {
            const b = j === 1 ? o1 : o2;
            dec(t); dec(a); dec(b); v = 3 + rec(t, sl - 3); inc(b); inc(a); inc(t); if (v > best) best = v; // set of 3
          }
        }
        if (no === 3 && sl >= 4) { dec(t); dec(o0); dec(o1); dec(o2); v = 4 + rec(t, sl - 4); inc(o2); inc(o1); inc(o0); inc(t); if (v > best) best = v; }
        if (r === 1 || r === 2 || r === 4 || r === 5) {                                             // runs
          const top = r <= 3 ? 3 : 6;
          for (let r2 = r + 1; r2 <= top; r2++) { const u = typeOf(s, r2); if (c[u] > 0) { dec(t); dec(u); v = 2 + rec(t, sl - 3); inc(u); inc(t); if (v > best) best = v; } }
          if ((r === 1 || r === 4) && c[t + 1] > 0 && c[t + 2] > 0) { dec(t); dec(t + 1); dec(t + 2); v = 3 + rec(t, sl - 3); inc(t + 2); inc(t + 1); inc(t); if (v > best) best = v; }
        }
      }
      if (++keepSize > 600000) { keepMemo.clear(); keepSize = 0; m = new Map(); keepMemo.set(lo, m); }
      m.set(k, best);
      return best;
    }
    return rec(0, slots);
  }

  /** The grouping behind bestKeep: [{types, kind}] covering every card (kind 'drop' = not kept). */
  function keepPlan(counts, slots) {
    const c = counts.slice(); const groups = [];
    let from = 0, sl = slots;
    for (;;) {
      let t = from; while (t < NTYPES && c[t] === 0) t++;
      if (t === NTYPES) break;
      if (sl === 0) { for (let x = t; x < NTYPES; x++) for (let k = 0; k < c[x]; k++) groups.push({ types: [x], kind: 'drop' }); break; }
      const target = bestKeep(c, sl);
      let chosen = null;
      for (const op of optionsAt(c, t)) {
        if (op.used > sl) continue;
        for (const x of op.types) c[x]--;
        const v = op.kept + bestKeep(c, sl - op.used);
        for (const x of op.types) c[x]++;
        if (v === target) { chosen = op; break; }
      }
      for (const x of chosen.types) c[x]--;
      sl -= chosen.used;
      groups.push({ types: chosen.types.slice(), kind: chosen.kind });
      from = t;
    }
    return groups;
  }

  // ---------- baksyo: every winning hand needs one (house rule) ----------
  // A baksyo is three or four aces (a set of aces, or a pong of identical aces), or a 3-4-5 or
  // jack-horse-king (10-11-12) run in one suit. A secret of aces laid on the table also counts.
  const BAKSYO = (() => {
    const out = [];
    for (let s = 0; s < 4; s++) { out.push([typeOf(s, 1), typeOf(s, 2), typeOf(s, 3)]); out.push([typeOf(s, 4), typeOf(s, 5), typeOf(s, 6)]); }
    const A = [0, 1, 2, 3].map(s => typeOf(s, ACE));
    for (let skip = 0; skip < 4; skip++) out.push(A.filter((x, i) => i !== skip));
    out.push(A.slice());
    for (const a of A) { out.push([a, a, a]); out.push([a, a, a, a]); }
    return out.map(types => { const need = {}; for (const t of types) need[t] = (need[t] || 0) + 1; return { types, need: Object.keys(need).map(k => [+k, need[k]]) }; });
  })();
  function hasAll(c, B) { return B.need.every(p => c[p[0]] >= p[1]); }
  /** True when the cards (a multiset of types) are exactly one baksyo group. */
  function isBaksyo(types) {
    const c = countsOf([]); for (const t of types) c[t]++;
    return BAKSYO.some(B => B.types.length === types.length && hasAll(c, B));
  }
  function baksyoKind(types) { if (rankOf(types[0]) !== ACE) return 'run'; return types.every(x => x === types[0]) ? 'pong' : 'set'; }
  /** House rule: a hand with no kings at all does not need a baksyo; any king makes the baksyo required. */
  function anyKing(counts) { for (let s = 0; s < 4; s++) if (counts[typeOf(s, KING)] > 0) return true; return false; }
  function needsBaksyo(counts, hasB) { return !hasB && anyKing(counts); }
  /** A complete hand under the house rules: valid combinations, including a baksyo when the hand holds a king
      (unless a laid secret of aces already is the baksyo). */
  function completeB(counts, hasB) {
    if (!needsBaksyo(counts, hasB)) return canPartition(counts);
    const c = counts.slice();
    for (const B of BAKSYO) {
      if (!hasAll(c, B)) continue;
      for (const p of B.need) c[p[0]] -= p[1];
      const ok = canPartition(c);
      for (const p of B.need) c[p[0]] += p[1];
      if (ok) return true;
    }
    return false;
  }
  /** One arrangement of a winning hand, with its baksyo group first (marked baksyo: true). */
  function partitionB(counts, hasB) {
    if (!needsBaksyo(counts, hasB)) return partition(counts);
    const c = counts.slice();
    for (const B of BAKSYO) {
      if (!hasAll(c, B)) continue;
      for (const p of B.need) c[p[0]] -= p[1];
      const rest = canPartition(c) ? partition(c) : null;
      for (const p of B.need) c[p[0]] += p[1];
      if (rest) return [{ types: B.types.slice(), kind: baksyoKind(B.types), baksyo: true }].concat(rest);
    }
    return null;
  }
  // Planning with the requirement: commit to the most promising baksyo group, plan the other cards freely.
  function bestBaksyo(counts, slots) {
    const c = counts.slice(); let best = null, zeroDone = false;
    for (const B of BAKSYO) {
      if (B.types.length > slots) continue;
      let k = 0; const got = [];
      for (const p of B.need) { const h = Math.min(c[p[0]], p[1]); if (h) { got.push([p[0], h]); k += h; } }
      if (!k) { if (B.types.length !== 3 || zeroDone) continue; zeroDone = true; }
      for (const p of got) c[p[0]] -= p[1];
      const v = k + bestKeep(c, slots - B.types.length);
      for (const p of got) c[p[0]] += p[1];
      if (!best || v > best.v) best = { v, B, got, k };
    }
    return best;
  }
  function bestKeepB(counts, slots, hasB) {
    if (!needsBaksyo(counts, hasB) || slots < 3) return bestKeep(counts, slots);
    const b = bestBaksyo(counts, slots);
    return b ? b.v : bestKeep(counts, slots);
  }
  /** Cards still needed to complete the hand (a hand of slots-1 cards is 1 away when purro). */
  function distance(counts, slots, hasB) { return slots - bestKeepB(counts, slots, hasB); }
  /** The grouping behind distance(): the chosen baksyo group (whole or in part) first, then the rest. */
  function keepPlanB(counts, slots, hasB) {
    if (!needsBaksyo(counts, hasB) || slots < 3) return keepPlan(counts, slots);
    const b = bestBaksyo(counts, slots);
    if (!b) return keepPlan(counts, slots);
    const c = counts.slice(); const types = [];
    for (const p of b.got) { c[p[0]] -= p[1]; for (let i = 0; i < p[1]; i++) types.push(p[0]); }
    const rest = keepPlan(c, slots - b.B.types.length);
    if (!types.length) return rest;
    const whole = canPartition(countsOfTypes(types));
    const kind = whole ? baksyoKind(types) : types.length === 1 ? 'seed' : rankOf(types[0]) !== ACE ? 'run2' : types[0] === types[1] ? 'pong2' : 'set2';
    return [{ types, kind, baksyo: true }].concat(rest);
  }
  function countsOfTypes(types) { const c = countsOf([]); for (const t of types) c[t]++; return c; }

  /** Types that would complete a hand of slots-1 cards. Non-empty means the player is "purro". */
  function waitingTypes(counts, slots, hasB) {
    if (sum(counts) !== slots - 1) return [];
    const res = [];
    for (let t = 0; t < NTYPES; t++) { if (counts[t] >= 4) continue; counts[t]++; if (completeB(counts, hasB)) res.push(t); counts[t]--; }
    return res;
  }

  /** Types that bring a hand of slots-1 cards closer to completion. */
  function usefulTypes(counts, slots, hasB) {
    const base = bestKeepB(counts, slots, hasB); const res = [];
    for (let t = 0; t < NTYPES; t++) { if (counts[t] >= 4) continue; counts[t]++; if (bestKeepB(counts, slots, hasB) > base) res.push(t); counts[t]--; }
    return res;
  }

  // ---------- Game state ----------
  function nextRand(g) { // mulberry32, state kept in g.rng so games are reproducible/serialisable
    g.rng = (g.rng + 0x6D2B79F5) >>> 0;
    let t = g.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function randInt(g, n) { return Math.floor(nextRand(g) * n); }

  function log(g, msg, kind) { g.events.push({ msg, kind: kind || 'info', hand: g.handNo, n: g.events.length }); if (g.events.length > 80) g.events.splice(0, g.events.length - 80); }

  function newGame(opts) {
    opts = opts || {};
    const seed = opts.seed !== undefined ? opts.seed : ((Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0);
    return {
      version: 2,
      rng: seed >>> 0, seed: seed >>> 0,
      names: (opts.names || ['You', 'East', 'North', 'West']).slice(),
      human: opts.human !== undefined ? opts.human : 0,
      humans: (opts.humans || [opts.human !== undefined ? opts.human : 0]).slice(),
      dealRule: opts.dealRule === 'right' ? 'right' : 'winner',
      balances: [0, 0, 0, 0], wins: [0, 0, 0, 0], handsPlayed: 0, draws: 0,
      dealer: opts.dealer || 0, nextDealer: opts.dealer || 0,
      handNo: 0, phase: 'idle', events: [],
      hands: [[], [], [], []], secrets: [[], [], [], []], stock: [], discards: [], discardedBy: [], history: [], seenIds: {},
      purro: [false, false, false, false], waiting: [[], [], [], []], marker: [null, null, null, null], penalty: [0, 0, 0, 0],
      sowee: null, seen: new Array(NTYPES).fill(0), turn: 0, turnCount: 0,
      drawn: null, drawnFrom: null, lastShown: null, timeOffer: null, result: null,
    };
  }

  function startHand(g) {
    g.handNo++;
    const deck = []; for (let i = 0; i < NCARDS; i++) deck.push(i);
    for (let i = NCARDS - 1; i > 0; i--) { const j = randInt(g, i + 1); const tmp = deck[i]; deck[i] = deck[j]; deck[j] = tmp; }
    g.hands = [[], [], [], []]; g.secrets = [[], [], [], []];
    g.purro = [false, false, false, false]; g.waiting = [[], [], [], []]; g.marker = [null, null, null, null]; g.penalty = [0, 0, 0, 0];
    g.discards = []; g.discardedBy = []; g.history = []; g.seen = new Array(NTYPES).fill(0); g.seenIds = {};
    g.events = []; g.result = null; g.timeOffer = null; g.lastShown = null; g.drawn = null; g.drawnFrom = null;
    // Deal to the right (anticlockwise) starting with the dealer: dealer 16 cards, everyone else 15.
    for (let k = 0; k < 4; k++) {
      const seat = (g.dealer + k) % 4, n = seat === g.dealer ? HAND : HAND - 1;
      for (let i = 0; i < n; i++) g.hands[seat].push(deck.pop());
    }
    g.sowee = deck.pop(); markSeen(g, g.sowee);
    g.stock = deck; // top of the stock = last element
    g.turn = g.dealer; g.phase = 'discard'; g.turnCount = 0; g.rubWait = [false, false, false, false]; g.rubOffer = null;
    log(g, 'Hand ' + g.handNo + ': ' + g.names[g.dealer] + ' deals. The sowee is the ' + cardName(cardType(g.sowee)) + '.', 'deal');
    dealChecks(g, 0);
    return g;
  }
  /** Seven kings, prinsesa or rub straight from the deal, then a dealer complete as dealt.
      Three kings of one suit in the dealt cards: the player chooses to win now or wait for the fourth (house rule). */
  function dealChecks(g, k0) {
    for (let k = k0; k < 4; k++) {
      const seat = (g.dealer + k) % 4, kw = kingWin(g, seat);
      if (!kw) continue;
      if (kw === 'rub' && maxSameKing(g, seat) === 3) {
        let type = null; for (let s = 0; s < 4; s++) if (kingCount(g, seat, typeOf(s, KING)) === 3) type = typeOf(s, KING);
        g.phase = 'rubOffer'; g.rubOffer = { seat, k, type }; return;
      }
      finishWin(g, seat, 'deal', null, kw); return;
    }
    g.phase = 'discard'; g.turn = g.dealer;
    if (isComplete(g, g.dealer)) finishWin(g, g.dealer, 'deal', null);
  }
  /** The player dealt three kings of one suit wins now (rub) or waits for the fourth king. */
  function resolveRub(g, win) {
    assert(g.phase === 'rubOffer' && g.rubOffer, 'no rub choice pending');
    const o = g.rubOffer; g.rubOffer = null;
    if (win) { finishWin(g, o.seat, 'deal', null, 'rub'); return; }
    g.rubWait[o.seat] = true;
    dealChecks(g, o.k + 1);
  }
  /** While waiting for the fourth king, the player may still take the rub on any of their turns. */
  function declareRub(g, seat) {
    assert(legalActions(g, seat).declareRub, 'no rub to declare');
    finishWin(g, seat, g.phase === 'discard' && g.drawn != null ? (g.drawnFrom || 'stock') : 'deal', g.phase === 'discard' ? g.drawn : null, 'rub');
  }
  function maxSameKing(g, seat) { let m = 0; for (let s = 0; s < 4; s++) m = Math.max(m, kingCount(g, seat, typeOf(s, KING))); return m; }
  /** A special king win that takes effect now; a player waiting for the fourth king is not forced to take the rub. */
  function specialNow(g, seat) {
    const kw = kingWin(g, seat);
    if (kw === 'rub' && g.rubWait && g.rubWait[seat] && maxSameKing(g, seat) < 4) return null;
    return kw;
  }

  function nextHand(g) { g.dealer = g.nextDealer; return startHand(g); }

  /** Record a card as publicly seen (sowee, discards, shown draws); counted once per card. */
  function markSeen(g, id) { if (!g.seenIds) g.seenIds = {}; if (!g.seenIds[id]) { g.seenIds[id] = true; g.seen[cardType(id)]++; } }
  function handCounts(g, seat) { return countsOf(g.hands[seat]); }
  /** Fourth cards laid face down with sowee secrets: out of the hand, but they still have to be melded to win. */
  function extrasOf(g, seat) { const r = []; for (const s of g.secrets[seat]) if (s.extra != null) r.push(s.extra); return r; }
  /** The cards that still have to form combinations: the concealed hand plus any sowee-secret extras. */
  function poolIds(g, seat) { return g.hands[seat].concat(extrasOf(g, seat)); }
  function poolCounts(g, seat) { return countsOf(poolIds(g, seat)); }
  /** How many of the 16 places are not yet filled by laid secrets (a four-card secret fills 4, a sowee secret 3). */
  function slotsFor(g, seat) { let n = HAND; for (const s of g.secrets[seat]) n -= s.kind === 'four' ? 4 : 3; return n; }
  /** A secret of aces laid on the table already counts as the hand's baksyo. */
  function secretB(g, seat) { return g.secrets[seat].some(s => rankOf(s.type) === ACE); }
  function isComplete(g, seat) { return poolIds(g, seat).length === slotsFor(g, seat) && completeB(poolCounts(g, seat), secretB(g, seat)); }
  function completesWith(g, seat, t) {
    if (poolIds(g, seat).length + 1 !== slotsFor(g, seat)) return false;
    const c = poolCounts(g, seat); c[t]++; return completeB(c, secretB(g, seat));
  }
  /** Special wins with kings (house rules), open to every player, purro or not, and paid double:
      seven kings = any seven kings; prinsesa = exactly four kings, one of each suit, and no other kings;
      rub = three or four kings of the same suit.
      They count at any time (as dealt or straight after a stock draw), in the hand or in laid secrets. */
  function kingCount(g, seat, t) {
    let n = 0; for (const id of poolIds(g, seat)) if (cardType(id) === t) n++;
    for (const s of g.secrets[seat]) for (const id of s.cards) if (cardType(id) === t) n++;
    return n;
  }
  function kingWin(g, seat) {
    const ids = poolIds(g, seat); for (const s of g.secrets[seat]) ids.push(...s.cards);
    const suits = new Set(), per = {}; let n = 0, most = 0;
    for (const id of ids) { const t = cardType(id); if (isKingType(t)) { n++; suits.add(suitOf(t)); per[t] = (per[t] || 0) + 1; most = Math.max(most, per[t]); } }
    if (n >= 7) return 'sevenkings';
    if (n === 4 && suits.size === 4) return 'prinsesa';
    if (most >= 3) return 'rub';
    return null;
  }
  /** Rub from a shown stock card: another player holding two of that king claims the third and wins. */
  function rubClaimant(g, seat, id) {
    const t = cardType(id); if (!isKingType(t)) return null;
    for (let k = 1; k < 4; k++) { const p = (seat + k) % 4; if (kingCount(g, p, t) >= 2) return p; }
    return null;
  }
  /** The grouping the hints and Auto-group use for a seat. */
  function planFor(g, seat) { return keepPlanB(poolCounts(g, seat), slotsFor(g, seat), secretB(g, seat)); }
  function topDiscard(g) { return g.discards.length ? g.discards[g.discards.length - 1] : null; }
  function purroAmongOthers(g, seat) { for (let p = 0; p < 4; p++) if (p !== seat && g.purro[p]) return true; return false; }
  function currentClaimant(g) { return g.timeOffer ? g.timeOffer.claimants[g.timeOffer.index] : null; }
  /** A player whose purro was broken may not win (or announce purro) for two turns. */
  function mayWin(g, seat) { return g.penalty[seat] === 0; }

  /** What `seat` may do right now. */
  function legalActions(g, seat) {
    const a = { drawStock: false, takeDiscard: false, endHand: false, discard: false, secrets: [], timeClaim: false, rubChoice: false, declareRub: false };
    if (g.phase === 'rubOffer' && g.rubOffer && g.rubOffer.seat === seat) { a.rubChoice = true; return a; }
    if (g.rubWait && g.rubWait[seat] && g.turn === seat && (g.phase === 'draw' || g.phase === 'discard') && maxSameKing(g, seat) >= 3) a.declareRub = true;
    if (g.phase === 'draw' && g.turn === seat) {
      const top = topDiscard(g);
      a.drawStock = g.stock.length > 0;
      // House rule: you only win with a card from the stock, so a discard that would complete your hand stays on the pile.
      a.takeDiscard = top != null && g.stock.length > 0 && !completesWith(g, seat, cardType(top));
      a.endHand = g.stock.length === 0;
    } else if (g.phase === 'discard' && g.turn === seat) {
      a.discard = true;
      a.secrets = secretOptions(g, seat);
    } else if (g.phase === 'timeOffer' && currentClaimant(g) === seat) {
      a.timeClaim = true;
    }
    return a;
  }

  function drawStock(g, seat) {
    assert(g.phase === 'draw' && g.turn === seat, 'not your turn to draw');
    assert(g.stock.length > 0, 'the stock is empty');
    const id = g.stock.pop();
    g.hands[seat].push(id); g.drawn = id; g.drawnFrom = 'stock'; g.phase = 'discard';
    const shown = purroAmongOthers(g, seat) || g.penalty[seat] > 0;
    g.lastShown = shown ? { seat, id } : null;
    if (shown) { markSeen(g, id); log(g, g.names[seat] + ' draws the ' + cardName(cardType(id)) + ' and shows it' + (g.penalty[seat] > 0 ? ' (the turns after a broken purro)' : ' (someone is purro)') + '.', 'draw'); }
    else log(g, g.names[seat] + ' draws from the stock.', 'draw');
    const kw = specialNow(g, seat);
    if (kw) { finishWin(g, seat, 'stock', id, kw); return; }
    if (mayWin(g, seat) && isComplete(g, seat)) { finishWin(g, seat, 'stock', id, kingWin(g, seat) || undefined); return; }
    if (shown) {
      const rp = rubClaimant(g, seat, id);
      if (rp != null) {
        const h = g.hands[seat]; h.splice(h.indexOf(id), 1);
        g.hands[rp].push(id); g.drawn = id; g.drawnFrom = 'claim';
        log(g, g.names[rp] + ' claims the shown ' + cardName(cardType(id)) + ' for a rub.', 'time');
        finishWin(g, rp, 'claim', id, 'rub'); return;
      }
      const t = cardType(id), claimants = [];
      for (let k = 1; k < 4; k++) { const p = (seat + k) % 4; if (g.purro[p] && g.waiting[p].indexOf(t) >= 0) claimants.push(p); }
      if (claimants.length) { g.phase = 'timeOffer'; g.timeOffer = { card: id, from: seat, claimants, index: 0 }; }
    }
  }

  /** The current claimant of a shown card says "time" (accept) or lets it go. */
  function resolveTime(g, accept) {
    assert(g.phase === 'timeOffer' && g.timeOffer, 'no time claim pending');
    const o = g.timeOffer, p = o.claimants[o.index];
    if (accept) {
      const h = g.hands[o.from]; h.splice(h.indexOf(o.card), 1);
      g.hands[p].push(o.card); g.drawn = o.card; g.drawnFrom = 'time'; g.timeOffer = null;
      log(g, g.names[p] + ' says "time!" and claims the ' + cardName(cardType(o.card)) + '.', 'time');
      finishWin(g, p, 'time', o.card, kingWin(g, p) || undefined);   // a complete hand that also holds a rub is paid as the rub
    } else {
      log(g, g.names[p] + ' lets the ' + cardName(cardType(o.card)) + ' go.', 'time');
      o.index++;
      if (o.index >= o.claimants.length) { g.timeOffer = null; g.phase = 'discard'; }
    }
  }

  function takeDiscard(g, seat) {
    assert(g.phase === 'draw' && g.turn === seat, 'not your turn to draw');
    const top = topDiscard(g);
    assert(top != null, 'nothing to take');
    assert(g.stock.length > 0, 'the stock is empty');
    assert(!completesWith(g, seat, cardType(top)), 'you can only win with a card from the stock, not with a discard');
    const id = g.discards.pop(); g.discardedBy.pop();
    for (let i = g.history.length - 1; i >= 0; i--) if (g.history[i].id === id) { g.history[i].takenBy = seat; break; }
    g.hands[seat].push(id); g.drawn = id; g.drawnFrom = 'discard'; g.phase = 'discard';
    log(g, g.names[seat] + ' takes the ' + cardName(cardType(id)) + ' from the discard pile.', 'draw');
  }

  /** Secrets `seat` could lay down now: four identical cards, or the three cards identical to the sowee plus any fourth card. */
  function secretOptions(g, seat) {
    if (g.phase !== 'discard' || g.turn !== seat) return [];
    const c = handCounts(g, seat), res = [];
    for (let t = 0; t < NTYPES; t++) if (c[t] >= 4) res.push({ type: t, kind: 'four' });
    const w = cardType(g.sowee);
    if (c[w] >= 3 && g.hands[seat].length >= 4) res.push({ type: w, kind: 'sowee' });
    return res;
  }

  function declareSecret(g, seat, type, extraId) {
    const opt = secretOptions(g, seat).filter(o => o.type === type)[0];
    assert(opt, 'no such secret');
    const need = opt.kind === 'four' ? 4 : 3;
    const h = g.hands[seat], cards = [];
    for (let i = h.length - 1; i >= 0 && cards.length < need; i--) if (cardType(h[i]) === type) cards.push(h.splice(i, 1)[0]);
    let extra = null;
    if (opt.kind === 'sowee') {
      assert(extraId != null && h.indexOf(extraId) >= 0, 'choose a fourth card from your hand');
      h.splice(h.indexOf(extraId), 1); extra = extraId;
    }
    g.secrets[seat].push({ cards, kind: opt.kind, type, extra });
    // House pricing: a secret is paid with the win (50 each), not when it is laid down.
    log(g, g.names[seat] + ' lays down a secret' + (opt.kind === 'sowee' ? ' (the three cards matching the sowee, with a fourth card that still has to be melded)' : '') + '.', 'secret');
    if (mayWin(g, seat) && isComplete(g, seat)) finishWin(g, seat, g.drawnFrom || 'deal', g.drawn, kingWin(g, seat) || undefined);
  }

  function discard(g, seat, id) {
    assert(g.phase === 'discard' && g.turn === seat, 'not your turn to discard');
    const h = g.hands[seat], i = h.indexOf(id);
    assert(i >= 0, 'card not in hand');
    assert(!isKing(id), 'kings may not be discarded');
    h.splice(i, 1); g.discards.push(id); g.discardedBy.push(seat); g.history.push({ seat, type: cardType(id), id }); markSeen(g, id);
    g.drawn = null; g.drawnFrom = null; g.lastShown = null;
    log(g, g.names[seat] + ' discards the ' + cardName(cardType(id)) + '.', 'discard');
    if (g.penalty[seat] > 0) {
      g.penalty[seat]--; g.purro[seat] = false; g.waiting[seat] = []; g.marker[seat] = null;
      if (g.penalty[seat] === 0) log(g, g.names[seat] + ' has served the two turns after the broken purro and plays normally again.', 'purro');
    } else updatePurro(g, seat);
    g.turn = (seat + 1) % 4; g.phase = 'draw'; g.turnCount++;
  }

  function updatePurro(g, seat) {
    const c = poolCounts(g, seat), slots = slotsFor(g, seat);
    const w = waitingTypes(c, slots, secretB(g, seat)), was = g.purro[seat];
    g.waiting[seat] = w; g.purro[seat] = w.length > 0;
    if (g.purro[seat]) {
      let m = null; for (const id of g.hands[seat]) if (isKing(id)) { m = id; break; }
      g.marker[seat] = m;
      if (!was) log(g, g.names[seat] + ' says "purro" — one card away from winning!', 'purro');
    } else {
      g.marker[seat] = null;
      if (was) { g.penalty[seat] = 2; log(g, g.names[seat] + ' is no longer purro: for the next two turns every card drawn is shown, and no purro or win is allowed.', 'purro'); }
    }
  }

  function endHandDraw(g) {
    assert(g.phase === 'draw' && g.stock.length === 0, 'the hand can only end when the stock is empty');
    g.phase = 'over'; g.result = { type: 'draw' }; g.nextDealer = g.dealer; g.draws++; g.handsPlayed++;
    log(g, 'The stock is exhausted: the hand is a draw and nobody pays.', 'over');
  }

  // ---------- Scoring ----------
  /** Do two other cards in `c` "go with" type t? A run in the same suit, or for an ace two other aces of different suits. */
  function goesWith(c, t) {
    const s = suitOf(t), r = rankOf(t);
    if (r === ACE) { let n = 0; for (let s2 = 0; s2 < 4; s2++) if (s2 !== s && c[typeOf(s2, ACE)] > 0) n++; return n >= 2; }
    const lo = r <= 3 ? 1 : 4;
    for (let r2 = lo; r2 < lo + 3; r2++) if (r2 !== r && c[typeOf(s, r2)] === 0) return false;
    return true;
  }

  // ---------- Pricing (house rules) ----------
  // Each opponent pays a starting price plus points for what the winning hand holds.
  const PRICE = { fourKings: 1000, top: 500, regular: 200, king: 5, baksyo: 5, kingBaksyo: 10, pong: 20, fourAces: 10, threeAces: 5, setOfFour: 5, secret: 50, sowee: 20 };
  /** Points one combination adds (kings are counted separately, 5 each). Every run is a baksyo:
      3-4-5 adds 5, jack-horse-king (a king used as the baksyo) adds 10. */
  function groupPoints(gp) {
    const n = gp.types.length, r = Math.min(...gp.types.map(rankOf));
    if (gp.kind === 'run') return r === 1 ? PRICE.baksyo : PRICE.kingBaksyo;
    const aces = r === ACE ? (n >= 4 ? PRICE.fourAces : PRICE.threeAces) : 0;
    if (gp.kind === 'pong') return PRICE.pong + aces;
    if (gp.kind === 'set') return r === ACE ? aces : n >= 4 ? PRICE.setOfFour : 0;
    return 0;
  }
  /** The arrangement of the cards worth the most points. needB: it must include a baksyo;
      loose: cards may be left over (special king wins come before the hand is finished). */
  function bestScoring(counts, needB, loose) {
    const c = counts.slice(), memo = new Map();
    function rec(gotB) {
      let t = 0; while (t < NTYPES && c[t] === 0) t++;
      if (t === NTYPES) return needB && !gotB ? null : { pts: 0, groups: [] };
      const key = c.join('') + (gotB ? 'b' : '');
      if (memo.has(key)) return memo.get(key);
      let best = null;
      const s = suitOf(t), r = rankOf(t);
      const tryG = (types, kind) => {
        for (const x of types) c[x]--;
        const gp = { types: types.slice(), kind };
        const sub = rec(gotB || (kind !== 'king' && isBaksyo(types)));
        for (const x of types) c[x]++;
        if (sub) { const pts = groupPoints(gp) + sub.pts; if (!best || pts > best.pts) best = { pts, groups: [gp].concat(sub.groups) }; }
      };
      if (r === KING) tryG([t], 'king');                // kings stand alone (or sit in a jack-horse-king run)
      else {
        if (c[t] >= 4) tryG([t, t, t, t], 'pong');
        if (c[t] >= 3) tryG([t, t, t], 'pong');
        const o = [];
        for (let s2 = s + 1; s2 < 4; s2++) if (c[typeOf(s2, r)] > 0) o.push(typeOf(s2, r));
        for (let a = 0; a < o.length; a++) for (let b = a + 1; b < o.length; b++) {
          tryG([t, o[a], o[b]], 'set');
          for (let d = b + 1; d < o.length; d++) tryG([t, o[a], o[b], o[d]], 'set');
        }
        if ((r === 1 || r === 4) && c[t + 1] > 0 && c[t + 2] > 0) tryG([t, t + 1, t + 2], 'run');
      }
      if (loose) { c[t]--; const sub = rec(gotB); c[t]++; if (sub && (!best || sub.pts > best.pts)) best = sub; }
      memo.set(key, best);
      return best;
    }
    return rec(false);
  }
  /** Price of a win for `seat`: starting price + kings + combinations + secrets. */
  function priceWin(g, seat, special, bounitId) {
    const pool = poolCounts(g, seat), hb = secretB(g, seat);
    const secretCards = []; for (const s of g.secrets[seat]) for (const id of s.cards) secretCards.push(id);
    const all = countsOf(poolIds(g, seat).concat(secretCards));
    let kings = 0, sameKing = 0;
    for (let s = 0; s < 4; s++) { const k = all[typeOf(s, KING)]; kings += k; sameKing = Math.max(sameKing, k); }
    let best = bestScoring(pool, !special && needsBaksyo(pool, hb), !!special) || { pts: 0, groups: [] };
    // House rule: winning with the king that finishes a jack-horse-king baksyo (any suit) also starts at 500.
    let kingBaksyo = false;
    const bt = bounitId != null ? cardType(bounitId) : null;
    if (!special && bt != null && isKingType(bt) && kings > 1 && sameKing < 4) {
      const J = typeOf(suitOf(bt), 4), H = typeOf(suitOf(bt), 5);
      if (pool[J] > 0 && pool[H] > 0 && pool[bt] > 0) {
        const rest = pool.slice(); rest[J]--; rest[H]--; rest[bt]--;
        const sub = bestScoring(rest, false, false);
        if (sub) {
          const run = { types: [J, H, bt], kind: 'run' };
          best = { pts: groupPoints(run) + sub.pts, groups: [run].concat(sub.groups) };
          kingBaksyo = true;
        }
      }
    }
    const groups = best.groups.slice();
    // anything a special win leaves unmelded is shown as the rest of the hand
    const left = pool.slice(); for (const gp of groups) for (const t of gp.types) left[t]--;
    const leftTypes = []; for (let t = 0; t < NTYPES; t++) for (let i = 0; i < left[t]; i++) leftTypes.push(t);
    groups.sort((a, b) => (a.kind === 'king') - (b.kind === 'king'));
    if (!special) { const bi = kingBaksyo ? 0 : groups.findIndex(gp => gp.kind !== 'king' && isBaksyo(gp.types)); if (bi >= 0) groups[bi] = Object.assign({}, groups[bi], { baksyo: true }); }
    if (leftTypes.length) groups.push({ types: leftTypes, kind: 'rest' });
    const count = { run345: 0, runJHK: 0, pong: 0, fourAces: 0, threeAces: 0, setOfFour: 0 };
    for (const gp of best.groups) {
      const n = gp.types.length, r = Math.min(...gp.types.map(rankOf));
      if (gp.kind === 'run') { if (r === 1) count.run345++; else count.runJHK++; }
      if (gp.kind === 'pong') count.pong++;
      if ((gp.kind === 'pong' || gp.kind === 'set') && r === ACE) { if (n >= 4) count.fourAces++; else count.threeAces++; }
      if (gp.kind === 'set' && r !== ACE && n >= 4) count.setOfFour++;
    }
    const startKind = sameKing >= 4 ? 'fourKings' : special ? special : kings === 0 ? 'nokings' : kings === 1 ? 'oneking' : kingBaksyo ? 'kingBaksyo' : 'regular';
    const start = sameKing >= 4 ? PRICE.fourKings : (special || kings <= 1 || kingBaksyo) ? PRICE.top : PRICE.regular;
    const items = [
      { key: 'kings', count: kings, each: PRICE.king },
      { key: 'run345', count: count.run345, each: PRICE.baksyo },
      { key: 'runJHK', count: count.runJHK, each: PRICE.kingBaksyo },
      { key: 'pong', count: count.pong, each: PRICE.pong },
      { key: 'fourAces', count: count.fourAces, each: PRICE.fourAces },
      { key: 'threeAces', count: count.threeAces, each: PRICE.threeAces },
      { key: 'setOfFour', count: count.setOfFour, each: PRICE.setOfFour },
      { key: 'secrets', count: g.secrets[seat].length, each: PRICE.secret },
      { key: 'sowee', count: g.sowee != null ? all[cardType(g.sowee)] : 0, each: PRICE.sowee },   // each card identical to the sowee
    ].filter(x => x.count > 0).map(x => Object.assign(x, { amount: x.count * x.each }));
    let per = start; for (const x of items) per += x.amount;
    return { groups, kings, start, startKind, items, per };
  }

  function finishWin(g, seat, source, bounitId, special) {
    const pr = priceWin(g, seat, special, bounitId), per = pr.per;
    const opp = opponentsOf(seat);
    for (const p of opp) { g.balances[p] -= per; g.balances[seat] += per; }
    g.phase = 'over'; g.wins[seat]++; g.handsPlayed++; g.nextDealer = g.dealRule === 'right' ? (g.dealer + 1) % 4 : seat; // normally the winner deals the next hand
    g.result = { type: 'win', winner: seat, source, special: special || null, bounit: bounitId, groups: pr.groups, secrets: g.secrets[seat].slice(),
      kings: pr.kings, porbis: pr.kings === 0, start: pr.start, startKind: pr.startKind, items: pr.items, extraDraws: [],
      fromStock: source !== 'time', perOpponent: per, opponents: opp, total: per * opp.length };
    if (special) {
      const what = special === 'prinsesa' ? 'Prinsesa! ' + g.names[seat] + ' holds one king of every suit and no other kings'
        : special === 'rub' ? 'Rub! ' + g.names[seat] + ' holds ' + (pr.startKind === 'fourKings' ? 'four' : 'three') + ' kings of the same suit'
        : 'Seven kings! ' + g.names[seat] + ' holds seven kings';
      log(g, what + ' and wins, collecting ' + money(per) + ' from each opponent.', 'over'); return;
    }
    log(g, 'Cuajo! ' + g.names[seat] + ' wins and collects ' + money(per) + ' from each opponent.', 'over');
  }

  // ---------- AI ----------
  /** Dealt three kings of one suit: the computer takes the sure rub rather than hoping for the last copy. */
  function aiChooseRub(g, seat) { return true; }
  /** Best distance reachable from a full hand by discarding one non-king card; `avail` limits the discardable types. */
  function bestDiscardDistance(c, slots, avail, hasB) {
    avail = avail || c;
    let best = Infinity;
    for (let d = 0; d < NTYPES; d++) if (avail[d] > 0 && !isKingType(d)) {
      c[d]--; const v = distance(c, slots, hasB); c[d]++;
      if (v < best) best = v;
    }
    return best;
  }

  // ---------- human-like mistakes ----------
  // Chance per decision that a computer player slips up. Easy players slip often, Hard players never.
  const DIFFICULTY = { easy: 0.34, normal: 0.16, hard: 0 };
  /** Sets how often the computer players (every seat except the human's) make mistakes. */
  function setDifficulty(g, level) {
    const m = DIFFICULTY[level] !== undefined ? DIFFICULTY[level] : DIFFICULTY.normal;
    g.difficulty = DIFFICULTY[level] !== undefined ? level : 'normal';
    const people = Array.isArray(g.humans) ? g.humans : [g.human];
    g.mistakes = [0, 1, 2, 3].map(s => (people.indexOf(s) >= 0 ? 0 : m));
  }
  function mistakeRate(g, seat) { return (g.mistakes && g.mistakes[seat]) || 0; }
  /** True with probability rate x scale; draws from the game's own random stream only when mistakes are possible. */
  function slip(g, seat, scale) { const m = mistakeRate(g, seat) * (scale === undefined ? 1 : scale); return m > 0 && nextRand(g) < m; }

  function aiChooseDraw(g, seat) {
    const pool = poolCounts(g, seat), hand = handCounts(g, seat), slots = slotsFor(g, seat), top = topDiscard(g);
    if (top == null) return g.stock.length ? 'stock' : 'end';
    const t = cardType(top);
    if (!g.stock.length) return 'end';
    if (completesWith(g, seat, t)) return 'stock';                        // you cannot win with a discard
    const hb = secretB(g, seat);
    pool[t]++; hand[t]++;
    const dTake = bestDiscardDistance(pool, slots, hand, hb);
    pool[t]--; hand[t]--;
    const dNow = distance(pool, slots, hb);
    if (dTake < dNow) return slip(g, seat) ? 'stock' : 'discard';        // sometimes misses a useful discard
    if (dTake === dNow && slip(g, seat, 0.4)) return 'discard';          // takes a card on a hunch
    return 'stock';
  }
  /** Whether a computer player notices that a shown card completes its hand and calls "time". */
  function aiClaimsTime(g, seat) { return !slip(g, seat, 0.4); }

  function aiChooseSecret(g, seat) {
    const opts = secretOptions(g, seat);
    if (!opts.length) return null;
    const four = opts.filter(o => o.kind === 'four')[0];
    if (four) return { type: four.type, extraId: null };
    const o = opts[0]; // three cards matching the sowee + a fourth card that stays in the pool but can never be discarded
    const pool = poolCounts(g, seat), hand = handCounts(g, seat), slots = slotsFor(g, seat);
    const hb = secretB(g, seat), hb2 = hb || rankOf(o.type) === ACE;
    const dNow = bestDiscardDistance(pool, slots, hand, hb);
    pool[o.type] -= 3; hand[o.type] -= 3;
    let best = null;
    for (let e = 0; e < NTYPES; e++) if (hand[e] > 0) {
      hand[e]--;
      const v = (sum(pool) === slots - 3 && completeB(pool, hb2)) ? -1 : bestDiscardDistance(pool, slots - 3, hand, hb2);
      hand[e]++;
      const score = v - (isKingType(e) ? 0.5 : 0); // a king is the natural fourth card: a combination by itself
      if (!best || score < best.score) best = { e, score, v };
    }
    if (!best || best.v > dNow) return null;
    let extraId = null;
    for (const id of g.hands[seat]) if (cardType(id) === best.e) { extraId = id; break; }
    return { type: o.type, extraId };
  }

  function aiChooseDiscard(g, seat) {
    const pool = poolCounts(g, seat), hand = handCounts(g, seat), slots = slotsFor(g, seat), hb = secretB(g, seat);
    let cands = [], bestD = Infinity;
    for (let d = 0; d < NTYPES; d++) if (hand[d] > 0 && !isKingType(d)) {
      pool[d]--; const v = distance(pool, slots, hb); pool[d]++;
      cands.push({ d, v }); if (v < bestD) bestD = v;
    }
    let tied = cands.filter(x => x.v === bestD);
    const m = mistakeRate(g, seat);
    if (m > 0 && cands.length > 1) {
      let from = null;
      if (m >= 0.3 && slip(g, seat, 0.2)) from = cands;                   // a careless throw: any card that is not a king
      else if (slip(g, seat)) {                                            // throws away a slightly worse card
        from = cands.filter(x => x.v === bestD + 1);
        if (!from.length) from = cands.filter(x => x.v > bestD);
      } else if (slip(g, seat, 1.5)) from = tied;                          // right idea, but skips the careful tie-breaks
      if (from && from.length) { const pick = from[randInt(g, from.length)].d; for (const id of g.hands[seat]) if (cardType(id) === pick) return id; }
    }
    if (tied.length > 1) { // prefer the discard that leaves the most live draws
      for (const x of tied) {
        pool[x.d]--; const u = usefulTypes(pool, slots, hb); pool[x.d]++;
        x.outs = 0; for (const t of u) x.outs += Math.max(0, 4 - g.seen[t] - pool[t]);
      }
      const bo = Math.max.apply(null, tied.map(x => x.outs)); tied = tied.filter(x => x.outs === bo);
    }
    if (tied.length > 1) { // prefer cards that are already visible; avoid feeding a purro opponent on our right
      const next = (seat + 1) % 4, danger = g.purro[next] && next !== partnerOf(seat);
      for (const x of tied) {
        x.safe = g.seen[x.d];
        if (danger) for (const h of g.history) if (h.seat === next && h.type === x.d) { x.safe += 3; break; }
      }
      const bs = Math.max.apply(null, tied.map(x => x.safe)); tied = tied.filter(x => x.safe === bs);
    }
    const pick = tied[randInt(g, tied.length)].d;
    for (const id of g.hands[seat]) if (cardType(id) === pick) return id;
    return null;
  }

  /** Hints for a seat: distance, waiting/useful cards, best discard, the grouping plan, and whether a baksyo is in place. */
  const hintMemo = new Map();
  function analyze(g, seat) {
    const pool = poolCounts(g, seat), hand = handCounts(g, seat), slots = slotsFor(g, seat), n = poolIds(g, seat).length, hb = secretB(g, seat);
    const key = pool.join('') + '|' + hand.join('') + '|' + slots + '|' + (hb ? 1 : 0) + '|' + g.penalty[seat];
    const hit = hintMemo.get(key); if (hit) return hit;
    const out = { n, slots, plan: keepPlanB(pool, slots, hb), penalty: g.penalty[seat], baksyo: hb || BAKSYO.some(B => hasAll(pool, B)), needB: needsBaksyo(pool, hb) };
    if (n === slots) {
      out.complete = completeB(pool, hb);
      let best = null;
      for (let d = 0; d < NTYPES; d++) if (hand[d] > 0 && !isKingType(d)) { pool[d]--; const v = distance(pool, slots, hb); pool[d]++; if (!best || v < best.distance) best = { type: d, distance: v }; }
      out.bestDiscard = best;
    } else if (n === slots - 1) {
      out.distance = distance(pool, slots, hb);
      out.waiting = waitingTypes(pool, slots, hb);
      out.useful = usefulTypes(pool, slots, hb);
    }
    if (hintMemo.size > 200) hintMemo.clear();
    hintMemo.set(key, out);
    return out;
  }

  return {
    SUITS, SUIT_LABEL, SUIT_ES, RANKS, RANK_LABEL, RANK_ES, ACE, KING, NTYPES, NCARDS, HAND, SECRET_PAY,
    setCurrency, typeOf, suitOf, rankOf, cardType, isKing, isKingType, cardName, partnerOf, opponentsOf, money, countsOf,
    canPartition, partition, bestKeep, distance, keepPlan, waitingTypes, usefulTypes, goesWith,
    BAKSYO, isBaksyo, completeB, partitionB, keepPlanB, bestKeepB, secretB, planFor, kingWin, kingCount, rubClaimant, resolveRub, declareRub, maxSameKing, specialNow, anyKing, needsBaksyo, PRICE, priceWin, bestScoring, groupPoints,
    newGame, startHand, nextHand, handCounts, poolIds, poolCounts, extrasOf, slotsFor, isComplete, completesWith, mayWin, topDiscard, currentClaimant, legalActions,
    drawStock, takeDiscard, resolveTime, secretOptions, declareSecret, discard, endHandDraw,
    aiChooseDraw, aiChooseRub, aiChooseSecret, aiChooseDiscard, aiClaimsTime, analyze, DIFFICULTY, setDifficulty, mistakeRate,
  };
});
