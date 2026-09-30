/* Cuajo — table UI and game controller. Depends on window.Cuajo (engine.js). */
(function () {
  'use strict';
  const C = window.Cuajo;
  let ME = 0;                            // the seat shown at the bottom: you (in pass-and-play, whoever has the computer)
  const PAGES_URL = 'https://spacejam91.github.io/cuajo/';
  const SEAT_CLASS = ['south', 'east', 'north', 'west'];   // screen positions, counted from your seat to the right
  const DEFAULT_SETTINGS = { names: ['You', 'Nena', 'Jun', 'Lola Baby'], speed: 'realistic', hints: true, openHands: false, sortMode: 'suit', difficulty: 'normal', sound: true, cardSize: 'medium', felt: 'green', back: 'red', currency: 'peso', newCards: 'end', dealRule: 'winner', v: 2 };
  // pace multipliers for thinking pauses and card movements ('instant' is for automated testing)
  const PACE = { slow: 1.35, realistic: 1, normal: 0.6, fast: 0.3, instant: 0 };
  const STORE_KEY = 'cuajo.v1';
  const SVG_NS = 'http://www.w3.org/2000/svg';

  let g = null;
  let settings = Object.assign({}, DEFAULT_SETTINGS);
  let selIds = [];         // cards you have clicked (selected), in the order you clicked them
  let groupOf = {};        // card id -> group number, for cards you have grouped together
  let nextGid = 1;
  let dealing = false, dealToken = 0;
  let bubbles = {};        // seat -> speech bubble ("Purro!", "Cuajo!", ...)
  let pendingFn = null, skipWait = null, rush = false;   // for the Next move button
  const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let pickExtra = null;    // choosing the fourth card for a sowee secret: the secret's type
  let handOrder = [];      // your cards in the order you arranged them (card ids)
  let orderHand = 0;       // the hand number that order belongs to
  let drag = null;         // a card being dragged in your hand
  let suppressClick = false, handDirty = false;
  const COARSE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  let modal = null;        // 'result' | 'time' | 'rules' | 'settings' | null
  let notice = '';         // transient message shown in the status line
  let confirmReset = false;
  let resultShown = false;  // the result dialog opens once per hand; afterwards 'Show result' brings it back
  let timer = 0, gen = 0, noticeTimer = 0;
  let mode = 'solo';       // 'solo' | 'local' (pass-and-play on one computer) | 'host' | 'guest' (online)
  let humanNames = {};     // seat -> name, for friends playing a seat
  let layouts = {};        // pass-and-play: each person's own hand arrangement
  let handHidden = false, promptSeat = null;   // pass-and-play: cards covered between turns
  let net = null;          // online connection
  let lastMove = null;     // the last move, so the other computer can animate it too
  const friendUi = { error: '', joinCode: '' };

  function humansOf() { return (g && Array.isArray(g.humans) && g.humans.length) ? g.humans : [0]; }
  function isHuman(s) { return humansOf().indexOf(s) >= 0; }
  /** A person playing on this computer. */
  function isLocalHuman(s) {
    if (!isHuman(s)) return false;
    if (mode === 'guest') return s === ME;
    if (mode === 'local') return true;
    return s === 0;
  }
  /** Screen position of a seat: you are always at the bottom, the others follow to the right. */
  function posClass(seat) { return SEAT_CLASS[(seat - ME + 4) % 4]; }
  function others() { return [1, 2, 3].map(k => (ME + k) % 4); }
  function applyNames() {
    if (!g || mode === 'guest') return;
    g.names = settings.names.map((n, i) => (i !== 0 && humanNames[i]) ? humanNames[i] : n);
    if (mode !== 'solo' && g.names[0] === 'You') g.names[0] = 'Player 1';   // "You's turn" reads badly with two people
  }

  const $ = s => document.querySelector(s);
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function btn(label, onClick, cls, disabled) { const b = el('button', 'btn' + (cls ? ' ' + cls : '')); b.type = 'button'; b.append(label); b.disabled = !!disabled; b.addEventListener('click', onClick); if (typeof label === 'string') b.dataset.key = 'btn-' + label; return b; }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  function byType(a, b) { return C.cardType(a) - C.cardType(b) || a - b; }
  function name(seat) { return g.names[seat]; }
  const YOU_VERB = { draws: 'draw', discards: 'discard', takes: 'take', lets: 'let', lays: 'lay', says: 'say', has: 'have', is: 'are', wins: 'win', deals: 'deal' };
  /** Log lines are written as "<name> draws"; when your name is "You" that should read "You draw". */
  function youGrammar(msg) {
    if (name(ME) !== 'You') return msg;
    let out = msg.replace(/\bYou (draws|discards|takes|lets|lays|says|has|is|wins|deals)\b/g, (m, v) => 'You ' + YOU_VERB[v]);
    if (/^(Cuajo! )?You /.test(out)) out = out.replace(/ and (claims|shows|collects)\b/g, (m, v) => ' and ' + v.slice(0, -1));
    return out;
  }

  // ---------- cards ----------
  function suitIcon(s) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 40 40'); svg.setAttribute('aria-hidden', 'true');
    const u = document.createElementNS(SVG_NS, 'use'); u.setAttribute('href', '#s-' + C.SUITS[s]);
    svg.appendChild(u); return svg;
  }
  // Card faces are inline SVG in a 100x155 space, after the Fournier "Cuajo Filipino" pattern:
  // inner frame with the suit's "pintas" (0-3 breaks: coins, cups, swords, batons), corner
  // numbers 1/3/4/5 and 10 sota, 11 caballo, 12 rey, crossed swords and batons, ornate aces.
  const INDEX = ['1', '3', '4', '5', '10', '11', '12'];
  const SUIT_VARS = ['--robe:#d4392f;--trim:#4c8ccc', '--robe:#4c8ccc;--trim:#d4392f', '--robe:#5f9a43;--trim:#d4392f', '--robe:#d4392f;--trim:#5f9a43'];
  const EMBLEM = { 4: { cx: 74, cy: 70, size: 20, ly: 71, lh: 62 }, 5: { cx: 74, cy: 30, size: 19, ly: 36, lh: 56 }, 6: { cx: 73, cy: 78, size: 22, ly: 77, lh: 66 } };
  const isLong = suit => suit === 'swords' || suit === 'batons';
  function pipAt(suit, cx, cy, size) { return '<use href="#p-' + suit + '" x="' + (cx - size / 2) + '" y="' + (cy - size / 2) + '" width="' + size + '" height="' + size + '"/>'; }
  function longAt(suit, cx, cy, h, angle, dx) {
    const w = h * 24 / 110;
    return '<use href="#l-' + suit + '" x="' + (cx - w / 2) + '" y="' + (cy - h / 2) + '" width="' + w + '" height="' + h + '" transform="rotate(' + (angle || 0) + ' ' + cx + ' ' + cy + ') translate(' + (dx || 0) + ' 0)"/>';
  }
  function emblemAt(suit, cx, cy, size) { return isLong(suit) ? longAt(suit, cx, cy, size * 3, 0) : pipAt(suit, cx, cy, size); }
  function frame(s) {
    const x0 = 6, x1 = 94, y0 = 7, y1 = 148, gw = 6;
    const centers = s === 0 ? [] : s === 1 ? [50] : s === 2 ? [41, 59] : [35, 50, 65];
    let d = 'M' + x0 + ' ' + y0 + 'V' + y1 + 'M' + x1 + ' ' + y0 + 'V' + y1;
    for (const y of [y0, y1]) { let x = x0; for (const c of centers) { d += 'M' + x + ' ' + y + 'H' + (c - gw / 2); x = c + gw / 2; } d += 'M' + x + ' ' + y + 'H' + x1; }
    return '<path d="' + d + '" stroke="#2a2118" stroke-width="1.1" fill="none"/>';
  }
  function pipsLayout(suit, r) {
    const n = r + 2, cx = 50, cy = 77.5, H = 108;
    if (!isLong(suit)) {
      const S = 27;
      const three = suit === 'coins' ? [[33, 43], [50, 77.5], [67, 112]] : [[65, 43], [35, 77.5], [65, 112]]; // staircase / zig-zag as on the real 3s
      const pos = n === 3 ? three : n === 4 ? [[31, 49], [69, 49], [31, 106], [69, 106]] : [[31, 49], [69, 49], [31, 106], [69, 106], [50, 77.5]];
      return pos.map(q => pipAt(suit, q[0], q[1], S)).join('');
    }
    const knot = '<path d="M41 73c6 4 12 4 18 0v9c-6-3-12-3-18 0z" fill="#4c8ccc" stroke="#1f3f6b" stroke-width="1"/><path d="M42 81l-6 10M58 81l6 10" stroke="#4c8ccc" stroke-width="3" stroke-linecap="round"/>';
    if (n === 3) {
      if (suit === 'swords') return longAt(suit, 30, cy, H, 0) + longAt(suit, 70, cy, H, 0) + longAt(suit, cx, cy, H, 180); // two upright, the middle one reversed
      return longAt(suit, cx, cy, H, 24) + longAt(suit, cx, cy, H, -24) + longAt('batons-y', cx, cy, H, 0) + knot;
    }
    const lattice = longAt(suit, cx, cy, H, 26, -11) + longAt(suit, cx, cy, H, 26, 11) + longAt(suit, cx, cy, H, -26, -11) + longAt(suit, cx, cy, H, -26, 11);
    if (n === 4) {
      if (suit === 'swords') return longAt(suit, 34, 51, 72, 135) + longAt(suit, 66, 51, 72, 225) + longAt(suit, 34, 104, 72, 45) + longAt(suit, 66, 104, 72, -45);
      return lattice;
    }
    if (suit === 'swords') return longAt(suit, 31, 46, 66, 180) + longAt(suit, 69, 46, 66, 180) + longAt(suit, 31, 109, 66, 0) + longAt(suit, 69, 109, 66, 0) + longAt(suit, cx, cy, 84, 90);
    return lattice + longAt('batons-y', cx, cy, 84, 90);
  }
  function aceArt(suit) {
    if (suit === 'coins') return '<path d="M36 44l3-14 8 7 3-10 3 10 8-7 3 14z" fill="#f0c63f" stroke="#2a2118" stroke-width="1.2" stroke-linejoin="round"/><path d="M36 44h28" stroke="#d4392f" stroke-width="3"/><path d="M28 52c-10 10-12 30-6 50M72 52c10 10 12 30 6 50" fill="none" stroke="#d4392f" stroke-width="5" stroke-linecap="round"/><circle cx="50" cy="92" r="31" fill="#f0c63f" stroke="#2a2118" stroke-width="1.5"/><circle cx="50" cy="92" r="25" fill="none" stroke="#2a2118" stroke-width=".9" stroke-dasharray="2 1.5"/><circle cx="50" cy="92" r="12" fill="#d4392f" stroke="#2a2118" stroke-width="1"/><path d="M50 82l2.8 6 6.5.7-4.8 4.4 1.3 6.4L50 96.2l-5.8 3.3 1.3-6.4-4.8-4.4 6.5-.7z" fill="#f0c63f" stroke="#2a2118" stroke-width=".6"/><text x="50" y="74" text-anchor="middle" class="tiny">CUAJO</text><text x="50" y="114" text-anchor="middle" class="tiny">FILIPINO</text><path d="M22 128c8-6 14-8 28-8s20 2 28 8" fill="none" stroke="#5f9a43" stroke-width="2.5"/>';
    if (suit === 'cups') return '<path d="M32 46c0-14 36-14 36 0z" fill="#4c8ccc" stroke="#2a2118" stroke-width="1.2"/><circle cx="50" cy="31" r="3.5" fill="#d4392f" stroke="#2a2118" stroke-width="1"/><path d="M26 48h48v10c0 16-10 26-24 26S26 74 26 58z" fill="#f0c63f" stroke="#2a2118" stroke-width="1.4"/><path d="M27 54h46" stroke="#d4392f" stroke-width="4"/><path d="M38 62c3 6 3 10 0 14M50 62c3 6 3 10 0 14M62 62c3 6 3 10 0 14" fill="none" stroke="#d4392f" stroke-width="2.5" stroke-linecap="round"/><path d="M44 84h12l-2 8h-8z" fill="#4c8ccc" stroke="#2a2118" stroke-width="1"/><rect x="46" y="92" width="8" height="12" fill="#f0c63f" stroke="#2a2118" stroke-width="1"/><path d="M26 122c0-8 10-14 24-14s24 6 24 14z" fill="#f0c63f" stroke="#2a2118" stroke-width="1.4"/><path d="M30 118h40" stroke="#d4392f" stroke-width="3"/><path d="M26 122h48v5H26z" fill="#4c8ccc" stroke="#2a2118" stroke-width="1"/>';
    if (suit === 'swords') return longAt('swords', 50, 77.5, 124, 0) + '<path d="M32 58c12 10 24-10 36 0M32 88c12 10 24-10 36 0M32 118c12 8 24-8 36 0" fill="none" stroke="#d4392f" stroke-width="4" stroke-linecap="round"/><path d="M24 48c6-6 14-6 20 0M56 48c6-6 14-6 20 0" fill="none" stroke="#5f9a43" stroke-width="2"/>';
    return longAt('batons', 50, 77.5, 124, 0) + '<path d="M28 66c12 12 32-12 44 0M28 98c12 12 32-12 44 0" fill="none" stroke="#d4392f" stroke-width="4" stroke-linecap="round"/><path d="M22 130c8-10 16-14 28-14s20 4 28 14" fill="none" stroke="#5f9a43" stroke-width="2.5"/>';
  }
  function courtArt(suit, r, s) {
    const fig = r === 4 ? 'sota' : r === 5 ? 'caballo' : 'rey', a = EMBLEM[r];
    return '<use href="#fig-' + fig + '" width="100" height="155" style="' + SUIT_VARS[s] + '"/>' + (isLong(suit) ? longAt(suit, a.cx, a.ly, a.lh, 0) : pipAt(suit, a.cx, a.cy, a.size));
  }
  function faceSvg(t, mini) {
    const s = C.suitOf(t), r = C.rankOf(t), suit = C.SUITS[s], ix = INDEX[r];
    if (mini) return '<svg class="face" viewBox="0 0 100 155" aria-hidden="true"><text x="50" y="62" text-anchor="middle" class="ix big">' + ix + '</text>' + emblemAt(suit, 50, 110, 40) + '</svg>';
    const body = r === 0 ? aceArt(suit) : r <= 3 ? pipsLayout(suit, r) : courtArt(suit, r, s);
    const idx = '<text x="8" y="26" class="ix">' + ix + '</text>' + (isLong(suit) ? '' : pipAt(suit, 14, 39, 12));
    return '<svg class="face" viewBox="0 0 100 155" aria-hidden="true">' + frame(s) + body + '<g>' + idx + '</g><g transform="rotate(180 50 77.5)">' + idx + '</g></svg>';
  }
  function cardEl(t, o) {
    o = o || {};
    const d = el('div', 'card');
    if (o.mini) d.classList.add('mini');
    d.setAttribute('role', 'img');
    if (t == null) { d.classList.add('back'); d.setAttribute('aria-label', o.label || 'face-down card'); return d; }
    const s = C.suitOf(t), r = C.rankOf(t);
    d.classList.add('s-' + C.SUITS[s]);
    d.setAttribute('aria-label', C.cardName(t));
    d.title = C.cardName(t) + ' · ' + C.RANK_ES[r] + ' (' + INDEX[r] + ') de ' + C.SUIT_ES[s];
    d.innerHTML = faceSvg(t, !!o.mini);
    return d;
  }
  function miniRow(types) { const row = el('span', 'mini-row'); for (const t of types) row.append(cardEl(t, { mini: true })); return row; }
  function secretEl(s, reveal) {
    const w = el('div', 'secret');
    const st = el('div', 'stack');
    for (const id of s.cards) st.append(reveal ? cardEl(C.cardType(id), { mini: true }) : cardEl(null, { mini: true, label: 'secret card' }));
    if (s.extra != null) {
      const x = reveal ? cardEl(C.cardType(s.extra), { mini: true }) : cardEl(null, { mini: true, label: 'fourth card of the sowee secret' });
      x.classList.add('extra');
      x.title = (reveal ? C.cardName(C.cardType(s.extra)) + ': ' : '') + 'fourth card laid with the sowee secret; it still has to be part of a combination';
      st.append(x);
    }
    w.append(st, el('span', null, s.kind === 'sowee' ? 'sowee secret' : 'secret'));
    return w;
  }

  // ---------- sound (made on the fly, no audio files) ----------
  let actx = null, lastChime = '';
  const CARD_SIZE = { small: 0.86, medium: 1, large: 1.16 };
  function applyLook() {
    const r = document.documentElement;
    r.style.setProperty('--size', String(CARD_SIZE[settings.cardSize] || 1));
    r.dataset.felt = settings.felt || 'green';
    r.dataset.back = settings.back || 'red';
    C.setCurrency(settings.currency === 'dollar' ? '$' : '₱');
  }
  function sfx(kind) {
    if (!settings.sound || pace() === 0) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const a = actx, t = a.currentTime;
      if (kind === 'card') {                       // a short card snap: filtered noise
        const len = 0.06, buf = a.createBuffer(1, Math.floor(a.sampleRate * len), a.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
        const src = a.createBufferSource(), f = a.createBiquadFilter(), gn = a.createGain();
        src.buffer = buf; f.type = 'bandpass'; f.frequency.value = 2300; f.Q.value = 0.9; gn.gain.value = 0.3;
        src.connect(f); f.connect(gn); gn.connect(a.destination); src.start(t);
        return;
      }
      const notes = { turn: [784, 1047], purro: [659, 880, 988], time: [988, 784], secret: [587, 740], win: [523, 659, 784, 1047] }[kind] || [440];
      notes.forEach((fq, i) => {
        const o = a.createOscillator(), gn = a.createGain(), st = t + i * 0.11;
        o.type = 'sine'; o.frequency.value = fq;
        gn.gain.setValueAtTime(0.0001, st); gn.gain.exponentialRampToValueAtTime(0.16, st + 0.02); gn.gain.exponentialRampToValueAtTime(0.0001, st + 0.38);
        o.connect(gn); gn.connect(a.destination); o.start(st); o.stop(st + 0.42);
      });
    } catch (e) { /* sound is optional */ }
  }
  /** A soft chime once per turn when it becomes your move. */
  function chime() {
    if (!g || dealing || covered() || !isLocalHuman(ME) || g.turn !== ME) return;
    if (!(g.phase === 'draw' || (g.phase === 'discard' && g.turnCount === 0))) return;
    const k = g.handNo + ':' + g.turnCount;
    if (k !== lastChime) { lastChime = k; sfx('turn'); }
  }

  // ---------- persistence ----------
  function save() {
    if (mode === 'guest') return;                 // the host keeps the online game; your own game stays saved as it was
    if (mode === 'host') sendState();
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ g, settings, order: { ids: handOrder, hand: orderHand, groups: groupOf, next: nextGid }, multi: mode === 'local' ? { mode, humanNames } : null })); } catch (e) { /* storage unavailable */ }
  }
  function load() { try { const raw = localStorage.getItem(STORE_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }

  // ---------- control flow ----------
  function pace() { const p = PACE[settings.speed]; return p === undefined ? 1 : p; }
  /** A duration scaled by the chosen pace, with a little natural variation. */
  function secs(base, spread) { return Math.round((base + Math.random() * (spread || 0)) * pace()); }
  function wait(msec) { return new Promise(r => setTimeout(r, msec)); }
  /** Runs fn after a pause; Next move can cut the pause short. */
  function later(fn, delay) {
    clearTimeout(timer);
    const my = ++gen;
    const run = () => { if (pendingFn === run) pendingFn = null; if (my === gen) fn(); };
    pendingFn = run;
    timer = setTimeout(run, rush ? 0 : delay); rush = false;
  }
  /** A pause inside a turn (after "Purro!", before "Time!") that Next move can also cut short. */
  function pause(msec) {
    return new Promise(res => {
      const done = () => { clearTimeout(t); if (skipWait === done) skipWait = null; res(); };
      const t = setTimeout(done, rush ? 0 : msec); rush = false;
      skipWait = done;
    });
  }
  function waitingOnOthers() {
    if (!g || dealing) return false;
    if ((g.phase === 'draw' || g.phase === 'discard') && !isHuman(g.turn)) return true;
    if (g.phase === 'timeOffer') return !isHuman(C.currentClaimant(g));
    return g.phase === 'over' && !resultShown && !modal;
  }
  /** Next move: skip the thinking pause. The cards still move across the table; the deal always plays in full. */
  function skipAhead() {
    if (!waitingOnOthers()) return;
    if (mode === 'guest' && g.phase !== 'over') { send({ t: 'skip' }); return; }   // the host sets the pace
    if (skipWait) { skipWait(); return; }
    if (pendingFn) { clearTimeout(timer); pendingFn(); return; }
    rush = true;   // a card is moving right now: skip the pause after it
  }
  function changed() { save(); render(); drive(); }
  function flash(msg) { notice = msg; render(); clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { notice = ''; render(); }, 2200); }
  function rectOf(selector) { const n = $(selector); return n ? n.getBoundingClientRect() : null; }

  // ---------- table animation ----------
  /** Moves a card image along a path of screen rectangles. Face-down when t is null. */
  function flyPath(rects, t, offsets, dur) {
    rects = rects.filter(Boolean);
    if (rects.length < 2 || REDUCED || !(dur > 30)) return Promise.resolve();
    const base = rects.reduce((a, r) => (r.width > a.width ? r : a), rects[0]);
    const w = base.width || 60, h = base.height || 93;
    sfx('card');
    const node = cardEl(t == null ? null : t); node.classList.add('flying'); node.setAttribute('aria-hidden', 'true');
    node.style.width = w + 'px'; node.style.height = h + 'px';
    document.body.appendChild(node);
    const frames = rects.map((r, i) => ({
      transform: 'translate(' + r.left + 'px,' + r.top + 'px) scale(' + (r.width / w) + ',' + (r.height / h) + ')',
      offset: offsets ? offsets[i] : i / (rects.length - 1),
      easing: 'cubic-bezier(.3,.7,.3,1)',
    }));
    let anim;
    try { anim = node.animate(frames, { duration: dur, fill: 'forwards' }); } catch (e) { node.remove(); return Promise.resolve(); }
    return anim.finished.then(() => node.remove(), () => node.remove());
  }
  function fly(from, to, t, dur) { return flyPath([from, to], t, null, dur); }
  /** A card drawn while someone is purro: it is held up in the middle of the table for everyone to see. */
  function flyReveal(from, to, t) {
    const piles = $('.piles');
    if (!from || !to || !piles) return fly(from, to, t, secs(480));
    const pr = piles.getBoundingClientRect(), w = from.width * 1.3, h = from.height * 1.3;
    const mid = { left: pr.left + pr.width / 2 - w / 2, top: pr.top - h * 0.2, width: w, height: h };
    return flyPath([from, mid, mid, to], t, [0, 0.25, 0.75, 1], secs(1700));
  }
  /** Where a seat's cards are on screen; optionally hides the newest card until an animation lands on it. */
  function seatTarget(seat, hideLast) {
    let node = null;
    if (seat === ME) { const cs = document.querySelectorAll('#hand .card'); node = cs.length ? cs[cs.length - 1] : null; }
    else { const cs = document.querySelectorAll('.seat-' + posClass(seat) + ' .fan .card'); node = cs.length ? cs[cs.length - 1] : null; }
    if (node && !node.offsetParent) node = null;           // the fan is hidden on narrow screens
    let rect;
    if (node) rect = node.getBoundingClientRect();
    else {
      const box = seat === ME ? $('#hand') : $('.seat-' + posClass(seat));
      const r = box.getBoundingClientRect(), w = 34, h = 53;
      rect = { left: r.left + r.width / 2 - w / 2, top: r.top + r.height / 2 - h / 2, width: w, height: h };
    }
    if (hideLast && node) node.style.visibility = 'hidden';
    return { rect, show: () => { if (node) node.style.visibility = ''; } };
  }
  function showBubble(seat, text, msec) {
    sfx({ 'Purro!': 'purro', 'Cuajo!': 'win', 'Time!': 'time', 'Secret!': 'secret' }[text] || 'turn');
    if (mode === 'host') send({ t: 'bubble', seat, text, msec });
    const id = ((bubbles[seat] && bubbles[seat].id) || 0) + 1;
    bubbles[seat] = { text, id };
    render();
    setTimeout(() => { if (bubbles[seat] && bubbles[seat].id === id) { delete bubbles[seat]; render(); } }, Math.max(msec, 900));
  }
  function snap() { return { purro: g.purro.slice(), secrets: g.secrets.map(x => x.length), phase: g.phase }; }
  /** Speech bubbles for what just happened; returns how long to pause so people can see it. */
  function announce(b) {
    let extra = 0;
    for (let s = 0; s < 4; s++) {
      if (g.secrets[s].length > b.secrets[s]) { showBubble(s, 'Secret!', secs(1600)); extra = Math.max(extra, secs(800)); }
      if (!b.purro[s] && g.purro[s]) { showBubble(s, 'Purro!', secs(1900)); extra = Math.max(extra, secs(900)); }
    }
    if (b.phase !== 'over' && g.phase === 'over' && g.result && g.result.type === 'win') showBubble(g.result.winner, 'Cuajo!', secs(2800) || 1200);
    return extra;
  }

  function newGame(people) {
    g = C.newGame({ names: settings.names, human: 0, humans: people || (mode === 'solo' ? [0] : humansOf().slice()), dealRule: settings.dealRule });
    applyNames(); C.setDifficulty(g, settings.difficulty);
    selIds = []; groupOf = {}; bubbles = {}; pickExtra = null; modal = null; resultShown = false; layouts = {}; handHidden = false; promptSeat = null;
    if (ME !== 0 && mode !== 'guest') { ME = 0; handOrder = []; orderHand = 0; }
    dealToken++; dealing = false;
    changed();
  }
  function deal() {
    if (mode === 'guest') { if (g && !dealing && (g.phase === 'over' || g.phase === 'idle')) send({ t: 'act', a: 'deal' }); return; }
    if (dealing) return;
    if (g.phase === 'idle') C.startHand(g); else if (g.phase === 'over') C.nextHand(g); else return;
    selIds = []; groupOf = {}; bubbles = {}; pickExtra = null; modal = null; resultShown = false; orderHand = 0; layouts = {};
    if (mode === 'local') { handHidden = true; promptSeat = null; }
    lastMove = { kind: 'deal' };
    save();
    animateDeal();
  }
  async function animateDeal() {
    const token = ++dealToken;
    clearTimeout(timer); gen++;
    dealing = true; render();
    if (pace() > 0 && !REDUCED) {
      const from = rectOf('.pile.stock .card') || rectOf('.pile.stock');
      for (let r = 0; r < 3; r++) for (let k = 0; k < 4; k++) {   // packets go round the table to the right
        if (token !== dealToken) return;
        fly(from, seatTarget((g.dealer + k) % 4).rect, null, secs(340));
        await wait(secs(90));
      }
      await wait(secs(380));
      if (token !== dealToken) return;
      await fly(from, rectOf('.pile.sowee .card'), C.cardType(g.sowee), secs(520));   // the sowee is turned face up
      await wait(secs(250));
    }
    if (token !== dealToken) return;
    dealing = false; render(); drive();
  }

  function drive() {
    clearTimeout(timer); gen++;
    chime();
    if (!g || g.phase === 'idle' || dealing) return;
    if (g.phase === 'over') {
      if (mode === 'local') { handHidden = false; promptSeat = null; }
      if (!modal && !resultShown) later(() => { if (g.phase === 'over' && !modal && !resultShown) { modal = 'result'; resultShown = true; render(); } }, pace() ? Math.max(secs(2000), 500) : 0);
      return;
    }
    if (mode === 'guest') {   // the host runs the game; this computer only answers when it is our call
      if (g.phase === 'timeOffer' && C.currentClaimant(g) === ME) { if (modal !== 'time') { modal = 'time'; render(); } }
      else if (modal === 'time') { modal = null; render(); }
      return;
    }
    if (g.phase === 'timeOffer') {
      const p = C.currentClaimant(g);
      if (isHuman(p)) { if (isLocalHuman(p) && !needPrompt(p) && modal !== 'time') { modal = 'time'; render(); } return; }
      later(aiTime, secs(650, 350));
      return;
    }
    if (isHuman(g.turn)) { needPrompt(g.turn); return; }
    later(aiStep, g.phase === 'draw' ? secs(750, 550) : secs(950, 850));
  }
  /** Pass-and-play: ask for the computer to be handed over before the next person's cards are shown. */
  function needPrompt(seat) {
    if (mode !== 'local') return false;
    if (seat === ME && !handHidden) return false;
    if (promptSeat !== seat) { promptSeat = seat; render(); }
    return true;
  }
  function cardRect(seat, id) {
    if (seat === ME) { const n = document.querySelector('#hand .card[data-id="' + id + '"]'); if (n) return n.getBoundingClientRect(); }
    return seatTarget(seat).rect;
  }
  /** Applies one move for any seat, then animates it here; online, the other computer animates it too. */
  function act(seat, a, arg, noFly) {
    const b = snap();
    let move = null, from = null;
    if (a === 'drawStock') { from = rectOf('.pile.stock .card'); C.drawStock(g, seat); move = { kind: 'draw', seat, src: 'stock', id: g.drawn, shown: !!(g.lastShown && g.lastShown.id === g.drawn) }; }
    else if (a === 'takeDiscard') { from = rectOf('.pile.discard .card'); C.takeDiscard(g, seat); move = { kind: 'draw', seat, src: 'discard', id: g.drawn, shown: true }; }
    else if (a === 'discard') { from = noFly ? null : cardRect(seat, arg); C.discard(g, seat, arg); move = { kind: 'discard', seat, id: arg }; }
    else if (a === 'secret') C.declareSecret(g, seat, arg.type, arg.extraId == null ? null : arg.extraId);
    else if (a === 'time') { const o = g.timeOffer; from = seatTarget(o.from).rect; C.resolveTime(g, !!arg); if (arg) move = { kind: 'time', seat, from: o.from, id: o.card }; }
    else if (a === 'endHand') C.endHandDraw(g);
    if (seat === ME) { if (a === 'discard') selIds = selIds.filter(x => x !== arg); else if (a !== 'time') selIds = []; }
    if (a === 'discard' && mode === 'local' && seat === ME) handHidden = true;   // pass-and-play: cover your cards once your turn is over
    lastMove = move; save(); render();
    return { b, p: animateMove(move, from) };
  }
  function animateMove(move, from) {
    if (!move || !from) return Promise.resolve();
    if (move.kind === 'draw') {
      if (move.seat === ME && document.querySelector('#hand .card[data-id="' + move.id + '"]')) { landInHand(from, move.id); return wait(secs(380)); }
      const face = move.id != null && move.id >= 0 && (move.src === 'discard' || move.shown || (settings.openHands && mode === 'solo')) ? C.cardType(move.id) : null;
      const dest = seatTarget(move.seat, true);
      const p = move.shown && move.src === 'stock' ? flyReveal(from, dest.rect, face) : fly(from, dest.rect, face, secs(480));
      return p.then(dest.show);
    }
    if (move.kind === 'discard') {
      const top = $('.pile.discard .card');
      if (!top) return Promise.resolve();
      top.style.visibility = 'hidden';
      return fly(from, top.getBoundingClientRect(), C.cardType(move.id), secs(move.seat === ME ? 380 : 480)).then(() => { top.style.visibility = ''; });
    }
    if (move.kind === 'time') return fly(from, seatTarget(move.seat).rect, C.cardType(move.id), secs(480));
    return Promise.resolve();
  }
  async function aiTime() {
    const my = gen, p = C.currentClaimant(g);
    if (!C.aiClaimsTime(g, p)) { act(p, 'time', false); drive(); return; }   // did not notice it
    showBubble(p, 'Time!', secs(1500));
    await pause(secs(550)); if (my !== gen) return;
    const r = act(p, 'time', true);
    await r.p; if (my !== gen) return;
    announce(r.b); save(); render(); drive();
  }
  async function aiStep() {
    const my = gen, seat = g.turn;
    let r = null;
    try {
      if (g.phase === 'draw') {
        const a = C.aiChooseDraw(g, seat);
        if (a === 'end') { act(seat, 'endHand'); drive(); return; }
        r = act(seat, a === 'stock' ? 'drawStock' : 'takeDiscard');
      } else if (g.phase === 'discard') {
        const sc = C.aiChooseSecret(g, seat);
        r = sc ? act(seat, 'secret', sc) : act(seat, 'discard', C.aiChooseDiscard(g, seat));
      }
      if (r) await r.p;
    } catch (e) { console.error(e); }
    if (my !== gen) return;
    const extra = r ? announce(r.b) : 0;
    if (extra) { await pause(extra); if (my !== gen) return; }
    save(); render(); drive();
  }

  // ---------- your actions ----------
  function covered() { return mode === 'local' && (handHidden || promptSeat != null); }
  function myTurn(phase) { return g && !dealing && g.phase === phase && g.turn === ME && isLocalHuman(ME) && !covered() && !(mode === 'guest' && (!net || !net.link || net.reconnecting)); }
  /** After your own draw: the new card slides in from where it came from. */
  function landInHand(from, id) {
    const node = document.querySelector('#hand .card[data-id="' + id + '"]');
    if (!node || !from) return;
    node.style.visibility = 'hidden';
    fly(from, node.getBoundingClientRect(), C.cardType(id), secs(380)).then(() => { node.style.visibility = ''; });
  }
  /** Your move: played here, or sent to the host when you joined someone else's game. */
  function humanAct(a, arg, noFly) {
    if (mode === 'guest') { send({ t: 'act', a, arg }); return; }
    const r = act(ME, a, arg, noFly); announce(r.b); drive();
  }
  function onStock() { if (myTurn('draw') && g.stock.length) humanAct('drawStock'); }
  function onTake() { if (myTurn('draw') && C.legalActions(g, ME).takeDiscard) humanAct('takeDiscard'); }
  function onEnd() { if (myTurn('draw') && !g.stock.length) humanAct('endHand'); }
  function onCard(id) {
    if (pickExtra != null) {
      if (!myTurn('discard')) return;
      if (C.cardType(id) === pickExtra) { flash('Pick a different card: those three go down together.'); return; }
      const type = pickExtra; pickExtra = null; selIds = [];
      humanAct('secret', { type, extraId: id }); return;
    }
    if (g.phase === 'idle' || dealing || covered()) return;
    const i = selIds.indexOf(id);
    if (i >= 0) selIds.splice(i, 1); else selIds.push(id);
    render();
  }
  function onDiscard(id, noFly) {
    const card = id != null ? id : (selIds.length === 1 ? selIds[0] : null);
    if (card == null || !myTurn('discard') || C.isKing(card) || pickExtra != null) return;
    humanAct('discard', card, noFly);
  }
  function onSecret(opt) {
    if (!myTurn('discard')) return;
    if (opt.kind === 'four') { selIds = []; humanAct('secret', { type: opt.type, extraId: null }); }
    else { pickExtra = opt.type; selIds = []; render(); }
  }
  function onTime(accept) {
    if (g.phase === 'timeOffer' && C.currentClaimant(g) === ME && isLocalHuman(ME)) { modal = null; humanAct('time', accept); render(); }
  }
  /** Pass-and-play: show one person's cards (the table turns so their seat is at the bottom). */
  function reveal(seat) {
    if (seat !== ME) switchMe(seat);
    handHidden = false; promptSeat = null;
    render(); drive();
  }
  function switchMe(seat) {
    layouts[ME] = { handOrder, orderHand, groupOf, selIds };
    const l = layouts[seat] || { handOrder: [], orderHand: 0, groupOf: {}, selIds: [] };
    ME = seat; handOrder = l.handOrder; orderHand = l.orderHand; groupOf = l.groupOf; selIds = l.selIds; pickExtra = null;
  }
  function closeModal() {
    const opener = modal === 'rules' ? $('#btn-rules') : modal === 'settings' ? $('#btn-settings') : null;
    modal = null; confirmReset = false; changed();
    if (opener) { try { opener.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }

  // ---------- rendering ----------
  function render() {
    const active = document.activeElement, key = active && active.dataset ? active.dataset.key : null;
    let ok = true;
    try { $('#app').classList.toggle('dealing', dealing); renderTop(); for (const s of others()) renderSeat(s); renderCenter(); renderYou(); renderModal(); }
    catch (e) { console.error(e); ok = false; }
    if (key) { const n = document.querySelector('[data-key="' + key + '"]'); if (n && n !== document.activeElement) { try { n.focus({ preventScroll: true }); } catch (e) { /* ignore */ } } }
    return ok;
  }

  function balanceEl(seat) {
    const b = g.balances[seat];
    return el('span', b > 0 ? 'pos' : b < 0 ? 'neg' : '', (b > 0 ? '+' : '') + C.money(b));
  }
  function renderTop() {
    const sc = $('#scores'); sc.innerHTML = '';
    const fb = $('#btn-friend'); if (fb) fb.textContent = modeLabel();
    for (const seat of [ME, C.partnerOf(ME), (ME + 1) % 4, (ME + 3) % 4]) {
      const us = seat % 2 === ME % 2, chip = el('span', 'sc');
      chip.append(el('span', 'dot ' + (us ? 'us' : 'them')), el('span', 'nm', name(seat)), balanceEl(seat));
      chip.title = (us ? 'Your side' : 'Opponents') + ' · hands won: ' + g.wins[seat];
      sc.append(chip);
    }
  }

  function isActive(seat) {
    if (g.phase === 'idle' || g.phase === 'over' || dealing) return false;
    if (g.phase === 'timeOffer') return C.currentClaimant(g) === seat;
    return g.turn === seat;
  }

  function renderSeat(seat) {
    const sec = $('.seat-' + posClass(seat)); sec.innerHTML = '';
    sec.classList.toggle('active', isActive(seat));
    const h = el('header');
    h.append(el('span', 'nm', name(seat)));
    const partner = seat === C.partnerOf(ME);
    h.append(el('span', 'tag role' + (partner ? ' us' : ''), partner ? 'your partner' : 'opponent'));
    if (isHuman(seat)) h.append(el('span', 'tag friend', 'friend'));
    if (net && net.role === 'host' && net.away && seat === net.friendSeat) { const aw = el('span', 'tag penalty', 'away'); aw.title = 'A computer player is filling in until they rejoin'; h.append(aw); }
    if (g.phase !== 'idle' && g.dealer === seat) h.append(el('span', 'tag dealer', 'dealer'));
    if (g.purro[seat]) h.append(el('span', 'tag purro', 'purro'));
    if (g.penalty[seat] > 0) { const pt = el('span', 'tag penalty', 'shows draws'); pt.title = 'Broken purro: draws are shown and no purro or win is allowed for ' + plural(g.penalty[seat], 'more turn'); h.append(pt); }
    if (g.phase !== 'idle') h.append(el('span', 'cnt', plural(g.hands[seat].length, 'card')));
    if (isActive(seat)) { const th = el('span', 'thinking'); th.setAttribute('aria-label', name(seat) + ' is thinking'); th.append(el('i'), el('i'), el('i')); h.append(th); }
    sec.append(h);
    if (bubbles[seat]) sec.append(el('div', 'bubble', bubbles[seat].text));
    if (g.phase === 'idle') return;
    const winnerShows = g.phase === 'over' && g.result && g.result.type === 'win' && g.result.winner === seat;
    const faceUp = (settings.openHands && mode === 'solo') || winnerShows;
    const fan = el('div', 'fan' + (faceUp ? ' open' : ''));
    const hand = g.hands[seat].slice().sort(byType);
    for (const id of hand) {
      if (g.purro[seat] && id === g.marker[seat] && !winnerShows) continue; // shown face up as the purro marker instead
      fan.append(faceUp ? cardEl(C.cardType(id), { mini: true }) : cardEl(null, { mini: true, label: 'one of ' + name(seat) + '\u2019s cards' }));
    }
    sec.append(fan);
    const ex = el('div', 'extras');
    for (const s of g.secrets[seat]) ex.append(secretEl(s, (settings.openHands && mode === 'solo') || winnerShows));
    if (g.purro[seat] && g.marker[seat] != null) { const m = el('div', 'marker'); m.append(cardEl(C.cardType(g.marker[seat]), { mini: true }), el('span', null, 'purro marker')); ex.append(m); }
    if (ex.childElementCount) sec.append(ex);
  }

  function statusText() {
    const st = document.createDocumentFragment();
    const add = (t, cls) => { const s = el(cls ? 'strong' : 'span', cls === 'strong' ? '' : cls, t); st.append(s); };
    if (notice) { add(notice, 'notice'); return st; }
    if (mode === 'guest' && net && net.reconnecting) { add('Connection lost. Reconnecting\u2026', 'notice'); return st; }
    if (g.phase === 'idle') { add('Four players, partners across the table. Press Deal to start.'); return st; }
    if (dealing) { add(name(g.dealer) + (g.dealer === ME ? ' deal the cards\u2026' : ' is dealing\u2026')); return st; }
    if (mode === 'local' && promptSeat != null && g.phase !== 'over') { add('Pass the computer to ' + name(promptSeat) + '.'); return st; }
    if (g.phase === 'over') { add(g.result.type === 'draw' ? 'The stock ran out. The hand is a draw.' : 'Cuajo! ' + name(g.result.winner) + ' wins the hand.'); return st; }
    if (g.phase === 'timeOffer') {
      const p = C.currentClaimant(g);
      add(p === ME ? 'Time! You can claim the ' + C.cardName(C.cardType(g.timeOffer.card)) + '.' : name(p) + ' is looking at the shown card…');
      return st;
    }
    if (g.turn !== ME) { add(name(g.turn) + (g.phase === 'draw' ? ' is drawing…' : ' is choosing a discard…')); return st; }
    const top = C.topDiscard(g);
    if (g.phase === 'draw') {
      const la = C.legalActions(g, ME);
      const pen = g.penalty[ME] > 0 ? ' Your purro was broken: this draw is shown and you cannot win for ' + plural(g.penalty[ME], 'more turn') + '.' : '';
      if (!g.stock.length) {
        if (top == null) add('The stock is empty and there is nothing to take. End the hand.');
        else if (la.takeDiscard) add('The stock is empty, but the ' + C.cardName(C.cardType(top)) + ' completes your hand: take it to win, or end the hand.', 'strong');
        else add('The stock is empty and the ' + C.cardName(C.cardType(top)) + ' does not complete your hand. End the hand.');
        return st;
      }
      if (top == null) { add('Your turn. Draw a card from the stock.' + pen); return st; }
      if (la.takeDiscard && completesMe(C.cardType(top)) && g.penalty[ME] === 0) { add('The ' + C.cardName(C.cardType(top)) + ' completes your hand! Take it to win.', 'strong'); return st; }
      add('Your turn. Draw from the stock, or take the ' + C.cardName(C.cardType(top)) + ' from the discard pile.' + pen);
      return st;
    }
    if (pickExtra != null) { add('Choose any fourth card from your hand to lay down with your three ' + C.cardName(pickExtra) + ' cards.'); return st; }
    const drew = g.drawn != null ? 'You ' + (g.drawnFrom === 'discard' ? 'took' : 'drew') + ' the ' + C.cardName(C.cardType(g.drawn)) + '. ' : (g.turnCount === 0 ? 'You dealt, so you discard first. ' : '');
    add(drew + (selIds.length === 1 && !C.isKing(selIds[0]) ? 'Discard the ' + C.cardName(C.cardType(selIds[0])) + '?' : 'Choose a card to discard.'));
    return st;
  }
  function completesMe(t) { return C.completesWith(g, ME, t); }

  function renderCenter() {
    const piles = $('.piles'); piles.innerHTML = '';
    const mine = myTurn('draw');
    const ps = el('div', 'pile stock' + (mine && g.stock.length ? ' clickable' : ''));
    if (g.stock.length) {
      const cd = cardEl(null, { label: 'stock, ' + plural(g.stock.length, 'card') });
      if (mine) { cd.setAttribute('role', 'button'); cd.setAttribute('aria-label', 'Draw from the stock, ' + plural(g.stock.length, 'card') + ' left'); cd.dataset.key = 'stock'; cd.tabIndex = 0; cd.addEventListener('click', onStock); cd.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onStock(); } }); }
      ps.append(cd);
    } else ps.append(el('div', 'slot'));
    if (g.phase !== 'idle') ps.append(el('span', 'cnt', String(g.stock.length)));
    ps.append(el('span', 'lbl', 'Stock'));
    const top = C.topDiscard(g);
    const canTake = mine && C.legalActions(g, ME).takeDiscard;
    const pd = el('div', 'pile discard' + (canTake ? ' clickable' : '') + (canTake && completesMe(C.cardType(top)) && g.penalty[ME] === 0 ? ' wins' : ''));
    if (top != null) {
      const cd = cardEl(C.cardType(top));
      if (canTake) { cd.setAttribute('role', 'button'); cd.setAttribute('aria-label', 'Take the ' + C.cardName(C.cardType(top)) + ' from the discard pile'); cd.dataset.key = 'discard'; cd.tabIndex = 0; cd.addEventListener('click', onTake); cd.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTake(); } }); }
      pd.append(cd);
    } else pd.append(el('div', 'slot'));
    if (g.phase !== 'idle') pd.append(el('span', 'cnt', String(g.discards.length)));
    pd.append(el('span', 'lbl', 'Discard'));
    const pw = el('div', 'pile sowee');
    pw.append(g.sowee != null && g.phase !== 'idle' ? cardEl(C.cardType(g.sowee)) : el('div', 'slot'));
    pw.append(el('span', 'lbl', 'Sowee'));
    piles.append(ps, pd, pw);

    const status = $('.status'); status.innerHTML = ''; status.append(statusText());
    const cb = $('#center-bar'); cb.innerHTML = '';
    if (waitingOnOthers() && g.phase !== 'over') {
      const nb = btn('Next move', skipAhead, 'next');
      nb.append(el('kbd', null, 'N'));
      nb.title = 'Skip the pause. The cards still move, you just wait less. Shortcut: N';
      cb.append(nb);
    }
    const log = $('.log'); log.innerHTML = '';
    const recent = g.events.slice(-5).reverse();
    for (const e of recent) {
      const li = el('li', e.kind);
      li.append(youGrammar(e.msg));
      if (e.kind === 'draw' && g.lastShown && e === g.events[g.events.length - 1] && e.msg.indexOf('shows') >= 0) { const sc = el('span', 'shown-card'); sc.append(cardEl(C.cardType(g.lastShown.id), { mini: true })); li.append(sc); }
      log.append(li);
    }
  }

  // ---------- arranging your hand ----------
  function sortIds(ids, mode) {
    const t = C.cardType;
    if (mode === 'rank') return ids.slice().sort((a, b) => C.rankOf(t(a)) - C.rankOf(t(b)) || C.suitOf(t(a)) - C.suitOf(t(b)) || a - b);
    return ids.slice().sort(byType);
  }
  /** Groups your hand the way the hint planner sees it: finished combinations, kings, then cards one short. */
  function autoGroupOrder() {
    const pri = { set: 0, run: 0, secret: 0, king: 1, secret3: 2, set2: 2, run2: 2, secret2: 2, seed: 3, drop: 4 };
    const plan = C.keepPlan(C.poolCounts(g, ME), C.slotsFor(g, ME)).map((gp, i) => ({ gp, i }));
    plan.sort((x, y) => (pri[x.gp.kind] - pri[y.gp.kind]) || x.i - y.i);
    const left = g.hands[ME].slice().sort(byType), out = [], kings = [];
    let finished = 0;
    groupOf = {};
    for (const { gp } of plan) {
      const ids = [];
      for (const ty of gp.types) { const k = left.findIndex(id => C.cardType(id) === ty); if (k >= 0) ids.push(left.splice(k, 1)[0]); }
      if (!ids.length) continue;
      if (gp.kind === 'king') { kings.push(...ids); continue; }
      if (ids.length >= 2 && gp.kind !== 'seed' && gp.kind !== 'drop') { const gid = nextGid++; for (const id of ids) groupOf[id] = gid; }
      if (pri[gp.kind] === 0) finished += ids.length;
      out.push(...ids);
    }
    // lone kings sit together as one group, right after the finished combinations
    if (kings.length >= 2) { const gid = nextGid++; for (const id of kings) groupOf[id] = gid; }
    out.splice(finished, 0, ...kings);
    return out.concat(left);
  }
  /** Your hand in your own order, with each group's cards kept together; new cards go to the right end. */
  function orderedHand() {
    const hand = g.hands[ME];
    if (orderHand !== g.handNo) { groupOf = {}; handOrder = settings.sortMode === 'combos' ? autoGroupOrder() : sortIds(hand, settings.sortMode); orderHand = g.handNo; }
    const inHand = new Set(hand), kept = handOrder.filter(id => inHand.has(id)), known = new Set(kept);
    const cmp = settings.sortMode === 'rank' ? (a, b) => (C.rankOf(C.cardType(a)) - C.rankOf(C.cardType(b))) || (C.suitOf(C.cardType(a)) - C.suitOf(C.cardType(b))) : byType;
    for (const id of hand) if (!known.has(id)) {
      const at = settings.newCards === 'sorted' ? kept.findIndex(x => groupOf[x] == null && cmp(x, id) > 0) : -1;
      if (at < 0) kept.push(id); else kept.splice(at, 0, id);
    }
    const size = {};
    for (const k of Object.keys(groupOf)) { if (!inHand.has(+k)) delete groupOf[k]; else size[groupOf[k]] = (size[groupOf[k]] || 0) + 1; }
    for (const k of Object.keys(groupOf)) if (size[groupOf[k]] < 2) delete groupOf[k];
    const out = [], done = new Set();
    for (const id of kept) {
      if (done.has(id)) continue;
      const gid = groupOf[id];
      if (gid == null) { out.push(id); done.add(id); continue; }
      for (const x of kept) if (groupOf[x] === gid && !done.has(x)) { out.push(x); done.add(x); }
    }
    handOrder = out;
    return out.slice();
  }
  function segmentsOf(order) {
    const segs = [];
    for (const id of order) {
      const gid = groupOf[id], key = gid == null ? 'L' : 'G' + gid, last = segs[segs.length - 1];
      if (last && last.key === key) last.ids.push(id); else segs.push({ key, gid: gid == null ? null : gid, ids: [id] });
    }
    return segs;
  }
  function oneShort(c) { for (let t = 0; t < C.NTYPES; t++) { if (c[t] >= 4) continue; c[t]++; const ok = C.canPartition(c); c[t]--; if (ok) return true; } return false; }
  /** What a group of your cards amounts to, for its label. */
  function groupLabel(ids) {
    const c = C.countsOf(ids);
    if (C.canPartition(c)) {
      const parts = C.partition(c) || [];
      if (parts.every(x => x.kind === 'king')) return { cls: 'ok', text: parts.length === 1 ? 'King' : 'Kings' };
      if (parts.length === 1) return { cls: 'ok', text: { set: 'Set', run: 'Run', secret: 'Four alike' }[parts[0].kind] || 'Combination' };
      return { cls: 'ok', text: parts.length + ' combinations' };
    }
    if (oneShort(c)) return { cls: 'part', text: 'Needs 1', title: 'One more card makes this a combination' };
    return { cls: 'bad', text: 'No match', title: 'These cards do not make a combination yet' };
  }
  function sortHand(mode) {
    settings.sortMode = mode;
    orderedHand();
    if (mode === 'combos') handOrder = autoGroupOrder();
    else {
      const grouped = handOrder.filter(id => groupOf[id] != null);     // your groups stay as they are, on the left
      handOrder = grouped.concat(sortIds(handOrder.filter(id => groupOf[id] == null), mode));
    }
    orderHand = g.handNo; save(); render();
  }
  function groupSelected() {
    orderedHand();
    const ids = handOrder.filter(id => selIds.indexOf(id) >= 0);
    if (ids.length < 2) return;
    const gid = nextGid++, firstPos = handOrder.indexOf(ids[0]);
    const rest = handOrder.filter(id => ids.indexOf(id) < 0);
    const at = handOrder.slice(0, firstPos).filter(id => ids.indexOf(id) < 0).length;
    rest.splice(at, 0, ...ids);
    handOrder = rest;
    for (const id of ids) groupOf[id] = gid;
    selIds = []; save(); render();
  }
  function ungroup(gid) { for (const k of Object.keys(groupOf)) if (groupOf[k] === gid) delete groupOf[k]; save(); render(); }
  function ungroupSelected() { for (const id of selIds) delete groupOf[id]; selIds = []; save(); render(); }
  function ungroupAll() { groupOf = {}; save(); render(); }
  function moveCard(id, dir) {
    orderedHand();
    const i = handOrder.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= handOrder.length) return;
    const other = handOrder[j];
    handOrder[i] = other; handOrder[j] = id;
    if (groupOf[other] !== groupOf[id]) { if (groupOf[other] != null) groupOf[id] = groupOf[other]; else delete groupOf[id]; } // stepping into or out of a group
    save(); render();
  }
  function canDropOnDiscard(d) { return d.kind === 'card' && myTurn('discard') && pickExtra == null && !C.isKing(d.id); }

  // ---------- dragging cards and groups ----------
  function onHandPointerDown(e, id, node, kind) {
    if (drag || dealing || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag = { kind: kind || 'card', id, el: node, pointerId: e.pointerId, type: e.pointerType, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, active: false, timer: 0 };
    if (e.pointerType !== 'mouse') {
      // on touch screens a press-and-hold starts the drag, so an ordinary swipe still scrolls the page
      const d = drag;
      d.timer = setTimeout(() => { if (drag === d && !d.active) beginDrag(d.x, d.y); }, 230);
    }
  }
  function onDragMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag.x = e.clientX; drag.y = e.clientY;
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 7) return;
      if (drag.type === 'mouse') beginDrag(e.clientX, e.clientY);
      else { clearTimeout(drag.timer); drag = null; if (handDirty) render(); return; }
    }
    moveDrag(e.clientX, e.clientY);
  }
  function onDragEnd(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    clearTimeout(drag.timer);
    if (!drag.active) { drag = null; if (handDirty) render(); return; } // a plain click: the click handler takes it
    endDrag(e.type === 'pointercancel');
  }
  function beginDrag(x, y) {
    const d = drag;
    if (!d.el.isConnected) { drag = null; return; }
    d.active = true;
    const r = d.el.getBoundingClientRect();
    d.offX = x - r.left; d.offY = y - r.top;
    const ghost = d.el.cloneNode(true);
    ghost.classList.remove('selected', 'pick'); ghost.classList.add('ghost');
    ghost.removeAttribute('data-key'); ghost.removeAttribute('tabindex'); ghost.setAttribute('aria-hidden', 'true');
    for (const n of ghost.querySelectorAll('[data-key]')) n.removeAttribute('data-key');
    ghost.style.width = r.width + 'px'; ghost.style.height = r.height + 'px';
    document.body.appendChild(ghost);
    d.ghost = ghost;
    d.el.classList.add('placeholder');
    document.body.classList.add('dragging');
    const pile = document.querySelector('.pile.discard');
    if (pile && canDropOnDiscard(d)) pile.classList.add('drop-target');
    moveDrag(x, y);
  }
  /** Position of a node inside the hand box, ignoring any animation transforms. */
  function posIn(node, root) { let x = 0, y = 0, n = node; while (n && n !== root) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; } return n === root ? [x, y] : null; }
  function moveDrag(x, y) {
    const d = drag;
    d.ghost.style.left = (x - d.offX) + 'px'; d.ghost.style.top = (y - d.offY) + 'px';
    const pile = document.querySelector('.pile.discard');
    d.overPile = false;
    if (pile && canDropOnDiscard(d)) {
      const r = pile.getBoundingClientRect();
      d.overPile = x >= r.left - 12 && x <= r.right + 12 && y >= r.top - 12 && y <= r.bottom + 12;
      pile.classList.toggle('drop-hover', d.overPile);
    }
    if (d.overPile) return;
    const hand = $('#hand'), hr = hand.getBoundingClientRect();
    if (x < hr.left - 40 || x > hr.right + 40 || y < hr.top - 50 || y > hr.bottom + 50) return; // outside the hand: keep the spot
    const px = x - hr.left, py = y - hr.top;
    const isGroup = d.kind === 'group';
    const targets = isGroup ? [...hand.children].filter(n => n !== d.el) : [...hand.querySelectorAll('.card')].filter(n => n !== d.el);
    let target = null, before = true, best = Infinity, tp = null;
    for (const c of targets) {
      const p = posIn(c, hand); if (!p) continue;
      const w = c.offsetWidth, h = c.offsetHeight;
      const anchor = p[0] + w * (isGroup ? 0.5 : 0.32);   // cards: middle of the part that is not covered
      const inRow = py >= p[1] - 8 && py <= p[1] + h + 8;
      const dist = Math.abs(px - anchor) + (inRow ? 0 : 3 * Math.abs(py - (p[1] + h / 2)));
      if (dist < best) { best = dist; target = c; before = px < anchor; tp = p; }
    }
    if (!target) return;
    let container = isGroup ? hand : target.parentNode, ref = before ? target : target.nextSibling;
    // past the right end of a group: the card comes out of the group, into a loose run after it
    if (!isGroup && !before && container.classList.contains('grp') && !target.nextElementSibling && px > tp[0] + target.offsetWidth + 6) {
      let next = container.nextElementSibling;
      if (!next || !next.classList.contains('loose')) { next = el('div', 'seg loose'); hand.insertBefore(next, container.nextSibling); }
      container = next; ref = next.firstChild;
    }
    if (d.el.parentNode === container && (ref === d.el || ref === d.el.nextSibling)) return;   // already there
    const cards = [...hand.querySelectorAll('.card')].filter(c => c !== d.el && !d.el.contains(c));
    const from = new Map(cards.map(c => [c, posIn(c, hand)]));
    container.insertBefore(d.el, ref);
    for (const c of cards) {                                          // slide the other cards into their new places
      const f = from.get(c), t = posIn(c, hand);
      if (!f || !t) continue;
      const dx = f[0] - t[0], dy = f[1] - t[1];
      if (!dx && !dy) continue;
      c.style.transition = 'none'; c.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      void c.offsetWidth;
      c.style.transition = ''; c.style.transform = '';
    }
  }
  function endDrag(cancelled) {
    const d = drag; drag = null;
    if (d.ghost) d.ghost.remove();
    document.body.classList.remove('dragging');
    const pile = document.querySelector('.pile.discard'); if (pile) pile.classList.remove('drop-target', 'drop-hover');
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
    if (!cancelled && d.overPile && canDropOnDiscard(d)) { onDiscard(d.id, true); return; }
    if (!cancelled) {
      const inHand = new Set(g.hands[ME]), ids = [], groups = {};
      for (const seg of $('#hand').children) {
        const gid = seg.classList.contains('grp') ? +seg.dataset.gid : null;
        for (const c of seg.querySelectorAll('.card')) {
          const id = +c.dataset.id;
          if (isNaN(id) || !inHand.has(id)) continue;
          ids.push(id); if (gid != null && !isNaN(gid)) groups[id] = gid;
        }
      }
      handOrder = ids; groupOf = groups; orderHand = g.handNo;
      save();
    }
    render();
  }

  function renderHandTools() {
    const tools = $('#hand-tools'); tools.innerHTML = '';
    if (g.phase === 'idle' || dealing || !g.hands[ME].length) return;
    tools.append(el('span', 'lbl', 'Sort'));
    for (const [m, label, tip] of [['suit', 'Suit', 'Sort loose cards by suit, then rank'], ['rank', 'Rank', 'Sort loose cards by rank, then suit'], ['combos', 'Auto-group', 'Group your cards into finished combinations and cards that are one short']]) {
      const b = btn(label, () => sortHand(m), 'chip' + (settings.sortMode === m ? ' on' : ''));
      b.title = tip; b.dataset.key = 'sort-' + m;
      tools.append(b);
    }
    if (selIds.length >= 2) { const b = btn('Group ' + selIds.length + ' cards', groupSelected, 'chip primary'); b.dataset.key = 'group-sel'; tools.append(b); }
    if (selIds.some(id => groupOf[id] != null)) { const b = btn('Take out of group', ungroupSelected, 'chip'); b.dataset.key = 'ungroup-sel'; tools.append(b); }
    if (Object.keys(groupOf).length && !selIds.length) { const b = btn('Ungroup all', ungroupAll, 'chip'); b.dataset.key = 'ungroup-all'; tools.append(b); }
    if (selIds.length) { const b = btn('Clear selection', () => { selIds = []; render(); }, 'chip'); b.dataset.key = 'clear-sel'; tools.append(b); }
    const tip = selIds.length === 1 ? 'Click more cards to group them.' : selIds.length ? '' : (COARSE ? 'Tap cards to select them. Press and hold to drag.' : 'Click cards to select them. Drag to move them.');
    const drop = myTurn('discard') ? ' Drop a card on the discard pile to discard it.' : '';
    if (tip || drop) tools.append(el('span', 'drag-hint', (tip + drop).trim()));
  }

  function renderYou() {
    const you = $('#you'); you.classList.toggle('active', isActive(ME));
    const head = $('#you-head'); head.innerHTML = '';
    head.append(el('span', 'nm', name(ME)));
    if (g.phase !== 'idle' && g.dealer === ME) head.append(el('span', 'tag dealer', 'dealer'));
    if (g.purro[ME]) head.append(el('span', 'tag purro', 'purro'));
    if (g.penalty[ME] > 0) head.append(el('span', 'tag penalty', 'broken purro: ' + plural(g.penalty[ME], 'turn') + ' left'));
    head.append(balanceEl(ME));
    if (g.secrets[ME].length) { const ex = el('span', 'extras'); for (const s of g.secrets[ME]) ex.append(secretEl(s, true)); head.append(ex); }
    if (bubbles[ME]) head.append(el('div', 'bubble', bubbles[ME].text));
    if (covered() && g.phase !== 'idle' && g.phase !== 'over' && !dealing) {   // pass-and-play: nobody peeks
      $('#hand-tools').innerHTML = ''; $('#hint').innerHTML = ''; $('#bar').innerHTML = '';
      const hand = $('#hand'); hand.innerHTML = ''; handDirty = false;
      const pnl = el('div', 'handover');
      if (promptSeat != null) {
        pnl.append(el('p', null, name(promptSeat) + '’s turn. Pass the computer to ' + name(promptSeat) + '.'));
        pnl.append(btn('I’m ' + name(promptSeat) + ', show my cards', () => reveal(promptSeat), 'primary'));
      } else {
        pnl.append(el('p', null, 'Cards are hidden so nobody peeks.'));
        const row = el('div', 'bar');
        for (const s of humansOf()) row.append(btn('Show ' + name(s) + '’s cards', () => reveal(s)));
        pnl.append(row);
      }
      hand.append(pnl);
      return;
    }

    renderHandTools();
    const hand = $('#hand');
    if (drag) handDirty = true;                 // leave the hand alone while you are arranging it
    else {
      handDirty = false; hand.innerHTML = '';
      const discarding = myTurn('discard');
      const marks = handMarks();
      const cards = orderedHand();
      const inHand = new Set(cards);
      selIds = selIds.filter(id => inHand.has(id));
      let pos = 0;
      for (const sg of segmentsOf(cards)) {
        const box = el('div', 'seg ' + (sg.gid == null ? 'loose' : 'grp'));
        if (sg.gid != null) {
          const lab = groupLabel(sg.ids);
          box.dataset.gid = sg.gid; box.classList.add(lab.cls);
          box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'Group: ' + lab.text);
          const tag = el('div', 'grp-tag');
          const nm = el('span', 'grp-name', lab.text); nm.title = (lab.title ? lab.title + '. ' : '') + 'Drag here to move the whole group';
          const x = el('button', 'grp-x', '×'); x.type = 'button'; x.title = 'Ungroup'; x.dataset.key = 'ungroup-' + sg.gid;
          x.setAttribute('aria-label', 'Ungroup ' + lab.text);
          x.addEventListener('click', () => ungroup(sg.gid));
          tag.append(nm, x);
          tag.addEventListener('pointerdown', e => { if (e.target !== x) onHandPointerDown(e, null, box, 'group'); });
          box.append(tag);
        }
        for (const id of sg.ids) {
          const i = pos++;
          const cd = cardEl(C.cardType(id));
          const isSel = selIds.indexOf(id) >= 0;
          cd.dataset.key = 'card-' + id; cd.dataset.id = id; cd.tabIndex = 0;
          cd.classList.add('pick'); cd.setAttribute('role', 'button'); cd.setAttribute('aria-pressed', isSel ? 'true' : 'false');
          cd.title += ' · click to select, drag or Shift + arrow keys to move';
          let label = C.cardName(C.cardType(id));
          if (discarding && pickExtra == null && C.isKing(id)) { cd.classList.add('king-lock'); label += ' (cannot be discarded)'; }
          cd.setAttribute('aria-label', label + ', card ' + (i + 1) + ' of ' + cards.length);
          cd.addEventListener('click', () => { if (!suppressClick) onCard(id); });
          if (discarding) cd.addEventListener('dblclick', () => { if (pickExtra == null && !C.isKing(id)) onDiscard(id); });
          cd.addEventListener('keydown', e => {
            if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); moveCard(id, e.key === 'ArrowLeft' ? -1 : 1); return; }
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCard(id); }
          });
          cd.addEventListener('pointerdown', e => onHandPointerDown(e, id, cd, 'card'));
          cd.addEventListener('contextmenu', e => { if (e.pointerType !== 'mouse' || COARSE) e.preventDefault(); });
          cd.addEventListener('dragstart', e => e.preventDefault());
          if (isSel) cd.classList.add('selected');
          if (id === g.drawn && g.turn === ME) cd.classList.add('drawn');
          if (marks[id] && sg.gid == null) cd.classList.add(marks[id]);
          box.append(cd);
        }
        hand.append(box);
      }
    }

    const hint = $('#hint'); hint.innerHTML = '';
    if (settings.hints && g.phase !== 'idle' && g.phase !== 'over' && g.phase !== 'timeOffer') {
      const a = C.analyze(g, ME), top = C.topDiscard(g);
      const takeIt = myTurn('draw') && top != null && g.stock.length && !completesMe(C.cardType(top)) && C.aiChooseDraw(g, ME) === 'discard';
      if (takeIt) hint.append('Hint: take the ' + C.cardName(C.cardType(top)) + ' from the discard pile. It brings you closer than a blind draw.');
      else if (a.n === a.slots) {
        if (a.complete) hint.append('Your hand is complete.');
        else if (a.bestDiscard) hint.append('Hint: discarding the ' + C.cardName(a.bestDiscard.type) + ' leaves you ' + plural(a.bestDiscard.distance, 'card') + ' from a complete hand.');
      } else if (a.n === a.slots - 1) {
        if (a.waiting.length) { hint.append('Purro! Any of these completes your hand: '); hint.append(miniRow(a.waiting)); }
        else { hint.append('You need ' + plural(a.distance, 'more card') + '. Useful draws: '); hint.append(miniRow(a.useful.slice(0, 12))); if (a.useful.length > 12) hint.append(' +' + (a.useful.length - 12) + ' more'); }
      }
    }

    const bar = $('#bar'); bar.innerHTML = '';
    if (dealing) { /* nothing to press while the cards go round */ }
    else if (g.phase === 'idle') bar.append(btn('Deal', deal, 'primary'));
    else if (g.phase === 'over') bar.append(btn('Show result', () => { modal = 'result'; render(); }), btn('Next hand', deal, 'primary'));
    else if (myTurn('draw')) {
      const top = C.topDiscard(g);
      if (g.stock.length) bar.append(btn('Draw from stock', onStock, top == null ? 'primary' : ''));
      if (top != null && C.legalActions(g, ME).takeDiscard) { const b = btn('Take the ' + C.cardName(C.cardType(top)), onTake, completesMe(C.cardType(top)) && g.penalty[ME] === 0 ? 'primary' : ''); bar.append(b); }
      if (!g.stock.length) bar.append(btn('End hand (stock empty)', onEnd));
    } else if (myTurn('discard')) {
      if (pickExtra != null) bar.append(btn('Cancel secret', () => { pickExtra = null; render(); }));
      else {
        const one = selIds.length === 1 ? selIds[0] : null;
        let label = 'Discard (select a card)', off = true;
        if (selIds.length > 1) label = 'Select one card to discard';
        else if (one != null && C.isKing(one)) label = 'Kings can\u2019t be discarded';
        else if (one != null) { label = 'Discard the ' + C.cardName(C.cardType(one)); off = false; }
        const db = btn(label, () => onDiscard(), 'primary', off); db.dataset.key = 'discard-btn';
        bar.append(db);
        for (const opt of C.secretOptions(g, ME)) {
          const label = opt.kind === 'four' ? 'Lay down secret: four ' + C.cardName(opt.type) : 'Lay down secret: three ' + C.cardName(opt.type) + ' (sowee) + one card';
          bar.append(btn(label, () => onSecret(opt)));
        }
      }
    }
  }

  /** Class per card id from the planner: complete groups 'meld', one-short groups 'part'. */
  function handMarks() {
    const marks = {};
    if (!settings.hints || g.phase === 'idle' || g.phase === 'over') return marks;
    const plan = C.keepPlan(C.poolCounts(g, ME), C.slotsFor(g, ME));
    const pool = g.hands[ME].slice().sort(byType).concat(C.extrasOf(g, ME));
    const complete = { king: 1, secret: 1, set: 1, run: 1 }, partial = { set2: 1, run2: 1, secret3: 1 };
    for (const gp of plan) {
      const cls = complete[gp.kind] ? 'meld' : partial[gp.kind] ? 'part' : null;
      for (const t of gp.types) {
        const i = pool.findIndex(id => C.cardType(id) === t);
        if (i < 0) continue;
        const id = pool.splice(i, 1)[0];
        if (cls) marks[id] = cls;
      }
    }
    return marks;
  }

  // ---------- modals ----------
  let modalKind = null;
  function renderModal(force) {
    const m = $('#modal');
    if (!modal) { m.hidden = true; m.innerHTML = ''; modalKind = null; return; }
    if (!force && modalKind === modal && m.firstElementChild && (modal === 'rules' || modal === 'settings' || modal === 'friend')) return; // keep typed text, scroll and focus
    const opening = modalKind !== modal;
    m.hidden = false; m.innerHTML = '';
    let box;
    if (modal === 'result') box = resultBox();
    else if (modal === 'time') box = timeBox();
    else if (modal === 'rules') box = rulesBox();
    else if (modal === 'friend') box = friendBox();
    else box = settingsBox();
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
    const h2 = box.querySelector('h2'); if (h2) { h2.id = 'dialog-title-' + modal; box.setAttribute('aria-labelledby', h2.id); }
    m.append(box);
    m.onclick = e => { if (e.target === m && modal !== 'time') closeModal(); };
    modalKind = modal;
    if (opening) { const f = box.querySelector('.btn.primary') || box.querySelector('.btn'); if (f) setTimeout(() => { try { f.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 0); }
  }

  function resultBox() {
    const r = g.result, box = el('div', 'box');
    if (!r) { box.append(el('p', null, 'No result yet.')); box.append(barWith(btn('Close', closeModal))); return box; }
    if (r.type === 'draw') {
      box.append(el('h2', null, 'Stock exhausted'));
      box.append(el('p', null, 'Nobody completed a hand before the stock ran out, so the hand is a draw and nobody pays (secrets already paid stand). ' + name(g.dealer) + ' deals again.'));
    } else {
      const w = r.winner, mine = w === ME, partner = w === C.partnerOf(ME);
      box.append(el('h2', null, 'Cuajo! ' + (mine ? 'You win the hand' : name(w) + (partner ? ' (your partner)' : '') + ' wins the hand')));
      const src = { stock: 'drawn from the stock', discard: 'taken from the discard pile', time: 'claimed with “time” from another player’s stock draw', deal: 'the hand was complete as dealt' }[r.source];
      box.append(el('h3', null, 'Winning hand'));
      const groups = el('div', 'groups');
      let bounitMarked = false;
      for (const gp of r.groups) {
        const ge = el('div', 'group');
        for (const t of gp.types) {
          const ce = cardEl(t, { mini: true });
          if (!bounitMarked && r.bounit != null && t === C.cardType(r.bounit)) { ce.classList.add('bounit'); bounitMarked = true; }
          ge.append(ce);
        }
        groups.append(ge);
      }
      for (const s of r.secrets) { const ge = el('div', 'group'); for (const id of s.cards.concat(s.extra != null ? [s.extra] : [])) ge.append(cardEl(C.cardType(id), { mini: true })); ge.append(el('span', 'tag', s.kind === 'sowee' ? 'sowee secret' : 'secret')); groups.append(ge); }
      box.append(groups);
      if (r.extraDraws && r.extraDraws.length) {
        box.append(el('h3', null, 'Extra cards drawn from the stock'));
        box.append(el('p', null, 'The conditions were not met from the hand, so ' + plural(r.extraDraws.length, 'extra card') + (r.extraDraws.length === 1 ? ' was' : ' were') + ' drawn (up to 15 allowed)' + (r.cond1 && r.cond2 ? ' until both conditions held.' : ' without meeting both conditions.')), miniRow(r.extraDraws.map(C.cardType)));
      }
      box.append(el('h3', null, 'Payment'));
      const dl = el('dl', 'kv');
      const kv = (k, v) => dl.append(el('dt', null, k), el('dd', null, v));
      if (r.bounit != null) kv('Bounit (winning card)', C.cardName(C.cardType(r.bounit)) + ' — ' + src); else kv('Bounit', src);
      kv('Kings in the hand', r.kings + (r.kings ? ' (worth ' + C.money(r.kingsValue) + ')' : ''));
      if (r.porbis) kv('Porbis', 'no kings, or one king inside its jack-horse-king run: a flat ' + C.money(300));
      else if (r.fromStock) kv('Bounit from the stock', C.money(110) + ' + kings');
      else {
        kv('Two cards go with the bounit', r.cond1 ? 'yes' : 'no');
        kv('A card identical to the sowee + two that go with it', r.cond2 ? 'yes' : 'no');
        kv('Base payment', C.money(r.base) + ' + kings');
      }
      kv('Each opponent pays', C.money(r.perOpponent));
      const delta = mine ? r.total : partner ? 0 : -r.perOpponent;
      kv('Your balance', (delta > 0 ? '+' : '') + C.money(delta) + (partner ? ' (partners do not pay each other)' : ''));
      kv('Next dealer', name(g.nextDealer) + (g.dealRule === 'right' ? ' (the deal passes to the right)' : ' (the winner deals)'));
      box.append(dl);
    }
    box.append(barWith(btn('Close', closeModal), btn('Next hand', deal, 'primary')));
    return box;
  }

  function timeBox() {
    const o = g.timeOffer, box = el('div', 'box');
    box.append(el('h2', null, 'Time!'));
    const row = el('div', 'time-card');
    row.append(cardEl(C.cardType(o.card)));
    row.append(el('p', null, name(o.from) + ' drew the ' + C.cardName(C.cardType(o.card)) + ' from the stock and showed it because you are purro. It completes your hand: say “time” to claim it and win.'));
    box.append(row);
    box.append(barWith(btn('Let it go', () => onTime(false)), btn('Time! Claim it', () => onTime(true), 'primary')));
    return box;
  }

  function settingsBox() {
    const box = el('div', 'box settings');
    box.append(el('h2', null, 'Settings'));
    const row = (label, control) => { const r = el('label', 'row'); r.append(el('span', null, label), control); box.append(r); return r; };
    const select = (id, value, options, onChange) => {
      const s = el('select'); s.id = id;
      for (const [v, t] of options) { const o = el('option', null, t); o.value = v; o.selected = String(value) === v; s.append(o); }
      s.addEventListener('change', () => onChange(s.value));
      return s;
    };
    const check = (id, value, onChange) => { const c = el('input'); c.type = 'checkbox'; c.id = id; c.checked = !!value; c.addEventListener('change', () => onChange(c.checked)); return c; };

    box.append(el('h3', null, 'Players'));
    const where = i => i === ME ? 'Your name' : i === C.partnerOf(ME) ? 'Your partner, across the table' : i === (ME + 1) % 4 ? 'Opponent on your right' : 'Opponent on your left';
    for (const i of [ME, C.partnerOf(ME), (ME + 1) % 4, (ME + 3) % 4]) {
      const fixed = mode === 'guest' || (i !== 0 && isHuman(i));
      if (fixed) {
        const r = el('div', 'row'); r.append(el('span', null, where(i)), el('span', 'fixed-name', name(i) + (isHuman(i) && i !== ME ? ' (a person)' : '')));
        box.append(r); continue;
      }
      const inp = el('input'); inp.type = 'text'; inp.id = 'name-' + i; inp.value = settings.names[i]; inp.maxLength = 14; inp.placeholder = DEFAULT_SETTINGS.names[i];
      inp.addEventListener('input', () => { settings.names[i] = inp.value.trim() || DEFAULT_SETTINGS.names[i]; applyNames(); save(); render(); });
      row(where(i) + (isHuman(i) ? '' : ' (computer)'), inp);
    }
    if (mode !== 'guest') {
      const rr = el('div', 'row');
      rr.append(el('span', null, 'Give the computer players their original names'), btn('Reset names', () => { settings.names = settings.names.map((n, i) => (i === 0 ? n : DEFAULT_SETTINGS.names[i])); applyNames(); save(); render(); renderModal(true); }));
      box.append(rr);
    }

    box.append(el('h3', null, 'Game'));
    row('How fast the other players move', select('speed', settings.speed, [['slow', 'Relaxed'], ['realistic', 'Realistic'], ['normal', 'Quick'], ['fast', 'Fast']], v => { settings.speed = v; save(); }));
    if (mode !== 'guest') {
      row('Computer players', select('difficulty', settings.difficulty, [['easy', 'Easy: they make plenty of mistakes'], ['normal', 'Normal: they slip up now and then'], ['hard', 'Hard: they play their best']], v => { settings.difficulty = v; C.setDifficulty(g, v); save(); }));
      row('After a win, the next deal goes to', select('dealrule', settings.dealRule, [['winner', 'The winner (standard rule)'], ['right', 'The next player to the right']], v => { settings.dealRule = v; g.dealRule = v; save(); }));
    }

    box.append(el('h3', null, 'Table and cards'));
    row('Card size', select('cardsize', settings.cardSize, [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']], v => { settings.cardSize = v; applyLook(); save(); render(); }));
    row('Table', select('felt', settings.felt, [['green', 'Green felt'], ['blue', 'Blue felt'], ['burgundy', 'Burgundy felt'], ['wood', 'Wooden table']], v => { settings.felt = v; applyLook(); save(); }));
    row('Card backs', select('back', settings.back, [['red', 'Red'], ['blue', 'Blue']], v => { settings.back = v; applyLook(); save(); render(); }));
    row('Money', select('currency', settings.currency, [['peso', 'Pesos (₱)'], ['dollar', 'Dollars ($)']], v => { settings.currency = v; applyLook(); save(); render(); }));

    box.append(el('h3', null, 'Help and sound'));
    row('Sounds (card snaps, your-turn chime, Purro and Cuajo calls)', check('sound', settings.sound, v => { settings.sound = v; save(); if (v) sfx('turn'); }));
    row('Show hints (best discard, useful draws, grouping marks)', check('hints', settings.hints, v => { settings.hints = v; save(); render(); }));
    row('Cards you pick up go', select('newcards', settings.newCards, [['end', 'To the right end of your hand'], ['sorted', 'Into place, in suit or rank order']], v => { settings.newCards = v; save(); render(); }));
    if (mode === 'solo') row('Open hands (learning mode: see everyone’s cards)', check('openhands', settings.openHands, v => { settings.openHands = v; save(); render(); }));

    if (mode !== 'guest') {
      const reset = el('div', 'row');
      reset.append(el('span', null, 'Start a new game (scores back to zero)'));
      reset.append(confirmReset
        ? btn('Yes, start over', () => { confirmReset = false; newGame(mode === 'solo' ? [0] : humansOf().slice()); }, 'danger')
        : btn('New game…', () => { confirmReset = true; renderModal(true); const b = $('#modal .btn.danger'); if (b) b.focus(); }));
      box.append(reset);
    }
    box.append(barWith(btn('Close', closeModal, 'primary')));
    return box;
  }

  function rulesBox() {
    const box = el('div', 'box rules');
    box.innerHTML = RULES_HTML;
    box.append(barWith(btn('Close', closeModal, 'primary')));
    return box;
  }
  function barWith() { const b = el('div', 'bar'); for (const x of arguments) b.append(x); return b; }

  const RULES_HTML = [
    '<h2>How to play Cuajo</h2>',
    '<p>Cuajo (also written <i>kuajo</i> or <i>kuwaho</i>) is a Filipino rummy game of the mahjong family, played with a 112-card Spanish-suited pack: coins (<i>oros</i>), cups (<i>copas</i>), swords (<i>espadas</i>) and batons (<i>bastos</i>), each suit holding ace, 3, 4, 5, jack (<i>sota</i>), horse (<i>caballo</i>) and king (<i>rey</i>), with four identical copies of every card.</p>',
    '<p>The cards follow the traditional Spanish pattern: the ace is numbered 1, the court cards 10 (sota, the jack), 11 (caballo, the horse) and 12 (rey, the king), and the breaks in each card’s frame line show its suit: none for coins, one for cups, two for swords, three for batons.</p>',
    '<h3>Players and deal</h3>',
    '<p>Four players in two partnerships: you and North against East and West. The dealer takes 16 cards and everyone else 15. The next card is turned face up as the <b>sowee</b>; it is never played but affects the payment. The rest is the stock. The dealer discards first, and play passes to the right (you, then East, North, West). The winner of a hand deals the next one; after a drawn hand the same player deals again.</p>',
    '<h3>Your turn</h3>',
    '<ol><li>Take the top card of the stock, or the previous player’s discard (the top of the discard pile). A discard can only be taken by the next player in turn.</li><li>If you hold four identical cards, you may lay them face down as a <b>secret</b> and each opponent pays you 50 centavos at once. The three cards identical to the sowee also make a secret when laid down together with any fourth card from your hand; that fourth card is not free: it must still be part of a combination when you win, so a king is the usual choice.</li><li>Discard one card face up. <b>Kings are never discarded.</b></li></ol>',
    '<h3>Combinations</h3>',
    '<ul><li><b>Set</b>: three or four cards of the same rank in different suits.</li><li><b>Run</b>: 3-4-5 or jack-horse-king in one suit (aces never run).</li><li><b>Secret</b>: four identical cards.</li><li><b>King</b>: a king counts as a combination on its own.</li></ul>',
    '<h3>Purro and time</h3>',
    '<p>When one more card would complete your hand, you say <b>purro</b> after discarding and set a king face up as a marker. From then on the other players show every card they draw from the stock. If someone draws the card you need, you call <b>time</b>, take it, and win. When a shown card completes more than one hand, the player who drew it wins if it completes theirs; otherwise the first purro player after them in turn order. Out of turn you can only win with a card drawn from the stock, never with a discard.</p>',
    '<p>If you draw a king that does not complete your hand and you can no longer finish with one card, you announce that you are no longer purro and take back the marker. For your next two turns you must show every card you draw and may not announce purro or win; on the third turn you play normally again.</p>',
    '<h3>Winning and payment</h3>',
    '<p>The first player to arrange all 16 cards (secrets included) into combinations wins the hand. The winning card is the <b>bounit</b>. Each opponent pays the winner; partners pay nothing to each other. Two things raise the payment: (1) two cards in your hand that <b>go with</b> the bounit, and (2) a card identical to the sowee plus two cards that go with it. Cards go with a card when they form a run with it in the same suit; for an ace, two other aces of different suits. If the bounit came from another player and the conditions are not met from your hand, you first draw up to 15 extra cards from the stock looking for them; those cards need not be melded and add no king value.</p>',
    '<table><tr><th>Situation</th><th>Each opponent pays</th></tr>',
    '<tr><td>Bounit drawn from the stock</td><td>₱1.10 + kings</td></tr>',
    '<tr><td>Bounit from another player, both conditions met (from the hand or after the extra cards)</td><td>₱1.10 + kings</td></tr>',
    '<tr><td>… only two cards go with the bounit</td><td>₱0.60 + kings</td></tr>',
    '<tr><td>… only the sowee condition</td><td>₱0.70 + kings</td></tr>',
    '<tr><td>… neither</td><td>₱0.20 + kings</td></tr>',
    '<tr><td><b>Porbis</b>: no kings, or a single king inside its jack-horse-king run</td><td>₱3.00 flat</td></tr></table>',
    '<p>Kings are worth 50 centavos for the king of coins and 20 centavos for any other king. A bounit claimed with “time” counts as taken from another player. If the stock runs out the hand is a draw with no payment (secrets already paid stand).</p>',
    '<h3>Arranging your hand</h3>',
    '<p>Click cards to select them (click again to let go), then press <b>Group</b> to keep them together. Each group is labelled: Set, Run, Kings or Four alike when it is a finished combination, Needs 1 when one card is missing, or No match. Drag a card into or out of a group, drag a group by its label to move it, or press the \u00d7 on its label to break it up. <b>Auto-group</b> sorts your whole hand into groups for you; Suit and Rank sort the loose cards. Drag cards to put them in any order (on a touch screen, press and hold a card first). New cards arrive at the right end. On your discard turn, select one card and press Discard, double-click it, or drop it on the discard pile. With the keyboard, Enter selects the focused card and Shift + left or right arrow moves it.</p>',
    '<p>The computer players are not perfect. On Normal they now and then miss a useful discard, throw away a slightly worse card, or fail to notice a card they could claim with \u201ctime\u201d. Easy makes them sloppier and Hard makes them play their best; choose in Settings.</p>',
    '<p>The other players take their time like real people: you can watch each one think, draw, and discard. If it feels slow, press <b>Next move</b> (or the N key) to skip the pause; every card still moves across the table so you can follow it. Each hand starts with the deal going round the table. You can also change the pace in Settings.</p>',
    '<h3>Playing with a friend</h3>',
    '<p>Press <b>Play with a friend</b>. <b>On this computer</b>, you take turns: your cards are hidden between turns and the game asks you to pass the computer when it is the other person\u2019s go. <b>Online</b>, one of you starts a game and sends the code or link; the other joins with it, and each plays on their own computer. Your friend plays as your partner or as an opponent, and computer players fill the other seats. Online play needs the website version of the game (' + PAGES_URL + ') or the downloaded file.</p>',
    '<p><b>Settings</b> lets you rename the players, choose the table and card backs, card size, pesos or dollars, sounds, where picked-up cards go, and whether the winner or the next player deals after a win.</p>',
    '<h3>House choices in this version</h3>',
    '<ul><li>When the stock is empty, the player to move may still take the last discard if it wins; otherwise the hand ends.</li><li>Purro is announced automatically whenever you are one card away, and the two-turn penalty after a broken purro is applied automatically.</li><li>Amounts are shown in pesos with the figures from the source rules.</li></ul>',
    '<p>Rules after <a href="https://www.pagat.com/rummy/cuajo.html" target="_blank" rel="noopener">pagat.com: Cuajo</a>.</p>'
  ].join('');

  // ---------- playing with a friend ----------
  // Two routes to the other computer: a direct browser-to-browser connection (PeerJS/WebRTC), and,
  // when that cannot be made (some networks block it), a relay through three public MQTT servers at
  // once. Relay messages are encrypted with a key made from the game code. The host's computer runs
  // the game and sends the guest only what that seat may see; the guest sends back its moves.
  const PEERJS_URL = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';
  const MQTT_URL = 'https://cdn.jsdelivr.net/npm/mqtt@5.10.1/dist/mqtt.min.js';
  const RELAYS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081'];
  const ICE = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }, { urls: 'stun:stun.cloudflare.com:3478' }] };
  const QS = (() => { try { return new URLSearchParams(location.search); } catch (e) { return new URLSearchParams(''); } })();
  const FORCE_RELAY = QS.get('relay') === '1';          // testing: skip the direct route
  const PID = (() => { let p = null; try { p = sessionStorage.getItem('cuajo.pid'); } catch (e) { /* no storage */ } if (!p) { p = makeCode() + makeCode(); try { sessionStorage.setItem('cuajo.pid', p); } catch (e) { /* no storage */ } } return p; })();
  const loaded = {};
  function loadScript(src, globalName) {
    if (window[globalName]) return Promise.resolve();
    if (!loaded[src]) loaded[src] = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = src;
      s.onload = () => (window[globalName] ? res() : rej(new Error(globalName + ' missing')));
      s.onerror = () => { delete loaded[src]; rej(new Error(src + ' did not load')); };
      document.head.appendChild(s);
    });
    return loaded[src];
  }
  const WEB_NOTE = 'Online play works on the website (' + PAGES_URL + ') and in the downloaded file, but not inside the Claude preview.';
  function makeCode() {
    const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', a = new Uint32Array(5);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.from(a, x => A[x % A.length]).join('');
  }
  function joinLink(code) {
    const base = /^https?:$/.test(location.protocol) && location.hostname.indexOf('claude') < 0 ? location.origin + location.pathname : PAGES_URL;
    return base + '?join=' + code;
  }

  // --- encryption for the relay route ---
  async function roomKeys(code) {
    const enc = new TextEncoder(), sha = async s => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
    const t = await sha('cuajo-room:' + code);
    const room = 'cuajo/v1/' + Array.from(t.slice(0, 12), b => b.toString(16).padStart(2, '0')).join('');
    const key = await crypto.subtle.importKey('raw', await sha('cuajo-key:' + code), 'AES-GCM', false, ['encrypt', 'decrypt']);
    return { room, key };
  }
  async function seal(key, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj))));
    const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return out;
  }
  async function unseal(key, bytes) {
    const b = new Uint8Array(bytes);
    return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12) }, key, b.slice(12))));
  }
  /** Joins the game's relay channel on every relay server; messages go out on all of them and repeats are dropped. */
  async function openRelay(code, role) {
    await loadScript(MQTT_URL, 'mqtt');
    const { room, key } = await roomKeys(code);
    const inbox = room + (role === 'host' ? '/to-host' : '/to-guest'), outbox = room + (role === 'host' ? '/to-guest' : '/to-host');
    const r = { kind: 'relay', me: makeCode() + makeCode(), clients: [], handlers: [], seen: {}, seq: 0, closed: false };
    r.onMessage = fn => r.handlers.push(fn);
    r.send = msg => {
      if (r.closed) return;
      seal(key, { f: r.me, s: ++r.seq, m: msg }).then(env => { for (const c of r.clients) if (c.connected) { try { c.publish(outbox, env, { qos: 0 }); } catch (e) { /* this server is down */ } } });
    };
    r.close = () => { r.closed = true; for (const c of r.clients) { try { c.end(true); } catch (e) { /* ignore */ } } };
    r.servers = () => r.clients.filter(c => c.connected).length;
    RELAYS.forEach((url, i) => {
      const c = window.mqtt.connect(url, { clientId: 'cuajo_' + r.me + '_' + i, clean: true, connectTimeout: 7000, reconnectPeriod: 3000, keepalive: 30 });
      c.on('connect', () => c.subscribe(inbox, { qos: 0 }));
      c.on('message', (topic, payload) => {
        if (topic !== inbox || r.closed) return;
        unseal(key, payload).then(env => {
          if (!env || !env.f || env.f === r.me || r.closed) return;
          if (env.s <= (r.seen[env.f] || 0)) return;        // the same message through another server
          r.seen[env.f] = env.s;
          for (const h of r.handlers) h(env.m, env.f);
        }, () => { /* not ours */ });
      });
      c.on('error', () => { /* keep trying the others */ });
      r.clients.push(c);
    });
    await new Promise(res => { const t0 = Date.now(); (function wait() { if (r.servers() || Date.now() - t0 > 9000) res(); else setTimeout(wait, 100); })(); });
    if (!r.servers()) { r.close(); throw new Error('no relay server reachable'); }
    return r;
  }
  /** Wraps a direct PeerJS connection in the same shape as the relay. */
  function directLink(conn) {
    const l = { kind: 'direct', conn, handlers: [], closeHandlers: [], closed: false };
    l.onMessage = fn => l.handlers.push(fn);
    l.onClose = fn => l.closeHandlers.push(fn);
    l.send = msg => { if (!l.closed && conn.open) { try { conn.send(msg); } catch (e) { /* closing */ } } };
    l.close = () => { l.closed = true; try { conn.close(); } catch (e) { /* ignore */ } };
    conn.on('data', m => { if (!l.closed) for (const h of l.handlers) h(m); });
    conn.on('close', () => { if (!l.closed) { l.closed = true; for (const h of l.closeHandlers) h(); } });
    return l;
  }
  function closeNet(n) {
    if (!n) return;
    try { if (n.link && n.link.direct) n.link.direct.close(); } catch (e) { /* ignore */ }
    try { if (n.relay) n.relay.close(); } catch (e) { /* ignore */ }
    try { if (n.peer) n.peer.destroy(); } catch (e) { /* ignore */ }
  }
  function send(msg) { if (net && net.link) net.link.send(msg); }
  // Every few seconds each side says hello; after 16 s of silence the other computer counts as gone.
  setInterval(() => {
    if (!net || !net.link) return;
    net.link.send({ t: 'ping' });
    if (Date.now() - (net.lastSeen || Date.now()) > 16000) linkLost();
  }, 4000);

  /** What the guest's seat is allowed to see: other hands, the stock and the shuffle stay hidden until the hand is over. */
  function viewFor(seat) {
    const v = JSON.parse(JSON.stringify(g)), over = g.phase === 'over';
    v.rng = 0; v.seed = 0;
    v.stock = g.stock.map(() => -1);
    for (let s = 0; s < 4; s++) {
      if (s === seat || over) continue;
      v.hands[s] = g.hands[s].map(id => (g.purro[s] && id === g.marker[s]) ? id : -1);
      v.secrets[s] = g.secrets[s].map(x => Object.assign({}, x, { cards: x.cards.map(() => -1), extra: x.extra != null ? -1 : null, type: x.kind === 'sowee' ? x.type : -1 }));
      v.waiting[s] = [];
    }
    if (!over && g.drawn != null && g.turn !== seat && g.drawnFrom === 'stock' && !(g.lastShown && g.lastShown.id === g.drawn)) v.drawn = null;
    return v;
  }
  function sendState() {
    const move = lastMove; lastMove = null;
    if (!net || net.role !== 'host' || !net.link) return;
    const seat = net.friendSeat;
    const m = move && move.kind === 'draw' && move.src === 'stock' && !move.shown && move.seat !== seat ? Object.assign({}, move, { id: null }) : move;
    send({ t: 'state', view: viewFor(seat), move: m });
  }
  function myNameInput() {
    const n = (($('#friend-myname') || {}).value || '').trim().slice(0, 14);
    if (n) settings.names[0] = n;
    return settings.names[0];
  }
  function startLocal() {
    myNameInput();
    const seat = +(($('#friend-seat') || {}).value || 2);
    const friend = ((($('#friend-name') || {}).value || '').trim() || 'Friend').slice(0, 14);
    mode = 'local'; ME = 0; humanNames = {}; humanNames[seat] = friend;
    modal = null;
    newGame([0, seat]);
    deal();
  }

  // --- hosting ---
  async function hostOnline() {
    myNameInput(); save();
    const seat = +(($('#friend-seat') || {}).value || 2);
    friendUi.error = '';
    const mine = net = { role: 'host', code: makeCode(), friendSeat: seat, ready: false, link: null, away: false, started: false, peer: null, relay: null, friendPid: null };
    renderModal(true);
    if (!FORCE_RELAY) await startHostPeer(mine);          // settles the code (it must be free on the direct route)
    if (net !== mine) return;
    try {
      const r = await openRelay(mine.code, 'host');
      if (net !== mine) { r.close(); return; }
      mine.relay = r;
      r.onMessage((m, from) => hostIncoming(m, { kind: 'relay', from }));
    } catch (e) { console.warn('relay route unavailable', e); }
    if (net !== mine) return;
    if (!mine.peer && !mine.relay) { friendUi.error = 'Could not reach the connection services. Check the internet connection and try again. ' + WEB_NOTE; closeNet(mine); net = null; }
    else mine.ready = true;
    renderModal(true);
  }
  async function startHostPeer(mine) {
    try { await loadScript(PEERJS_URL, 'Peer'); } catch (e) { return; }
    for (let tries = 0; tries < 3 && net === mine; tries++) {
      const ok = await new Promise(res => {
        const peer = new window.Peer('cuajo-' + mine.code, { config: ICE });
        let settled = false;
        const done = v => { if (!settled) { settled = true; res(v); } };
        peer.on('open', () => { mine.peer = peer; done('ok'); });
        peer.on('connection', conn => conn.on('open', () => {
          if (net !== mine) { try { conn.close(); } catch (e) { /* ignore */ } return; }
          const l = directLink(conn);
          l.onMessage(m => hostIncoming(m, { kind: 'direct', link: l }));
          l.onClose(() => { if (net === mine && mine.link && mine.link.direct === l) linkLost(); });
        }));
        peer.on('error', e => {
          if (e.type === 'unavailable-id') { try { peer.destroy(); } catch (x) { /* ignore */ } done('taken'); return; }
          if (!settled) { try { peer.destroy(); } catch (x) { /* ignore */ } done('failed'); }
          else console.warn('direct route', e.type);
        });
        setTimeout(() => { if (!settled) { try { peer.destroy(); } catch (x) { /* ignore */ } done('failed'); } }, 7000);
      });
      if (ok === 'taken') { mine.code = makeCode(); continue; }
      return;
    }
  }
  function hostIncoming(msg, via) {
    if (!msg || !net || net.role !== 'host') return;
    const mine = net, seat = mine.friendSeat;
    const current = mine.link && (via.kind === 'relay' ? mine.link.kind === 'relay' && mine.link.from === via.from : mine.link.direct === via.link);
    if (msg.t === 'hello') {
      if (current && mine.started && !mine.away) { mine.link.send({ t: 'welcome', seat, v: 2, rejoin: true }); sendState(); return; }   // a repeated hello
      const samePerson = mine.friendPid && msg.pid === mine.friendPid;
      if (mine.link && !current && !samePerson && !mine.away) {
        if (via.kind === 'relay') mine.relay.send({ t: 'full', to: via.from }); else via.link.send({ t: 'full' });
        return;
      }
      if (mine.link && mine.link.direct && mine.link.direct !== via.link) mine.link.direct.close();
      mine.link = via.kind === 'relay'
        ? { kind: 'relay', from: via.from, send: m => mine.relay && mine.relay.send(Object.assign({ to: via.from }, m)) }
        : { kind: 'direct', direct: via.link, send: m => via.link.send(m) };
      mine.lastSeen = Date.now();
      const nm0 = String(msg.name || '').trim().slice(0, 14), nm = nm0 && nm0 !== 'You' ? nm0 : 'Friend';
      humanNames = {}; humanNames[seat] = nm;
      if (mine.started && (samePerson || mine.away)) {       // coming back to the game in progress
        mine.friendPid = msg.pid || mine.friendPid; mine.away = false;
        mode = 'host'; g.humans = [0, seat]; applyNames(); C.setDifficulty(g, settings.difficulty);
        mine.link.send({ t: 'welcome', seat, v: 2, rejoin: true });
        flash(nm + ' is back in the game.');
        changed();
        return;
      }
      mine.friendPid = msg.pid || null; mine.started = true;
      mode = 'host'; if (ME !== 0) switchMe(0);
      mine.link.send({ t: 'welcome', seat, v: 2 });
      modal = null;
      newGame([0, seat]);             // a fresh scoreboard for the two of you
      deal();
      flash(nm + ' joined the game.');
      return;
    }
    if (!current) return;
    mine.lastSeen = Date.now();
    if (msg.t === 'ping') { mine.link.send({ t: 'pong' }); return; }
    if (msg.t === 'pong') return;
    if (msg.t === 'bye') { friendGone(true); return; }
    if (mode !== 'host') return;
    if (msg.t === 'skip') { skipAhead(); return; }
    if (msg.t !== 'act') return;
    try {
      if (msg.a === 'deal') { if (!dealing && (g.phase === 'over' || g.phase === 'idle')) deal(); return; }
      if (dealing) return;
      const la = C.legalActions(g, seat), a = msg.a, arg = msg.arg;
      const ok = a === 'drawStock' ? la.drawStock : a === 'takeDiscard' ? la.takeDiscard : a === 'endHand' ? la.endHand
        : a === 'discard' ? la.discard && g.hands[seat].indexOf(arg) >= 0 && !C.isKing(arg)
        : a === 'secret' ? la.discard && !!arg && la.secrets.some(o => o.type === arg.type)
        : a === 'time' ? la.timeClaim : false;
      if (!ok) { sendState(); return; }
      const r = act(seat, a, arg); announce(r.b); drive();
    } catch (e) { console.error(e); sendState(); }
  }
  /** The friend left on purpose (bye) or the connection dropped. A computer player fills the seat; they can rejoin with the same code. */
  function friendGone(onPurpose) {
    if (!net || net.role !== 'host') return;
    const mine = net, seat = mine.friendSeat, nm = humanNames[seat] || 'Your friend', wasPlaying = mode === 'host';
    if (mine.link && mine.link.direct) mine.link.direct.close();
    mine.link = null;
    if (!wasPlaying) { renderModal(true); return; }
    mine.away = true; mode = 'solo';
    if (g) { g.humans = [0]; applyNames(); C.setDifficulty(g, settings.difficulty); }
    flash(onPurpose ? nm + ' left. A computer player takes that seat; they can rejoin with code ' + mine.code + '.'
      : nm + ' lost the connection. A computer player fills in until they rejoin.');
    changed();
  }

  // --- joining ---
  async function joinOnline() {
    myNameInput();
    const code = ((($('#join-code') || {}).value || '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
    friendUi.joinCode = code;
    if (code.length < 4) { friendUi.error = 'Type the game code your friend sent you.'; renderModal(true); return; }
    save();                          // keep your own game; it comes back when you leave
    friendUi.error = '';
    const mine = net = { role: 'guest', code, connected: false, link: null, peer: null, relay: null, reconnecting: false };
    renderModal(true);
    const ok = await connectGuest(mine);
    if (net === mine && !ok) { friendUi.error = 'No game found with code ' + code + '. Check the code with your friend, and make sure their game is still open.'; closeNet(mine); net = null; renderModal(true); }
  }
  /** Tries the direct route first, then the relay. Resolves true once the host has welcomed us. */
  async function connectGuest(mine) {
    if (!FORCE_RELAY && await guestDirect(mine, 6000)) return true;
    if (net !== mine) return false;
    return guestRelay(mine, 10000);
  }
  function waitWelcome(mine, ms) {
    return new Promise(res => { const t0 = Date.now(); (function w() { if (net !== mine) res(false); else if (mine.welcomed) res(true); else if (mine.routeFailed || Date.now() - t0 > ms) res(false); else setTimeout(w, 100); })(); });
  }
  async function guestDirect(mine, ms) {
    try { await loadScript(PEERJS_URL, 'Peer'); } catch (e) { return false; }
    mine.welcomed = false; mine.routeFailed = false;
    const peer = new window.Peer({ config: ICE });
    mine.peer = peer;
    peer.on('open', () => {
      if (net !== mine) return;
      const conn = peer.connect('cuajo-' + mine.code, { reliable: true });
      conn.on('open', () => {
        if (net !== mine) { try { conn.close(); } catch (e) { /* ignore */ } return; }
        const l = directLink(conn);
        l.onMessage(m => { if (net === mine) { mine.link = mine.link || { kind: 'direct', direct: l, send: x => l.send(x) }; guestIncoming(m); } });
        l.onClose(() => { if (net === mine && mine.link && mine.link.direct === l) linkLost(); });
        mine.link = { kind: 'direct', direct: l, send: x => l.send(x) };
        l.send({ t: 'hello', name: settings.names[0], pid: PID, v: 2 });
      });
    });
    peer.on('error', e => { if (!mine.welcomed && (e.type === 'peer-unavailable' || e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error')) mine.routeFailed = true; });
    const ok = await waitWelcome(mine, ms);
    if (!ok) { if (mine.link && mine.link.direct) mine.link.direct.close(); mine.link = null; try { peer.destroy(); } catch (e) { /* ignore */ } if (mine.peer === peer) mine.peer = null; }
    return ok;
  }
  async function guestRelay(mine, ms) {
    let r;
    try { r = await openRelay(mine.code, 'guest'); } catch (e) { return false; }
    if (net !== mine) { r.close(); return false; }
    mine.relay = r; mine.welcomed = false; mine.routeFailed = false;
    mine.link = { kind: 'relay', send: x => r.send(x) };
    r.onMessage(m => { if (net === mine && (!m.to || m.to === r.me)) guestIncoming(m); });
    const hello = () => r.send({ t: 'hello', name: settings.names[0], pid: PID, v: 2 });
    hello();
    const again = setInterval(() => { if (net !== mine || mine.welcomed || r.closed) clearInterval(again); else hello(); }, 2000);   // in case we reached different relay servers first
    const ok = await waitWelcome(mine, ms);
    clearInterval(again);
    if (!ok) { r.close(); if (mine.relay === r) mine.relay = null; mine.link = null; }
    return ok;
  }
  function guestIncoming(msg) {
    if (!msg || !net || net.role !== 'guest') return;
    const mine = net;
    mine.lastSeen = Date.now();
    if (msg.t === 'ping') { send({ t: 'pong' }); return; }
    if (msg.t === 'pong') return;
    if (msg.t === 'welcome') {
      if (mine.welcomed) return;                 // a repeat of the same welcome
      const back = mode === 'guest';             // we were already in this game: reconnecting
      mine.welcomed = true; mine.connected = true;
      mode = 'guest'; ME = msg.seat;
      if (!back) { selIds = []; groupOf = {}; handOrder = []; orderHand = 0; pickExtra = null; bubbles = {}; resultShown = false; dealToken++; dealing = false; handHidden = false; promptSeat = null; }
      if (modal === 'friend') modal = null;
      if (back) flash('Reconnected.');
      render(); return;
    }
    if (msg.t === 'full') { mine.welcomed = false; friendUi.error = 'That game already has two players.'; closeNet(mine); net = null; renderModal(true); return; }
    if (msg.t === 'bye') { hostGone(true); return; }
    if (mode !== 'guest') return;
    if (msg.t === 'bubble') { showBubble(msg.seat, msg.text, msg.msec); return; }
    if (msg.t === 'state' && msg.view) applyRemote(msg.view, msg.move);
  }
  function applyRemote(view, move) {
    let from = null;
    if (move) {
      if (move.kind === 'draw') from = move.src === 'stock' ? rectOf('.pile.stock .card') : rectOf('.pile.discard .card');
      else if (move.kind === 'discard') from = cardRect(move.seat, move.id);
      else if (move.kind === 'time') from = seatTarget(move.from).rect;
    }
    const newHand = !g || g.handNo !== view.handNo;
    g = view;
    if (newHand || (move && move.kind === 'deal')) { selIds = []; groupOf = {}; pickExtra = null; resultShown = false; orderHand = 0; if (modal === 'result' || modal === 'time') modal = null; }
    if (move && move.kind === 'deal') { animateDeal(); return; }
    render();
    animateMove(move, from);
    drive();
  }
  /** Lost contact with the other computer (connection closed or silent for 16 s). */
  function linkLost() {
    if (!net || !net.link) return;
    if (net.role === 'host') { friendGone(false); return; }
    const mine = net;
    if (mine.link.direct) mine.link.direct.close();
    if (mine.relay) { mine.relay.close(); mine.relay = null; }
    mine.link = null;
    if (mode !== 'guest') { renderModal(true); return; }
    reconnect(mine);
  }
  /** The guest keeps trying for a minute; meanwhile the game stays on screen. */
  async function reconnect(mine) {
    if (mine.reconnecting) return;
    mine.reconnecting = true; render();
    const until = Date.now() + 60000;
    while (net === mine && Date.now() < until) {
      if (await connectGuest(mine)) { mine.reconnecting = false; render(); return; }
      await wait(2000);
    }
    if (net === mine) hostGone(false);
  }
  function hostGone(onPurpose) {
    if (!net || net.role !== 'guest') return;
    const wasPlaying = mode === 'guest', hostName = name(0);
    closeNet(net); net = null;
    if (wasPlaying) { restoreSolo(); flash(onPurpose ? hostName + ' ended the online game. You are back in your own game.' : 'Could not reconnect to ' + hostName + '. You are back in your own game.'); }
    else renderModal(true);
  }
  function restoreSolo() {
    mode = 'solo'; ME = 0; humanNames = {}; handHidden = false; promptSeat = null; layouts = {};
    const saved = load();
    g = saved && validGame(saved.g) ? saved.g : C.newGame({ names: settings.names, human: 0 });
    g.humans = [0]; applyNames(); C.setDifficulty(g, settings.difficulty);
    handOrder = []; orderHand = 0; groupOf = {}; selIds = []; pickExtra = null; bubbles = {};
    if (modal !== 'friend') modal = null;
    resultShown = g.phase === 'over'; dealToken++; dealing = false;
    render(); drive();
  }
  /** Back to one player against three computer players. */
  function stopFriend() {
    const wasGuest = mode === 'guest' || (net && net.role === 'guest'), n = net;
    if (n) { send({ t: 'bye' }); setTimeout(() => closeNet(n), 400); }
    net = null;
    if (wasGuest) { restoreSolo(); modal = null; render(); return; }
    mode = 'solo'; humanNames = {}; handHidden = false; promptSeat = null;
    if (g) { if (ME !== 0) switchMe(0); g.humans = [0]; applyNames(); C.setDifficulty(g, settings.difficulty); }
    layouts = {}; modal = null; changed();
  }
  function cancelOnline() {
    const n = net; net = null; closeNet(n);
    if (mode === 'guest') restoreSolo();
    renderModal(true);
  }
  function routeLabel() { return !net || !net.link ? '' : net.link.kind === 'direct' ? 'Connected directly.' : 'Connected through relay servers (' + (net.relay ? net.relay.servers() : 0) + ' of ' + RELAYS.length + ' reachable).'; }

  function modeLabel() {
    const friend = Object.keys(humanNames).map(k => humanNames[k])[0] || (mode === 'guest' ? name(0) : 'your friend');
    if (mode === 'local') return 'Pass-and-play with ' + friend;
    if (mode === 'host') return 'Online with ' + friend;
    if (mode === 'guest') return 'Online in ' + name(0) + '’s game';
    return 'Play with a friend';
  }
  function friendBox() {
    const box = el('div', 'box friend');
    box.append(el('h2', null, 'Play with a friend'));
    if (mode !== 'solo') {
      const who = mode === 'guest' ? 'You joined ' + name(0) + '’s game as ' + (C.partnerOf(ME) === 0 ? 'their partner.' : 'their opponent.')
        : mode === 'host' ? humanNames[Object.keys(humanNames)[0]] + ' is playing online as your ' + (isHuman(2) ? 'partner.' : 'opponent.')
        : 'You are sharing this computer with ' + humanNames[Object.keys(humanNames)[0]] + '.';
      box.append(el('p', null, who));
      if (mode !== 'local' && routeLabel()) box.append(el('p', 'route', routeLabel()));
      box.append(barWith(btn('Back to playing alone', stopFriend, 'danger'), btn('Close', closeModal, 'primary')));
      return box;
    }
    if (net && net.role === 'host') {
      box.append(el('p', null, net.away ? (humanNames[net.friendSeat] || 'Your friend') + ' is not connected right now. They can rejoin with this code or link, and a computer player fills in until then.' : 'Send your friend this code or link. The game starts as soon as they join. It works across different networks.'));
      const code = el('div', 'join-code', net.ready ? net.code : '…'); box.append(code);
      if (net.ready) {
        const link = el('input'); link.type = 'text'; link.readOnly = true; link.id = 'join-link'; link.value = joinLink(net.code);
        const copy = btn('Copy link', () => {
          const done = () => { copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy link'; }, 1500); };
          try { navigator.clipboard.writeText(link.value).then(done, () => { link.select(); }); } catch (e) { link.select(); }
        });
        const row = el('div', 'link-row'); row.append(link, copy); box.append(row);
      }
      const st = el('p', 'wait'); st.append(net.ready ? (net.away ? 'Waiting for them to rejoin' : 'Waiting for your friend to join') : 'Setting up the game', el('span', 'thinking'));
      st.lastChild.append(el('i'), el('i'), el('i'));
      box.append(st);
      if (friendUi.error) box.append(el('p', 'error', friendUi.error));
      box.append(barWith(btn(net.away ? 'Stop waiting' : 'Cancel', cancelOnline)));
      return box;
    }
    if (net && net.role === 'guest') {
      const st = el('p', 'wait'); st.append('Connecting to game ' + net.code + ' (this can take up to 15 seconds on some networks)', el('span', 'thinking')); st.lastChild.append(el('i'), el('i'), el('i'));
      box.append(st, barWith(btn('Cancel', cancelOnline)));
      return box;
    }
    const form = el('div', 'settings');
    const row = (label, control) => { const r = el('label', 'row'); r.append(el('span', null, label), control); form.append(r); };
    const me = el('input'); me.type = 'text'; me.id = 'friend-myname'; me.maxLength = 14; me.placeholder = 'Your name'; me.value = settings.names[0] === 'You' ? '' : settings.names[0];
    row('Your name', me);
    const seat = el('select'); seat.id = 'friend-seat';
    for (const [v, t] of [['2', 'My partner (across the table)'], ['1', 'My opponent (on my right)']]) { const o = el('option', null, t); o.value = v; seat.append(o); }
    row('My friend plays as', seat);
    box.append(form);
    box.append(el('h3', null, 'On this computer'));
    box.append(el('p', null, 'Take turns on one computer. Your cards stay hidden while the other person has it.'));
    const fr = el('input'); fr.type = 'text'; fr.id = 'friend-name'; fr.maxLength = 14; fr.placeholder = 'Friend’s name';
    const lr = el('div', 'link-row'); lr.append(fr, btn('Start pass-and-play', startLocal, 'primary')); box.append(lr);
    box.append(el('h3', null, 'Online, each on your own computer'));
    box.append(el('p', null, 'Start a game and send your friend the code or link, or join with the code your friend sent you.'));
    const hb = el('div', 'link-row'); hb.append(btn('Start an online game', hostOnline, 'primary')); box.append(hb);
    const jc = el('input'); jc.type = 'text'; jc.id = 'join-code'; jc.maxLength = 8; jc.placeholder = 'Game code'; jc.value = friendUi.joinCode || ''; jc.autocapitalize = 'characters';
    const jr = el('div', 'link-row'); jr.append(jc, btn('Join', joinOnline)); box.append(jr);
    if (friendUi.error) box.append(el('p', 'error', friendUi.error));
    box.append(barWith(btn('Close', closeModal)));
    return box;
  }

  // ---------- boot ----------
  function wire() {
    $('#btn-rules').addEventListener('click', () => { modal = 'rules'; render(); });
    $('#btn-friend').addEventListener('click', () => { modal = 'friend'; friendUi.error = ''; renderModal(true); });
    $('#btn-settings').addEventListener('click', () => { modal = 'settings'; confirmReset = false; render(); });
    document.addEventListener('keydown', e => {
      const typing = e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
      if ((e.key === 'n' || e.key === 'N') && !typing && !modal && !e.metaKey && !e.ctrlKey && !e.altKey) { skipAhead(); return; }
      if (e.key !== 'Escape') return;
      if (drag && drag.active) { endDrag(true); return; }
      if (modal && modal !== 'time') closeModal();
    });
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', onDragEnd);
    window.addEventListener('touchmove', e => { if (drag && drag.active) e.preventDefault(); }, { passive: false });
    window.addEventListener('blur', () => { if (drag && drag.active) endDrag(true); });
  }
  function validGame(x) {
    if (!x || x.version !== 2) return false;
    for (const k of ['balances', 'wins', 'hands', 'secrets', 'purro', 'waiting', 'marker', 'penalty']) if (!Array.isArray(x[k]) || x[k].length !== 4) return false;
    if (['idle', 'draw', 'discard', 'timeOffer', 'over'].indexOf(x.phase) < 0) return false;
    if (x.phase === 'over' && !x.result) return false;
    if (x.phase === 'timeOffer' && !x.timeOffer) return false;
    return Array.isArray(x.stock) && Array.isArray(x.discards) && Array.isArray(x.events) && !!x.seenIds;
  }
  function start(data) {
    const saved = (data && data.g) ? data : load();
    if (saved && saved.settings) {
      settings = Object.assign({}, DEFAULT_SETTINGS, saved.settings, { names: (Array.isArray(saved.settings.names) && saved.settings.names.length === 4 ? saved.settings.names : DEFAULT_SETTINGS.names).slice() });
      if (saved.settings.v !== 2) { settings.speed = 'realistic'; settings.v = 2; }   // older copies ran the other players quickly
      if (PACE[settings.speed] === undefined) settings.speed = 'realistic';
    }
    if (saved && validGame(saved.g)) g = saved.g;
    else g = C.newGame({ names: settings.names, human: 0 });
    const multi = saved && saved.multi;
    if (multi && multi.mode === 'local' && g === saved.g && Array.isArray(g.humans) && g.humans.length > 1) { mode = 'local'; humanNames = multi.humanNames || {}; handHidden = true; }
    else g.humans = [0];
    applyNames(); C.setDifficulty(g, settings.difficulty); g.dealRule = settings.dealRule;
    applyLook();
    if (saved && saved.order && Array.isArray(saved.order.ids) && g === saved.g) {
      handOrder = saved.order.ids.filter(x => typeof x === 'number'); orderHand = saved.order.hand | 0;
      if (saved.order.groups && typeof saved.order.groups === 'object') groupOf = Object.assign({}, saved.order.groups);
      nextGid = Math.max(saved.order.next | 0, 1, ...Object.values(groupOf).map(v => (v | 0) + 1));
    }
    if (data && data.ui) { selIds = Array.isArray(data.ui.selIds) ? data.ui.selIds.slice() : []; pickExtra = data.ui.pickExtra != null ? data.ui.pickExtra : null; modal = data.ui.modal || null; }
    if (g.phase === 'over') resultShown = true;
    try { const j = new URLSearchParams(location.search).get('join'); if (j) { friendUi.joinCode = j.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); modal = 'friend'; } } catch (e) { /* no query string here */ }
    wire();
    if (!render()) { mode = 'solo'; humanNames = {}; g = C.newGame({ names: settings.names, human: 0 }); applyNames(); C.setDifficulty(g, settings.difficulty); selIds = []; groupOf = {}; pickExtra = null; modal = null; render(); }
    drive();
  }
  // Small handle for automated play-testing (state is read-only from here; actions go through the same code paths as the UI).
  window.cuajoDebug = {
    state: () => g,
    engine: C,
    deal, newGame,
    drawStock: onStock, takeDiscard: onTake, endHand: onEnd,
    discard: id => onDiscard(id), secret: opt => onSecret(opt), pickExtra: id => onCard(id), time: accept => onTime(accept),
    select: id => onCard(id), group: groupSelected, groups: () => Object.assign({}, groupOf), order: () => handOrder.slice(), isDealing: () => dealing,
    setSpeed: v => { settings.speed = v; save(); },
    closeModal, cardEl, skipAhead, waitingOnOthers,
    mode: () => mode, me: () => ME, net: () => net && { role: net.role, code: net.code, ready: net.ready, connected: net.connected, route: net.link ? net.link.kind : null, away: !!net.away, reconnecting: !!net.reconnecting, relayServers: net.relay ? net.relay.servers() : 0, direct: !!net.peer },
    dropLink: () => { const n = net; if (!n) return; if (n.link && n.link.direct) n.link.direct.close(); if (n.relay) { n.relay.close(); n.relay = null; } if (n.peer) { try { n.peer.destroy(); } catch (e) { /* ignore */ } n.peer = null; } n.link = null; if (n.role === 'guest') reconnect(n); },
    startLocal: (friend, seat) => { modal = 'friend'; renderModal(true); $('#friend-name').value = friend || 'Friend'; $('#friend-seat').value = String(seat || 2); startLocal(); },
    reveal: seat => reveal(seat), covered: () => covered(), promptSeat: () => promptSeat, stopFriend,
  };
  const hot = window.claude && window.claude.hot;
  if (hot && hot.snapshot) hot.snapshot(() => ({ g, settings, order: { ids: handOrder, hand: orderHand }, ui: { selIds, pickExtra, modal } }));
  if (hot && hot.ready) hot.ready(start); else start((hot && hot.data) || {});
})();
