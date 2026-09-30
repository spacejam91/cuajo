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
  const SECRET_PAY = 50; // centavos paid by each opponent for a secret

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
  function money(cents) {
    const v = Math.abs(cents);
    return (cents < 0 ? '\u2212' : '') + CURRENCY + (v / 100).toFixed(2);
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
  /** True if every card in `counts` (28 ints) can be arranged into valid combinations. */
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
      if (!res && c[t] >= 4) res = attempt([t, t, t, t], 'secret');
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
    if (c[t] >= 4) ops.push({ types: [t, t, t, t], used: 4, kind: 'secret' });
    if (o.length === 3) ops.push({ types: [t, o[0], o[1], o[2]], used: 4, kind: 'set' });
    for (let i = 0; i < o.length; i++) for (let j = i + 1; j < o.length; j++) ops.push({ types: [t, o[i], o[j]], used: 3, kind: 'set' });
    if ((r === 1 || r === 4) && c[t + 1] > 0 && c[t + 2] > 0) ops.push({ types: [t, t + 1, t + 2], used: 3, kind: 'run' });
    // partial groups (one card short)
    if (c[t] >= 3) ops.push({ types: [t, t, t], used: 4, kind: 'secret3' });
    for (let i = 0; i < o.length; i++) ops.push({ types: [t, o[i]], used: 3, kind: 'set2' });
    if (r === 1 || r === 2 || r === 4 || r === 5) {
      const top = r <= 3 ? 3 : 6;
      for (let r2 = r + 1; r2 <= top; r2++) if (c[typeOf(s, r2)] > 0) ops.push({ types: [t, typeOf(s, r2)], used: 3, kind: 'run2' });
    }
    if (c[t] >= 2) ops.push({ types: [t, t], used: 4, kind: 'secret2' });
    // a single card kept as the start of a future set/run
    if (r !== KING) ops.push({ types: [t], used: 3, kind: 'seed' });
    // give the card up
    ops.push({ types: [t], used: 0, kind: 'drop', kept: 0 });
    for (const op of ops) if (op.kept === undefined) op.kept = op.types.length;
    return ops;
  }

  const keepMemo = new Map(); let keepSize = 0;
  /** Max number of cards of the hand that can be part of a complete hand using at most `slots` of its 16 places.
      Same option set as optionsAt(), written out inline for speed. */
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
      if (sl >= 4) {                                                                   // toward a secret
        if (c[t] >= 2) { dec(t); dec(t); v = 2 + rec(t, sl - 4); inc(t); inc(t); if (v > best) best = v; }
        if (c[t] >= 3) { dec(t); dec(t); dec(t); v = 3 + rec(t, sl - 4); inc(t); inc(t); inc(t); if (v > best) best = v; }
        if (c[t] >= 4) { dec(t); dec(t); dec(t); dec(t); v = 4 + rec(t, sl - 4); inc(t); inc(t); inc(t); inc(t); if (v > best) best = v; }
      }
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

  /** Cards still needed to complete the hand (a hand of slots-1 cards is 1 away when purro). */
  function distance(counts, slots) { return slots - bestKeep(counts, slots); }

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

  /** Cards still needed to complete the hand (a hand of slots-1 cards is 1 away when purro). */
  function distance(counts, slots) { return slots - bestKeep(counts, slots); }

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

  /** Types that would complete a hand of slots-1 cards. Non-empty means the player is "purro". */
  function waitingTypes(counts, slots) {
    if (sum(counts) !== slots - 1) return [];
    const res = [];
    for (let t = 0; t < NTYPES; t++) { counts[t]++; if (canPartition(counts)) res.push(t); counts[t]--; }
    return res;
  }

  /** Types that bring a hand of slots-1 cards closer to completion. */
  function usefulTypes(counts, slots) {
    const base = bestKeep(counts, slots); const res = [];
    for (let t = 0; t < NTYPES; t++) { if (counts[t] >= 4) continue; counts[t]++; if (bestKeep(counts, slots) > base) res.push(t); counts[t]--; }
    return res;
  }

  /** Best distance reachable from a full hand (slots cards) by discarding one non-king card. */
  function bestDiscardDistance(c, slots) {
    let best = Infinity;
    for (let d = 0; d < NTYPES; d++) if (c[d] > 0 && !isKingType(d)) {
      c[d]--; const v = distance(c, slots); c[d]++;
      if (v < best) best = v;
    }
    return best;
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
    g.turn = g.dealer; g.phase = 'discard'; g.turnCount = 0;
    log(g, 'Hand ' + g.handNo + ': ' + g.names[g.dealer] + ' deals. The sowee is the ' + cardName(cardType(g.sowee)) + '.', 'deal');
    if (isComplete(g, g.dealer)) finishWin(g, g.dealer, 'deal', null);
    return g;
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
  function isComplete(g, seat) { return poolIds(g, seat).length === slotsFor(g, seat) && canPartition(poolCounts(g, seat)); }
  function completesWith(g, seat, t) {
    if (poolIds(g, seat).length + 1 !== slotsFor(g, seat)) return false;
    const c = poolCounts(g, seat); c[t]++; return canPartition(c);
  }
  function topDiscard(g) { return g.discards.length ? g.discards[g.discards.length - 1] : null; }
  function purroAmongOthers(g, seat) { for (let p = 0; p < 4; p++) if (p !== seat && g.purro[p]) return true; return false; }
  function currentClaimant(g) { return g.timeOffer ? g.timeOffer.claimants[g.timeOffer.index] : null; }
  /** A player whose purro was broken may not win (or announce purro) for two turns. */
  function mayWin(g, seat) { return g.penalty[seat] === 0; }

  /** What `seat` may do right now. */
  function legalActions(g, seat) {
    const a = { drawStock: false, takeDiscard: false, endHand: false, discard: false, secrets: [], timeClaim: false };
    if (g.phase === 'draw' && g.turn === seat) {
      const top = topDiscard(g);
      a.drawStock = g.stock.length > 0;
      a.takeDiscard = top != null && (g.stock.length > 0 || (mayWin(g, seat) && completesWith(g, seat, cardType(top))));
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
    if (mayWin(g, seat) && isComplete(g, seat)) { finishWin(g, seat, 'stock', id); return; }
    if (shown) {
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
      finishWin(g, p, 'time', o.card);
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
    if (g.stock.length === 0) assert(mayWin(g, seat) && completesWith(g, seat, cardType(top)), 'with the stock empty the last discard may only be taken to win');
    const id = g.discards.pop(); g.discardedBy.pop();
    g.hands[seat].push(id); g.drawn = id; g.drawnFrom = 'discard'; g.phase = 'discard';
    log(g, g.names[seat] + ' takes the ' + cardName(cardType(id)) + ' from the discard pile.', 'draw');
    if (mayWin(g, seat) && isComplete(g, seat)) finishWin(g, seat, 'discard', id);
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
    for (const p of opponentsOf(seat)) { g.balances[p] -= SECRET_PAY; g.balances[seat] += SECRET_PAY; }
    log(g, g.names[seat] + ' lays down a secret' + (opt.kind === 'sowee' ? ' (the three cards matching the sowee, with a fourth card that still has to be melded)' : '') + ' and collects ' + money(SECRET_PAY) + ' from each opponent.', 'secret');
    if (mayWin(g, seat) && isComplete(g, seat)) finishWin(g, seat, g.drawnFrom || 'deal', g.drawn);
  }

  function discard(g, seat, id) {
    assert(g.phase === 'discard' && g.turn === seat, 'not your turn to discard');
    const h = g.hands[seat], i = h.indexOf(id);
    assert(i >= 0, 'card not in hand');
    assert(!isKing(id), 'kings may not be discarded');
    h.splice(i, 1); g.discards.push(id); g.discardedBy.push(seat); g.history.push({ seat, type: cardType(id) }); markSeen(g, id);
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
    const w = waitingTypes(c, slots), was = g.purro[seat];
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

  function finishWin(g, seat, source, bounitId) {
    const pool = poolCounts(g, seat);
    const groups = partition(pool) || [];
    const secretCards = []; for (const s of g.secrets[seat]) for (const id of s.cards) secretCards.push(id);
    const allIds = poolIds(g, seat).concat(secretCards);           // the winner's sixteen cards
    const all = countsOf(allIds);
    let kings = 0, kingsValue = 0;
    for (const id of allIds) { const t = cardType(id); if (isKingType(t)) { kings++; kingsValue += suitOf(t) === 0 ? 50 : 20; } }
    // porbis: no kings, or a single king that sits in a jack-horse-king run
    let porbis = kings === 0;
    if (kings === 1) {
      const kt = allIds.map(cardType).filter(isKingType)[0];
      if (pool[kt] === 1) {
        const s = suitOf(kt), J = typeOf(s, 4), H = typeOf(s, 5);
        if (pool[J] > 0 && pool[H] > 0) { const c2 = pool.slice(); c2[J]--; c2[H]--; c2[kt]--; if (canPartition(c2)) porbis = true; }
      }
    }
    const sw = cardType(g.sowee);
    const bt = bounitId != null ? cardType(bounitId) : null;
    const fromStock = source === 'stock' || source === 'deal';
    let cond1 = bt != null && goesWith(all, bt);
    let cond2 = all[sw] > 0 && goesWith(all, sw);
    // A bounit obtained from another player: if the conditions are not met from the hand, up to 15 extra
    // cards may be drawn from the stock to satisfy them (they need not be melded and add no king value).
    const extraDraws = [];
    if (!porbis && !fromStock && !(cond1 && cond2)) {
      while (extraDraws.length < 15 && g.stock.length) {
        const id = g.stock.pop(); extraDraws.push(id); all[cardType(id)]++;
        cond1 = bt != null && goesWith(all, bt); cond2 = all[sw] > 0 && goesWith(all, sw);
        if (cond1 && cond2) break;
      }
    }
    const base = (fromStock || (cond1 && cond2)) ? 110 : cond1 ? 60 : cond2 ? 70 : 20;
    const per = porbis ? 300 : base + kingsValue;
    const opp = opponentsOf(seat);
    for (const p of opp) { g.balances[p] -= per; g.balances[seat] += per; }
    g.phase = 'over'; g.wins[seat]++; g.handsPlayed++; g.nextDealer = g.dealRule === 'right' ? (g.dealer + 1) % 4 : seat; // normally the winner deals the next hand
    g.result = { type: 'win', winner: seat, source, bounit: bounitId, groups, secrets: g.secrets[seat].slice(), kings, kingsValue, porbis, cond1, cond2, base, fromStock, extraDraws, perOpponent: per, opponents: opp, total: per * opp.length };
    log(g, 'Cuajo! ' + g.names[seat] + ' wins and collects ' + money(per) + ' from each opponent' + (extraDraws.length ? ' after drawing ' + extraDraws.length + ' extra card' + (extraDraws.length === 1 ? '' : 's') + ' from the stock' : '') + '.', 'over');
  }

  // ---------- AI ----------
  /** Best distance reachable from a full hand by discarding one non-king card; `avail` limits the discardable types. */
  function bestDiscardDistance(c, slots, avail) {
    avail = avail || c;
    let best = Infinity;
    for (let d = 0; d < NTYPES; d++) if (avail[d] > 0 && !isKingType(d)) {
      c[d]--; const v = distance(c, slots); c[d]++;
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
    if (mayWin(g, seat) && completesWith(g, seat, t)) {
      if (g.stock.length && slip(g, seat, 0.3)) return 'stock';          // did not notice the winning card
      return 'discard';
    }
    if (!g.stock.length) return 'end';
    pool[t]++; hand[t]++;
    const dTake = bestDiscardDistance(pool, slots, hand);
    pool[t]--; hand[t]--;
    const dNow = distance(pool, slots);
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
    const dNow = bestDiscardDistance(pool, slots, hand);
    pool[o.type] -= 3; hand[o.type] -= 3;
    let best = null;
    for (let e = 0; e < NTYPES; e++) if (hand[e] > 0) {
      hand[e]--;
      const v = (sum(pool) === slots - 3 && canPartition(pool)) ? -1 : bestDiscardDistance(pool, slots - 3, hand);
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
    const pool = poolCounts(g, seat), hand = handCounts(g, seat), slots = slotsFor(g, seat);
    let cands = [], bestD = Infinity;
    for (let d = 0; d < NTYPES; d++) if (hand[d] > 0 && !isKingType(d)) {
      pool[d]--; const v = distance(pool, slots); pool[d]++;
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
        pool[x.d]--; const u = usefulTypes(pool, slots); pool[x.d]++;
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

  /** Hints for a seat: distance, waiting/useful cards, best discard and the grouping plan. */
  function analyze(g, seat) {
    const pool = poolCounts(g, seat), hand = handCounts(g, seat), slots = slotsFor(g, seat), n = poolIds(g, seat).length;
    const out = { n, slots, plan: keepPlan(pool, slots), penalty: g.penalty[seat] };
    if (n === slots) {
      out.complete = canPartition(pool);
      let best = null;
      for (let d = 0; d < NTYPES; d++) if (hand[d] > 0 && !isKingType(d)) { pool[d]--; const v = distance(pool, slots); pool[d]++; if (!best || v < best.distance) best = { type: d, distance: v }; }
      out.bestDiscard = best;
    } else if (n === slots - 1) {
      out.distance = distance(pool, slots);
      out.waiting = waitingTypes(pool, slots);
      out.useful = usefulTypes(pool, slots);
    }
    return out;
  }

  return {
    SUITS, SUIT_LABEL, SUIT_ES, RANKS, RANK_LABEL, RANK_ES, ACE, KING, NTYPES, NCARDS, HAND, SECRET_PAY,
    setCurrency, typeOf, suitOf, rankOf, cardType, isKing, isKingType, cardName, partnerOf, opponentsOf, money, countsOf,
    canPartition, partition, bestKeep, distance, keepPlan, waitingTypes, usefulTypes, goesWith,
    newGame, startHand, nextHand, handCounts, poolIds, poolCounts, extrasOf, slotsFor, isComplete, completesWith, mayWin, topDiscard, currentClaimant, legalActions,
    drawStock, takeDiscard, resolveTime, secretOptions, declareSecret, discard, endHandDraw,
    aiChooseDraw, aiChooseSecret, aiChooseDiscard, aiClaimsTime, analyze, DIFFICULTY, setDifficulty, mistakeRate,
  };
});
