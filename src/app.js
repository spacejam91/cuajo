/* Cuajo — table UI and game controller. Depends on window.Cuajo (engine.js). */
(function () {
  'use strict';
  const C = window.Cuajo;
  let ME = 0;                            // the seat shown at the bottom: you (in pass-and-play, whoever has the computer)
  const PAGES_URL = 'https://spacejam91.github.io/cuajo/';
  const SEAT_CLASS = ['south', 'east', 'north', 'west'];   // screen positions, counted from your seat to the right
  const DEFAULT_SETTINGS = { names: ['You', 'Nena', 'Jun', 'Lola Baby'], speed: 'realistic', hints: true, openHands: false, sortMode: 'suit', difficulty: 'normal', sound: true, cardSize: 'medium', felt: 'green', back: 'red', currency: 'peso', newCards: 'end', dealRule: 'winner', match: 'free', lang: 'en', v: 2 };
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
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = L(String(text)); return e; }
  function btn(label, onClick, cls, disabled) { const b = el('button', 'btn' + (cls ? ' ' + cls : '')); b.type = 'button'; b.append(typeof label === 'string' ? L(label) : label); b.disabled = !!disabled; b.addEventListener('click', onClick); if (typeof label === 'string') b.dataset.key = 'btn-' + label; return b; }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  function byType(a, b) { return C.cardType(a) - C.cardType(b) || a - b; }
  function name(seat) { const n = g.names[seat]; return settings.lang === 'tl' && n === 'You' ? 'Ikaw' : n; }
  const YOU_VERB = { draws: 'draw', discards: 'discard', takes: 'take', lets: 'let', lays: 'lay', says: 'say', has: 'have', is: 'are', wins: 'win', deals: 'deal', holds: 'hold', claims: 'claim' };
  /** Log lines are written as "<name> draws"; when your name is "You" that should read "You draw". */
  function youGrammar(msg) {
    if (name(ME) !== 'You') return msg;
    let out = msg.replace(/\bYou (draws|discards|takes|lets|lays|says|has|is|wins|deals|holds|claims)\b/g, (m, v) => 'You ' + YOU_VERB[v]);
    if (/^((Cuajo|Prinsesa|Rub|Seven kings)! )?You /.test(out)) out = out.replace(/ and (claims|shows|collects|wins)\b/g, (m, v) => ' and ' + v.slice(0, -1));
    return out;
  }

  // ---------- Taglish ----------
  // Translations are applied where text reaches the screen (L). Fixed labels map directly; sentences
  // with names or cards in them are matched by pattern. Card names switch to the Spanish names used at
  // Filipino card tables (Cuatro de Oros); game words (purro, time, sowee, bounit, set, run) stay as they are.
  // Name markers: si / ni / kay / sina for names, ka / mo / sa iyo for "you".
  const isYou = n => n === 'You' || n === 'Ikaw';
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const ACT = n => (isYou(n) ? 'ka' : 'si ' + n);          // doer, actor-focus verb: Bumunot ka / Bumunot si Nena
  const NI = n => (isYou(n) ? 'mo' : 'ni ' + n);          // doer, object-focus verb: Itinapon mo / Itinapon ni Nena
  const HIS = n => (isYou(n) ? 'mo' : 'niya');
  const SI = n => (isYou(n) ? 'ikaw' : 'si ' + n);         // topic: ikaw ang... / si Nena ang...
  const KAY = n => (isYou(n) ? 'sa iyo' : 'kay ' + n);
  const GROUP = a => { const list = a.replace(/ and /g, ' at '); return (/,| at /.test(list) ? 'sina ' : 'si ') + list; };
  const TL_SEAT = { 'the seat across the table': 'kaharap mo', 'the seat on your right': 'nasa kanan mo', 'the seat on your left': 'nasa kaliwa mo' };
  const TL_SRC = { 'drawn from the stock': 'nabunot sa stock', 'taken from the discard pile': 'kinuha sa tapunan', 'claimed with “time” from another player’s stock draw': 'nakuha sa “time” mula sa bunot ng iba', 'claimed from another player’s shown stock draw': 'kinuha mula sa ipinakitang bunot ng iba', 'the hand was complete as dealt': 'buo na ang hawak mula pa sa deal', 'the kings were dealt to the winner': 'nasa deal pa lang, hawak na ang mga king' };
  const TL_WIN = w => (w === 'Seven kings' ? '7 kings' : w);
  const TL_START = { 'four kings of one suit': 'apat na king na pareho ang suit', prinsesa: 'prinsesa', rub: 'rub', 'seven kings': '7 kings', 'no kings': 'walang king', 'only one king': 'iisang king', 'won with the king that finishes a jack-horse-king baksyo': 'nanalo sa king na bumuo ng sota-caballo-rey na baksyo', 'singrey: every king in a jack-horse-king baksyo': 'singrey: lahat ng king ay nasa sota-caballo-rey na baksyo', '2 to 6 kings': '2 hanggang 6 na king' };
  const TL = {
    exact: {
      'Rules': 'Patakaran', 'Settings': 'Settings', 'Play with a friend': 'Makipaglaro', 'Chat': 'Chat', 'Install app': 'I-install', 'Filipino rummy · Spanish deck of 112': 'Filipino rummy · 112 barahang Espanyol',
      'your partner': 'kakampi mo', 'opponent': 'kalaban', 'friend': 'kaibigan', 'dealer': 'dealer', 'shows draws': 'ipinapakita ang bunot', 'away': 'nadiskonekta', 'purro marker': 'purro marker', 'secret': 'secret', 'sowee secret': 'sowee secret',
      'Stock': 'Stock', 'Discard': 'Tapunan', 'Sowee': 'Sowee', 'Next move': 'Susunod',
      'Sort': 'Ayusin', 'Loose cards by suit, then rank': 'Ayon sa suit, saka sa numero', 'Loose cards by rank, then suit': 'Ayon sa numero, saka sa suit', 'Finished combinations first, then cards one short': 'Unahin ang buo nang kombinasyon, saka ang kulang ng isa', 'Suit': 'Suit', 'Rank': 'Numero', 'Auto-group': 'Auto-grupo', 'Take out of group': 'Alisin sa grupo', 'Ungroup all': 'Alisin ang lahat ng grupo', 'Clear selection': 'Alisin ang pinili',
      'Click more cards to group them.': 'Pumili pa ng baraha para i-grupo.', 'Click cards to select them.': 'I-click ang baraha para piliin.', 'Drag to move them.': 'I-drag para ilipat.', 'Tap cards to select them.': 'I-tap ang baraha para piliin.', 'Press and hold to drag.': 'Pindutin nang matagal para i-drag.', 'Drop a card on the discard pile to discard it.': 'Ihulog ang baraha sa tapunan para itapon.',
      'Set': 'Set', 'Run': 'Run', 'Pong': 'Pong', 'King': 'King', 'This combination is a baksyo': 'Baksyo ang kombinasyong ito',
      'Winning card': 'Panalong baraha', 'How it was won': 'Paano nanalo', 'Starting price': 'Panimulang bayad',
      'Kings': 'Mga king', '3-4-5 runs (baksyo)': 'Run na 3-4-5 (baksyo)', 'Jack-horse-king runs (a king as the baksyo)': 'Run na sota-caballo-rey (king ang baksyo)', 'Pongs': 'Mga pong', 'Four aces': 'Apat na as', 'Three aces': 'Tatlong as', 'Sets of four': 'Set na apat', 'Secrets': 'Mga secret', 'Cards matching the sowee': 'Kapareho ng sowee',
      'Rub!': 'Rub!', 'Wait for the fourth king': 'Hintayin ang ikaapat na king', 'Win now with the rub': 'Manalo na sa rub', 'Rub! Win now, or wait for the fourth king.': 'Rub! Manalo na, o hintayin ang ikaapat na king.',
      'You are waiting for the fourth king. You can still win with the rub on your turn.': 'Hinihintay mo ang ikaapat na king. Puwede ka pa ring manalo sa rub sa turn mo.', 'No-king wins': 'Mga panalong walang king',
      'Full screen': 'Full screen', 'Leave full screen': 'Umalis sa full screen', 'Discards': 'Mga itinapon',
      'Keep it until your next turn.': 'Itago mo muna ito hanggang sa susunod mong turn.', 'Keep the card you just took until your next turn': 'Itago muna ang kakakuha mong baraha hanggang sa susunod mong turn',
      'Just taken from the discards: keep it until your next turn': 'Kakakuha lang sa tapunan: itago muna hanggang sa susunod mong turn', 'You just took that card from the discards. Keep it until your next turn.': 'Kakakuha mo lang ang barahang iyan sa tapunan. Itago mo muna hanggang sa susunod mong turn.', 'See all discards': 'Tingnan ang lahat ng itinapon', 'See all the discards': 'Tingnan ang lahat ng itinapon', 'Nothing thrown yet.': 'Wala pang itinatapon.',
      'Every card thrown this hand, oldest first. Faded cards were picked up by the next player.': 'Lahat ng itinapon sa hand na ito, mula sa pinakauna. Ang malabo ay kinuha ng sumunod na manlalaro.',
      'Prinsesa!': 'Prinsesa!', 'Rub!': 'Rub!', 'Seven kings!': '7 kings!', 'Special win': 'Espesyal na panalo', 'Special wins pay double': 'Doble ang bayad sa espesyal na panalo',
      'Prinsesa: one king of every suit and no other kings': 'Prinsesa: isang king sa bawat suit, at wala nang ibang king', 'Rub: three or four kings of the same suit': 'Rub: tatlo o apat na king na pareho ang suit', 'Seven kings: seven kings in one hand': '7 kings: pitong king sa iisang hawak',
      'Prinsesa, rub and seven kings': 'Prinsesa, rub at 7 kings',
      'You hold a king, so you need a baksyo to win: any pong, three or four aces, or 3-4-5 or jack-horse-king of one suit.': 'May king ka, kaya kailangan mo ng baksyo para manalo: kahit anong pong, tatlo o apat na as, o 3-4-5 o sota-caballo-rey sa iisang suit.', 'Kings': 'Kings', 'Four alike': 'Apat na pareho', 'Needs 1': 'Kulang ng 1', 'No match': 'Hindi tugma',
      'Cards are hidden so nobody peeks.': 'Nakatago ang mga baraha para walang sumilip.',
      'Your hand is complete.': 'Buo na ang hawak mo.', 'Purro! Any of these completes your hand: ': 'Purro! Alinman dito ang bubuo sa hawak mo: ',
      'Deal': 'Mag-deal', 'New match': 'Bagong match', 'Next hand': 'Susunod na hand', 'Show result': 'Ipakita ang resulta', 'Draw from stock': 'Bumunot sa stock', 'End hand (stock empty)': 'Tapusin ang hand (ubos na ang stock)', 'Cancel secret': 'Huwag nang ilapag ang secret',
      'Discard (select a card)': 'Itapon (pumili ng baraha)', 'Select one card to discard': 'Isang baraha lang ang piliin', 'Kings can’t be discarded': 'Bawal itapon ang king',
      'Four players, each playing for themselves. Press Deal to start.': 'Apat na manlalaro, kanya-kanya ang bawat isa. Pindutin ang Mag-deal para magsimula.',
      'The stock ran out. The hand is a draw.': 'Naubos ang stock. Tabla ang hand.', 'The stock is empty and there is nothing to take. End the hand.': 'Ubos na ang stock at walang makukuha. Tapusin ang hand.',
      'Your turn.': 'Turn mo na.', 'The stock is empty, so the hand is a draw. Press End hand.': 'Ubos na ang stock, kaya tabla ang hand. Pindutin ang Tapusin ang hand.', 'Draw a card from the stock.': 'Bumunot ng baraha sa stock.', 'You dealt, so you discard first.': 'Ikaw ang nag-deal, kaya ikaw ang unang magtatapon.', 'Choose a card to discard.': 'Pumili ng baraha na itatapon.',
      'Connection lost. Reconnecting…': 'Naputol ang koneksyon. Kumokonekta ulit…', 'Reconnected.': 'Nakakonekta ulit.',
      'Pick a different card: those three go down together.': 'Ibang baraha ang piliin: sabay na ilalapag ang tatlong iyon.',
      'Cuajo is installed. Open it from your home screen or apps.': 'Naka-install na ang Cuajo. Buksan ito mula sa home screen o apps.',
      'Cuajo! You win the hand': 'Cuajo! Panalo ka sa hand na ito', 'Stock exhausted': 'Ubos na ang stock', 'Winning hand': 'Panalong hawak', 'Extra cards drawn from the stock': 'Dagdag na bunot mula sa stock',
      'Payment': 'Bayad', 'Bounit (winning card)': 'Bounit (panalong baraha)', 'Bounit': 'Bounit', 'Kings in the hand': 'Mga king sa hawak', 'Porbis': 'Porbis', 'Bounit from the stock': 'Bounit mula sa stock',
      'Two cards go with the bounit': 'May dalawang barahang bagay sa bounit', 'A card identical to the sowee + two that go with it': 'May kapareho ng sowee at dalawang barahang bagay dito', 'yes': 'oo', 'no': 'hindi',
      'Base payment': 'Batayang bayad', 'Each opponent pays': 'Bayad ng bawat kalaban', 'Your balance': 'Balanse mo', 'Next dealer': 'Susunod na dealer', 'See your stats': 'Tingnan ang stats mo', 'Close': 'Isara',
      'Match over': 'Tapos na ang match', 'Match': 'Match', 'You share the match win!': 'Kasama ka sa mga nanalo sa match!', 'You win the match!': 'Panalo ka sa match!', 'share the match win.': 'ay tabla sa panalo ng match.', 'wins the match.': 'ang panalo sa match.', 'Your team': 'Team mo', 'Hand': 'Hand', 'of': 'ng', 'First to': 'Unang makaabot sa',
      'Time!': 'Time!', 'Let it go': 'Palampasin', 'Time! Claim it': 'Time! Kunin ito',
      'Players': 'Mga manlalaro', 'Your name': 'Pangalan mo', 'Across the table': 'Kaharap mo', 'On your right': 'Nasa kanan mo', 'On your left': 'Nasa kaliwa mo', 'Across the table from me': 'Kaharap ko', 'On my right': 'Nasa kanan ko', 'Hands won: ': 'Mga panalo: ',
      'Give the computer players their original names': 'Ibalik ang orihinal na pangalan ng mga computer', 'Reset names': 'I-reset ang pangalan',
      'Game': 'Laro', 'How fast the other players move': 'Bilis ng ibang manlalaro', 'Relaxed': 'Relaks', 'Realistic': 'Parang totoo', 'Quick': 'Mabilis', 'Fast': 'Napakabilis',
      'Computer players': 'Mga computer na manlalaro', 'Easy: they make plenty of mistakes': 'Madali: madalas silang magkamali', 'Normal: they slip up now and then': 'Normal: paminsan-minsan silang nagkakamali', 'Hard: they play their best': 'Mahirap: naglalaro sila nang pinakamahusay',
      'Match length': 'Haba ng match', 'Free play (no end)': 'Libreng laro (walang katapusan)', '8 hands': '8 hand', '16 hands': '16 hand',
      'After a win, the next deal goes to': 'Pagkatapos manalo, ang magde-deal ay', 'The winner (standard rule)': 'Ang panalo (karaniwang patakaran)', 'The next player to the right': 'Ang susunod sa kanan',
      'Table and cards': 'Mesa at baraha', 'Card size': 'Laki ng baraha', 'Small': 'Maliit', 'Medium': 'Katamtaman', 'Large': 'Malaki', 'Table': 'Mesa', 'Green felt': 'Berdeng felt', 'Blue felt': 'Asul na felt', 'Burgundy felt': 'Burgundy na felt', 'Wooden table': 'Kahoy na mesa',
      'Card backs': 'Likod ng baraha', 'Red': 'Pula', 'Blue': 'Asul', 'Money': 'Pera', 'Pesos (₱)': 'Piso (₱)', 'Dollars ($)': 'Dolyar ($)',
      'Help and sound': 'Tulong at tunog', 'Sounds (card snaps, your-turn chime, Purro and Cuajo calls)': 'Tunog (baraha, hudyat ng turn mo, Purro at Cuajo)', 'Show hints (best discard, useful draws, grouping marks)': 'Ipakita ang payo (pinakamagandang itapon, magagandang bunot, marka ng grupo)',
      'Your stats: hands won, best streak, biggest payout': 'Stats mo: mga panalo, pinakamahabang sunod na panalo, pinakamalaking napanalunan', 'View stats': 'Tingnan', 'Cards you pick up go': 'Kung saan mapupunta ang bagong baraha', 'To the right end of your hand': 'Sa dulong kanan ng hawak mo', 'Into place, in suit or rank order': 'Sa tamang puwesto, ayon sa suit o numero',
      'Open hands (learning mode: see everyone’s cards)': 'Bukas na baraha (pang-aral: kita ang baraha ng lahat)', 'Start a new game (scores back to zero)': 'Bagong laro (balik sa zero ang puntos)', 'Yes, start over': 'Oo, magsimula ulit', 'New game…': 'Bagong laro…',
      'Language': 'Wika', 'English': 'English', 'Taglish (Tagalog and English)': 'Taglish (Tagalog at English)',
      'Install Cuajo as an app (home-screen icon, plays offline alone)': 'I-install ang Cuajo bilang app (icon sa home screen, puwedeng offline kapag mag-isa)', 'Installed': 'Naka-install na', 'Install': 'I-install',
      'On iPhone or iPad: tap Share, then Add to Home Screen.': 'Sa iPhone o iPad: i-tap ang Share, tapos Add to Home Screen.', 'Use your browser menu: Install Cuajo, or Add to Home Screen.': 'Gamitin ang menu ng browser: Install Cuajo, o Add to Home Screen.',
      'My partner (across the table)': 'Kakampi ko (kaharap)', 'My opponent (on my right)': 'Kalaban ko (nasa kanan ko)', 'My (first) friend plays as': 'Ang unang kaibigang sasali ay magiging', 'Online, each on your own device': 'Online, kanya-kanyang device',
      'Start a game and send the code or link to up to three friends, or join with the code a friend sent you. Works across different networks.': 'Magsimula ng laro at ipadala ang code o link sa hanggang tatlong kaibigan, o sumali gamit ang code na ipinadala sa iyo. Gumagana kahit magkaiba ang network.',
      'Start an online game': 'Magsimula ng online na laro', 'Game code': 'Code ng laro', 'Join': 'Sumali', 'On this computer': 'Sa computer na ito',
      'Take turns on one computer. Your cards stay hidden while the other person has it.': 'Maghalinhinan sa iisang computer. Nakatago ang baraha mo habang hawak ito ng iba.', 'Friend’s name': 'Pangalan ng kaibigan', 'Start pass-and-play': 'Simulan ang pass-and-play',
      'Anyone else can join with this code or link and take over a computer player’s seat.': 'Puwede pang sumali ang iba gamit ang code o link na ito, at papalitan nila ang isang computer.',
      'Send your friends this code or link. The game starts as soon as the first one joins; up to three friends can play, from any network.': 'Ipadala sa mga kaibigan ang code o link na ito. Magsisimula ang laro kapag may unang sumali; hanggang tatlong kaibigan, kahit anong network.',
      'Copy link': 'Kopyahin ang link', 'Copied': 'Nakopya', 'Computer player': 'Computer', 'Waiting for your friends to join': 'Hinihintay ang mga kaibigan', 'Setting up the game': 'Inihahanda ang laro',
      'Back to playing alone': 'Bumalik sa paglalaro nang mag-isa', 'Cancel': 'Kanselahin', 'Connected directly.': 'Direktang nakakonekta.', 'Connecting to game': 'Kumokonekta sa laro', '(this can take up to 15 seconds on some networks)': '(puwedeng umabot ng 15 segundo sa ibang network)',
      'Type the game code your friend sent you.': 'I-type ang code na ipinadala ng kaibigan mo.', 'That game is full.': 'Puno na ang larong iyon.', 'Could not load the online connection.': 'Hindi ma-load ang online na koneksyon.',
      'Could not reach the connection services.': 'Hindi maabot ang connection services.', 'Check the internet connection and try again.': 'Tingnan ang koneksyon sa internet at subukan ulit.',
      'Online game': 'Online na laro', 'a friend': 'kaibigan', 'Say hello, or tap a quick message.': 'Mag-hello, o pumili ng mabilis na mensahe.', 'Type a message': 'Mag-type ng mensahe', 'Send': 'Ipadala', 'You': 'Ikaw', 'Friend': 'Kaibigan',
      'Your stats': 'Stats mo', 'Hands played': 'Mga hand na nalaro', 'Hands won': 'Mga hand na napanalunan', 'Best winning streak': 'Pinakamahabang sunod na panalo', 'Biggest payout': 'Pinakamalaking napanalunan', 'Money won in total': 'Kabuuang napanalunan', 'Times purro': 'Ilang beses naka-purro', 'Secrets laid down': 'Mga secret na nailapag', 'Porbis wins': 'Mga panalong porbis', 'Matches won': 'Mga match na napanalunan',
      'How you won': 'Paano ka nanalo', 'Drew the winning card': 'Nabunot ang panalong baraha', 'Called time': 'Nanalo sa \u201ctime\u201d', 'Took it from the discard pile': 'Kinuha sa tapunan',
      'Stats are kept on this device and count your own seat, whether you play alone, pass-and-play or online.': 'Nakatago ang stats sa device na ito at binibilang ang sarili mong puwesto, mag-isa man, pass-and-play o online.', 'Yes, reset my stats': 'Oo, burahin ang stats ko', 'Reset stats…': 'I-reset ang stats…',
    },
    patterns: [
      // log lines written by the game engine
      [/^Hand (\d+): (.+) deals\. The sowee is the (.+)\.$/, (m, h, a, c) => 'Hand ' + h + ': ' + SI(a) + ' ang nag-deal. Ang sowee ay ang ' + c + '.'],
      [/^(.+) draws from the stock\.$/, (m, a) => 'Bumunot ' + ACT(a) + ' sa stock.'],
      [/^(.+) draws the (.+) and shows it \(someone is purro\)\.$/, (m, a, c) => 'Bumunot ' + ACT(a) + ' ng ' + c + ' at ipinakita ' + HIS(a) + ' ito dahil may naka-purro.'],
      [/^(.+) draws the (.+) and shows it \(the turns after a broken purro\)\.$/, (m, a, c) => 'Bumunot ' + ACT(a) + ' ng ' + c + ' at ipinakita ' + HIS(a) + ' ito dahil nasira ang purro ' + HIS(a) + '.'],
      [/^(.+) says "time!" and claims the (.+)\.$/, (m, a, c) => '“Time!” sabi ' + NI(a) + ', at kinuha ' + HIS(a) + ' ang ' + c + '.'],
      [/^(.+) lets the (.+) go\.$/, (m, a, c) => 'Pinalampas ' + NI(a) + ' ang ' + c + '.'],
      [/^(.+) takes the (.+) from the discard pile\.$/, (m, a, c) => 'Kinuha ' + NI(a) + ' ang ' + c + ' mula sa tapunan.'],
      [/^(.+) lays down a secret \(the three cards matching the sowee, with a fourth card that still has to be melded\) and collects (.+) from each opponent\.$/, (m, a, c) => 'Naglapag ' + ACT(a) + ' ng sowee secret at nakasingil ng ' + c + ' sa bawat kalaban.'],
      [/^(.+) lays down a secret and collects (.+) from each opponent\.$/, (m, a, c) => 'Naglapag ' + ACT(a) + ' ng secret at nakasingil ng ' + c + ' sa bawat kalaban.'],
      [/^(.+) discards the (.+)\.$/, (m, a, c) => 'Itinapon ' + NI(a) + ' ang ' + c + '.'],
      [/^(.+) has served the two turns after the broken purro and plays normally again\.$/, (m, a) => 'Tapos na ang parusa ' + (isYou(a) ? 'mo' : 'ni ' + a) + ' dahil sa nasirang purro; normal na ulit ang laro ' + HIS(a) + '.'],
      [/^(.+) says "purro" — one card away from winning!$/, (m, a) => '“Purro!” sabi ' + NI(a) + '. Isang baraha na lang ang kulang ' + HIS(a) + '.'],
      [/^(.+) is no longer purro: .*$/, (m, a) => (isYou(a) ? 'Hindi ka na naka-purro' : 'Hindi na naka-purro si ' + a) + '. Sa susunod na dalawang turn, ipapakita ' + HIS(a) + ' ang bawat bunot at bawal ' + (isYou(a) ? 'kang' : 'siyang') + ' manalo.'],
      [/^The stock is exhausted: the hand is a draw and nobody pays\.$/, 'Ubos na ang stock: tabla ang hand at walang magbabayad.'],
      [/^Cuajo! (.+) wins and collects (.+) from each opponent after drawing (\d+) extra cards? from the stock\.$/, (m, a, c, n) => 'Cuajo! Nanalo ' + ACT(a) + ' at nakasingil ng ' + c + ' sa bawat kalaban, matapos bumunot ng ' + n + ' dagdag na baraha sa stock.'],
      [/^Cuajo! (.+) wins and collects (.+) from each opponent\.$/, (m, a, c) => 'Cuajo! Nanalo ' + ACT(a) + ' at nakasingil ng ' + c + ' sa bawat kalaban.'],
      [/^Prinsesa! (.+) holds one king of every suit and no other kings and wins, collecting (.+) from each opponent\.$/, (m, a, c) => 'Prinsesa! May isang king ' + (isYou(a) ? 'ka' : 'si ' + a) + ' sa bawat suit, at panalo ' + (isYou(a) ? 'ka' : 'siya') + ': ' + c + ' mula sa bawat kalaban.'],
      [/^Rub! (.+) holds (three|four) kings of the same suit and wins, collecting (.+) from each opponent\.$/, (m, a, n, c) => 'Rub! May ' + (n === 'four' ? 'apat na' : 'tatlong') + ' king ' + (isYou(a) ? 'ka' : 'si ' + a) + ' na pareho ang suit, at panalo ' + (isYou(a) ? 'ka' : 'siya') + ': ' + c + ' mula sa bawat kalaban.'],
      [/^Seven kings! (.+) holds seven kings and wins, collecting (.+) from each opponent\.$/, (m, a, c) => '7 kings! May pitong king ' + (isYou(a) ? 'ka' : 'si ' + a) + ', at panalo ' + (isYou(a) ? 'ka' : 'siya') + ': ' + c + ' mula sa bawat kalaban.'],
      [/^(.+) claims the shown (.+) for a rub\.$/, (m, a, c) => 'Kinuha ' + NI(a) + ' ang ipinakitang ' + c + ' para sa rub.'],
      // status line
      [/^(.+) deal the cards…$/, (m, a) => cap(SI(a)) + ' ang nagde-deal…'], [/^(.+) is dealing…$/, (m, a) => cap(SI(a)) + ' ang nagde-deal…'],
      [/^Pass the computer to (.+)\.$/, (m, a) => 'Ibigay ang computer ' + KAY(a) + '.'],
      [/^(Cuajo|Prinsesa|Rub|Seven kings)! (.+) wins the hand\.$/, (m, w, a) => TL_WIN(w) + '! ' + cap(SI(a)) + ' ang panalo sa hand na ito.'],
      [/^Time! You can claim the (.+)\.$/, 'Time! Puwede mong kunin ang $1.'],
      [/^(.+) is looking at the shown card…$/, (m, a) => 'Tinitingnan ' + NI(a) + ' ang ipinakitang baraha…'],
      [/^(.+) is drawing…$/, (m, a) => 'Bumubunot ' + ACT(a) + '…'], [/^(.+) is choosing a discard…$/, (m, a) => 'Pumipili ' + ACT(a) + ' ng itatapon…'],
      [/^The stock is empty, but the (.+) completes your hand: take it to win, or end the hand\.$/, 'Ubos na ang stock, pero bubuo sa hawak mo ang $1: kunin ito para manalo, o tapusin ang hand.'],
      [/^The stock is empty and the (.+) does not complete your hand\. End the hand\.$/, 'Ubos na ang stock at hindi bubuo sa hawak mo ang $1. Tapusin ang hand.'],
      [/^The (.+) would complete your hand, but a winning card has to come from the stock\. Draw from the stock\.$/, 'Bubuo sana sa hawak mo ang $1, pero sa stock lang dapat manggaling ang panalong baraha. Bumunot sa stock.'],
      [/^Draw from the stock, or take the (.+) from the discard pile\.$/, 'Bumunot sa stock, o kunin ang $1 mula sa tapunan.'],
      [/^Your purro was broken: this draw is shown and you cannot win for (\d+) more turns?\.$/, 'Nasira ang purro mo: ipapakita ang bunot na ito, at hindi ka puwedeng manalo sa susunod na $1 turn.'],
      [/^Choose any fourth card from your hand to lay down with your three (.+) cards\.$/, 'Pumili ng ikaapat na baraha na ilalapag kasama ng tatlong $1.'],
      [/^You drew the (.+)\.$/, 'Nabunot mo ang $1.'], [/^You took the (.+)\.$/, 'Kinuha mo ang $1.'], [/^Discard the (.+)\?$/, 'Itatapon mo ba ang $1?'],
      // notices
      [/^(.+) joined the game\.$/, (m, a) => 'Sumali ' + ACT(a) + ' sa laro.'], [/^(.+) is back in the game\.$/, (m, a) => (isYou(a) ? 'Nakabalik ka na.' : 'Nakabalik na si ' + a + '.')],
      [/^(.+) joined and takes over (the seat across the table|the seat on your right|the seat on your left)\.$/, (m, a, b) => 'Sumali ' + ACT(a) + ', at siya na ang ' + TL_SEAT[b] + '.'],
      [/^(.+) left\. A computer player takes that seat\.$/, (m, a) => 'Umalis ' + ACT(a) + '. Computer na ang maglalaro sa puwesto niya.'],
      [/^(.+) lost the connection\. A computer player fills in until they rejoin\.$/, (m, a) => 'Naputol ang koneksyon ' + NI(a) + '. Computer muna ang maglalaro hanggang makabalik siya.'],
      [/^(.+) ended the online game\. You are back in your own game\.$/, (m, a) => 'Tinapos ' + NI(a) + ' ang online na laro. Nakabalik ka na sa sarili mong laro.'],
      [/^Could not reconnect to (.+)\. You are back in your own game\.$/, (m, a) => 'Hindi makakonekta ulit ' + KAY(a) + '. Nakabalik ka na sa sarili mong laro.'],
      [/^No game found with code (.+)\. Check the code with your friend, and make sure their game is still open\.$/, 'Walang laro na may code na $1. Tiyakin ang code sa kaibigan mo, at dapat bukas pa ang laro niya.'],
      [/^Online play works on the website \((.+)\) and in the downloaded file, but not inside the Claude preview\.$/, 'Gumagana ang online sa website ($1) at sa na-download na file, pero hindi sa loob ng Claude preview.'],
      // hints and buttons
      [/^Hint: take the (.+) from the discard pile\. It brings you closer than a blind draw\.$/, 'Payo: kunin ang $1 mula sa tapunan. Mas mapapalapit ka nito sa panalo kaysa bumunot.'],
      [/^Hint: discarding the (.+) leaves you (\d+) cards? from a complete hand\.$/, 'Payo: kapag itinapon mo ang $1, $2 baraha na lang ang kulang mo.'],
      [/^You need (\d+) more cards?\. Useful draws: $/, 'Kulang ka pa ng $1 baraha. Magagandang bunot: '],
      [/^ \+(\d+) more$/, ' +$1 pa'],
      [/^Take the (.+)$/, 'Kunin ang $1'], [/^Discard the (.+)$/, 'Itapon ang $1'], [/^Group (\d+) cards$/, 'I-grupo ang $1 baraha'],
      [/^Lay down secret: four (.+)$/, 'Ilapag ang secret: apat na $1'], [/^Lay down secret: three (.+) \(sowee\) \+ one card$/, 'Ilapag ang secret: tatlong $1 (sowee) at isa pang baraha'],
      [/^(.+)’s turn\.$/, (m, a) => (isYou(a) ? 'Turn mo na.' : 'Turn na ni ' + a + '.')], [/^I’m (.+), show my cards$/, 'Ako si $1, ipakita ang baraha ko'],
      [/^Show (.+)’s cards$/, (m, a) => (isYou(a) ? 'Ipakita ang baraha mo' : 'Ipakita ang baraha ni ' + a)],
      [/^(\d+) cards?$/, '$1 baraha'], [/^broken purro: (\d+) turns? left$/, 'sirang purro: $1 turn pa'], [/^(\d+) combinations$/, '$1 kombinasyon'],
      // result dialog
      [/^(Prinsesa|Rub|Seven kings)! You win the hand$/, (m, w) => TL_WIN(w) + '! Panalo ka sa hand na ito'],
      [/^(Cuajo|Prinsesa|Rub|Seven kings)! (.+) \(your partner\) wins the hand$/, (m, w, a) => TL_WIN(w) + '! Panalo ang kakampi mong si ' + a], [/^(Cuajo|Prinsesa|Rub|Seven kings)! (.+) wins the hand$/, (m, w, a) => (isYou(a) ? TL_WIN(w) + '! Panalo ka' : TL_WIN(w) + '! Panalo si ' + a)],
      [/^Nobody completed a hand before the stock ran out, so the hand is a draw and nobody pays \(secrets already paid stand\)\. (.+) deals again\.$/, (m, a) => 'Walang nakabuo bago naubos ang stock, kaya tabla ang hand at walang magbabayad (mananatili ang bayad sa mga secret). ' + cap(SI(a)) + ' ulit ang magde-deal.'],
      [/^The conditions were not met from the hand, so (\d+) extra cards? (?:was|were) drawn \(up to 15 allowed\) until both conditions held\.$/, 'Hindi natupad ang mga kondisyon mula sa hawak, kaya bumunot ng $1 dagdag na baraha (hanggang 15 ang puwede) hanggang matupad ang dalawa.'],
      [/^The conditions were not met from the hand, so (\d+) extra cards? (?:was|were) drawn \(up to 15 allowed\) without meeting both conditions\.$/, 'Hindi natupad ang mga kondisyon mula sa hawak, kaya bumunot ng $1 dagdag na baraha (hanggang 15 ang puwede), pero hindi pa rin natupad ang dalawa.'],
      [/^(.+) — (drawn from the stock|taken from the discard pile|claimed with “time” from another player’s stock draw|claimed from another player’s shown stock draw|the hand was complete as dealt|the kings were dealt to the winner)$/, (m, a, b) => a + ' — ' + TL_SRC[b]],
      [/^(drawn from the stock|taken from the discard pile|claimed with “time” from another player’s stock draw|claimed from another player’s shown stock draw|the hand was complete as dealt|the kings were dealt to the winner)$/, (m, a) => TL_SRC[a]],
      [/^(.+) \((four kings of one suit|prinsesa|rub|seven kings|no kings|only one king|won with the king that finishes a jack-horse-king baksyo|singrey: every king in a jack-horse-king baksyo|2 to 6 kings)\)$/, (m, a, b) => a + ' (' + TL_START[b] + ')'],
      [/^(.+) · (\d+) cards?$/, '$1 · $2 baraha'], [/^(.+) · taken by (.+)$/, (m, c, a) => c + ' · kinuha ' + NI(a)],
      [/^(.+) is looking at their cards…$/, (m, a) => 'Tinitingnan ' + NI(a) + ' ang baraha ' + HIS(a) + '…'],
      [/^You were dealt three (.+) cards\. Win now with the rub, or keep playing and wait for the fourth: four kings of one suit start at (.+) instead of (.+)\. While you wait you can still take the rub on any of your turns, but if someone else wins first, it is gone\.$/, 'Tatlong $1 ang na-deal sa iyo. Manalo na sa rub, o ituloy ang laro at hintayin ang ikaapat: $2 ang panimula ng apat na king na pareho ang suit, sa halip na $3. Habang naghihintay, puwede mo pa ring kunin ang rub sa alinmang turn mo, pero kapag may ibang nanalo muna, wala na ito.'], [/^(Set|Run|Pong|Four alike) · baksyo$/, (m, a) => (a === 'Four alike' ? 'Apat na pareho' : a) + ' · baksyo'],
      [/^(\d+) \(worth (.+)\)$/, '$1 (halagang $2)'], [/^no kings, or one king inside its jack-horse-king run: a flat (.+)$/, 'walang king, o may isang king sa loob ng sota-caballo-rey: flat na $1'],
      [/^(.+) \(partners do not pay each other\)$/, '$1 (hindi nagbabayaran ang magkakampi)'], [/^(.+) \(the winner deals\)$/, '$1 (ang panalo ang magde-deal)'], [/^(.+) \(the deal passes to the right\)$/, '$1 (lilipat ang deal sa kanan)'],
      [/^(.+) drew the (.+) from the stock and showed it because you are purro\. It completes your hand: say “time” to claim it and win\.$/, (m, a, c) => 'Nakabunot ' + ACT(a) + ' ng ' + c + ' mula sa stock at ipinakita ' + HIS(a) + ' ito dahil naka-purro ka. Bubuo ito sa hawak mo: sabihin ang “time” para kunin ito at manalo.'],
      [/^(.+) wins the match\.$/, (m, a) => cap(SI(a)) + ' ang panalo sa match.'], [/^(.+) share the match win\.$/, (m, a) => 'Tabla sa panalo ng match ' + GROUP(a) + '.'],
      // settings, friends, chat
      [/^(.+) \(computer\)$/, (m, a) => L(a) + ' (computer)'], [/^(.+) \(a person\)$/, '$1 (tao)'], [/^First to (.+)$/, 'Unang makaabot sa $1'],
      [/^Open the website to install: (.+)$/, 'Buksan ang website para i-install: $1'],
      [/^(.+) \(reconnecting…\)$/, '$1 (kumokonekta ulit…)'], [/^(.+) \(via relay\)$/, '$1 (sa relay)'],
      [/^You joined (.+)’s game\.$/, 'Sumali ka sa laro ni $1.'], [/^Hands won: (\d+)$/, 'Mga panalo: $1'],
      [/^You are sharing this computer with (.+)\.$/, 'Kasama mo si $1 sa computer na ito.'], [/^Also playing: (.+)\.$/, (m, a) => 'Kasali rin ' + GROUP(a) + '.'],
      [/^Connected through relay servers \((\d+) of (\d+) reachable\)\.$/, 'Nakakonekta sa relay servers ($1 sa $2 ang naaabot).'],
      [/^Pass-and-play with (.+)$/, (m, a) => 'Pass-and-play kasama ' + GROUP(a)], [/^Online with (.+)$/, (m, a) => 'Online kasama ' + GROUP(a)], [/^Online in (.+)’s game$/, 'Online sa laro ni $1'],
      [/^Chat \((\d+)\)$/, 'Chat ($1)'],
    ],
  };
  const CARD_EN = /\b(Ace|Three|Four|Five|Jack|Horse|King) of (Coins|Cups|Swords|Batons)\b/g;
  const RANK_IX = { Ace: 0, Three: 1, Four: 2, Five: 3, Jack: 4, Horse: 5, King: 6 }, SUIT_IX = { Coins: 0, Cups: 1, Swords: 2, Batons: 3 };
  // The family's own words: bunutan (stock), panugse (discards), alas, atlu, apat, lima, sota, kabayo, hari; orus, kopas, espada, bastus.
  const RANK_TL = ['Alas', 'Atlu', 'Apat', 'Lima', 'Sota', 'Kabayo', 'Hari'], SUIT_TL = ['Orus', 'Kopas', 'Espada', 'Bastus'];
  const linker = w => (/[aeiou]$/i.test(w) ? w + 'ng' : w + ' a');   // Sotang Orus, Limang Bastus; Alas a Orus, Apat a Kopas
  function tlCard(r, su) { return linker(RANK_TL[r]) + ' ' + SUIT_TL[su]; }
  const TL_VOCAB = [[/\b7 kings\b/g, '\u00a7'], [/\bStock\b/g, 'Bunutan'], [/\bstock\b/g, 'bunutan'], [/\bTapunan\b/g, 'Panugse'], [/\btapunan\b/g, 'panugse'],
    [/\bKings?\b/g, 'Hari'], [/\bkings?\b/g, 'hari'], [/\bas\b/g, 'alas'], [/\bcaballo\b/g, 'kabayo'], [/\brey\b/g, 'hari'], [/\boros\b/g, 'orus'], [/\bcopas\b/g, 'kopas'],
    [/\bespadas\b/g, 'espada'], [/\bbastos\b/g, 'bastus'], [/\btres\b/g, 'atlu'], [/\bcuatro\b/g, 'apat'], [/\bcinco\b/g, 'lima'], [/\u00a7/g, '7 kings']];
  function tlVocab(x) { for (const [re, w] of TL_VOCAB) x = x.replace(re, w); return x; }
  function cardsTL(x) { return x.replace(CARD_EN, (m, r, su) => tlCard(RANK_IX[r], SUIT_IX[su])); }
  function trOne(s) {
    if (Object.prototype.hasOwnProperty.call(TL.exact, s)) return TL.exact[s];
    for (const [re, rep] of TL.patterns) if (re.test(s)) return s.replace(re, rep);
    return null;
  }
  function L(s) {
    if (settings.lang !== 'tl' || typeof s !== 'string' || !s.trim()) return s;
    const one = trOne(s);
    if (one != null) return tlVocab(cardsTL(one));
    const parts = s.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g);      // a few sentences in a row: translate each
    if (parts && parts.length > 1) {
      const tp = parts.map(p => trOne(p.trim()));
      if (tp.some(x => x != null)) return tp.map((x, i) => (x != null ? tlVocab(cardsTL(x)) : cardsTL(parts[i].trim()))).join(' ');
    }
    return cardsTL(s);
  }
  /** Card names: English, or the names used at the family table (Sotang Orus, Haring Kopas, Apat a Espada). */
  function cn(t) { return settings.lang === 'tl' ? tlCard(C.rankOf(t), C.suitOf(t)) : C.cardName(t); }
  function logText(msg) { return settings.lang === 'tl' ? L(msg).replace(/\bYou\b/g, 'Ikaw') : youGrammar(msg); }

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
    const idx = '<text x="7" y="28" class="ix">' + ix + '</text>' + (isLong(suit) ? '' : pipAt(suit, 14, 42, 12));
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
    d.setAttribute('aria-label', cn(t));
    d.title = cn(t) + ' · ' + C.RANK_ES[r] + ' (' + INDEX[r] + ') de ' + C.SUIT_ES[s];
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
      x.title = (reveal ? cn(C.cardType(s.extra)) + ': ' : '') + 'fourth card laid with the sowee secret; it still has to be part of a combination';
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
    r.lang = settings.lang === 'tl' ? 'tl' : 'en';
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
      const notes = { chat: [1319], turn: [784, 1047], purro: [659, 880, 988], time: [988, 784], secret: [587, 740], win: [523, 659, 784, 1047] }[kind] || [440];
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
    if (g.phase === 'rubOffer') return !isHuman(g.rubOffer.seat);
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
    if (mode === 'host') send({ t: 'bubble', seat, text, msec });
    bubbleOnly(seat, text, msec);
  }
  function bubbleOnly(seat, text, msec, sound) {
    sfx(sound || { 'Purro!': 'purro', 'Cuajo!': 'win', 'Prinsesa!': 'win', 'Rub!': 'win', 'Seven kings!': 'win', 'Time!': 'time', 'Secret!': 'secret' }[text] || 'turn');
    const id = ((bubbles[seat] && bubbles[seat].id) || 0) + 1;
    bubbles[seat] = { text, id };
    render();
    setTimeout(() => { if (bubbles[seat] && bubbles[seat].id === id) { delete bubbles[seat]; render(); } }, Math.max(msec || 0, 900));
  }
  const SPECIAL = { prinsesa: 'Prinsesa', sevenkings: 'Seven kings', rub: 'Rub' };
  function winWord(r) { return r && r.special ? SPECIAL[r.special] : 'Cuajo'; }
  function snap() { return { purro: g.purro.slice(), secrets: g.secrets.map(x => x.length), phase: g.phase }; }
  /** Speech bubbles for what just happened; returns how long to pause so people can see it. */
  function announce(b) {
    let extra = 0;
    for (let s = 0; s < 4; s++) {
      if (g.secrets[s].length > b.secrets[s]) { showBubble(s, 'Secret!', secs(1600)); extra = Math.max(extra, secs(800)); }
      if (!b.purro[s] && g.purro[s]) { showBubble(s, 'Purro!', secs(1900)); extra = Math.max(extra, secs(900)); }
    }
    if (b.phase !== 'over' && g.phase === 'over' && g.result && g.result.type === 'win') showBubble(g.result.winner, winWord(g.result) + '!', secs(2800) || 1200);
    return extra;
  }

  function newGame(people) {
    g = C.newGame({ names: settings.names, human: 0, humans: people || (mode === 'solo' ? [0] : humansOf().slice()), dealRule: settings.dealRule });
    applyNames(); C.setDifficulty(g, settings.difficulty); g.match = freshMatch();
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
      if (mode !== 'guest') checkMatch();
      if (mode === 'local') { handHidden = false; promptSeat = null; }
      if (!modal && !resultShown) later(() => { if (g.phase === 'over' && !modal && !resultShown) { modal = 'result'; resultShown = true; render(); } }, pace() ? Math.max(secs(2000), 500) : 0);
      return;
    }
    if (mode === 'guest') {   // the host runs the game; this computer only answers when it is our call
      if (g.phase === 'timeOffer' && C.currentClaimant(g) === ME) { if (modal !== 'time') { modal = 'time'; render(); } }
      else if (modal === 'time') { modal = null; render(); }
      if (g.phase === 'rubOffer' && g.rubOffer && g.rubOffer.seat === ME) { if (modal !== 'rub') { modal = 'rub'; render(); } }
      else if (modal === 'rub') { modal = null; render(); }
      return;
    }
    if (g.phase === 'rubOffer') {
      const p = g.rubOffer.seat;
      if (isHuman(p)) { if (isLocalHuman(p) && !needPrompt(p) && modal !== 'rub') { modal = 'rub'; render(); } return; }
      later(() => { const my = gen; if (g.phase !== 'rubOffer') return; const r = act(p, 'rub', C.aiChooseRub(g, p)); announce(r.b); save(); render(); if (my === gen) drive(); }, secs(900, 500));
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
    else if (a === 'takeDiscard') { from = discardRect(topDiscardSeat()); C.takeDiscard(g, seat); move = { kind: 'draw', seat, src: 'discard', id: g.drawn, shown: true }; }
    else if (a === 'discard') { from = noFly ? null : cardRect(seat, arg); C.discard(g, seat, arg); move = { kind: 'discard', seat, id: arg }; }
    else if (a === 'secret') C.declareSecret(g, seat, arg.type, arg.extraId == null ? null : arg.extraId);
    else if (a === 'time') { const o = g.timeOffer; from = seatTarget(o.from).rect; C.resolveTime(g, !!arg); if (arg) move = { kind: 'time', seat, from: o.from, id: o.card }; }
    else if (a === 'endHand') C.endHandDraw(g);
    else if (a === 'rub') C.resolveRub(g, !!arg);
    else if (a === 'rubNow') C.declareRub(g, seat);
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
      const top = discardTopEl(move.seat);
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
    if (C.cardType(card) === C.blockedType(g, ME)) { flash('You just took that card from the discards. Keep it until your next turn.'); return; }
    humanAct('discard', card, noFly);
  }
  function onSecret(opt) {
    if (!myTurn('discard')) return;
    if (opt.kind === 'four') { selIds = []; humanAct('secret', { type: opt.type, extraId: null }); }
    else { pickExtra = opt.type; selIds = []; render(); }
  }
  function onRub(win) {
    if (g.phase === 'rubOffer' && g.rubOffer && g.rubOffer.seat === ME && isLocalHuman(ME)) { modal = null; humanAct('rub', win); render(); }
  }
  function onDeclareRub() { if (C.legalActions(g, ME).declareRub && isLocalHuman(ME) && !covered()) humanAct('rubNow'); }
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
    try { $('#app').classList.toggle('dealing', dealing); renderTop(); for (const s of others()) renderSeat(s); renderCenter(); renderYou(); renderModal(); renderChat(); trackStats(); }
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
    const fb = $('#btn-friend'); if (fb) fb.textContent = L(modeLabel());
    $('#btn-rules').textContent = L('Rules'); $('#btn-settings').textContent = L('Settings');
    const sub = $('.brand .sub'); if (sub) sub.textContent = L('Filipino rummy \u00b7 Spanish deck of 112');
    const ib = $('#btn-install'); if (ib) { ib.hidden = !installPrompt || standaloneApp(); ib.textContent = L('Install app'); }
    const fb2 = $('#btn-full'); if (fb2) { fb2.hidden = !canFullscreen(); const on = !!fullscreenEl(); fb2.title = L(on ? 'Leave full screen' : 'Full screen'); fb2.setAttribute('aria-label', fb2.title); fb2.classList.toggle('on', on); }
    if (g.match && g.phase !== 'idle') sc.append(el('span', 'sc match', matchProgress()));
    for (const seat of [ME, (ME + 1) % 4, (ME + 2) % 4, (ME + 3) % 4]) {
      const chip = el('span', 'sc');
      chip.append(el('span', 'dot' + (seat === ME ? ' me' : '')), el('span', 'nm', name(seat)), balanceEl(seat));
      chip.title = L('Hands won: ' + g.wins[seat]);
      sc.append(chip);
    }
  }

  function isActive(seat) {
    if (g.phase === 'idle' || g.phase === 'over' || dealing) return false;
    if (g.phase === 'timeOffer') return C.currentClaimant(g) === seat;
    if (g.phase === 'rubOffer') return g.rubOffer.seat === seat;
    return g.turn === seat;
  }

  function renderSeat(seat) {
    const sec = $('.seat-' + posClass(seat)); sec.innerHTML = '';
    sec.classList.toggle('active', isActive(seat));
    const h = el('header');
    h.append(el('span', 'nm', name(seat)));
    if (isHuman(seat)) h.append(el('span', 'tag friend', 'friend'));
    if (net && net.role === 'host' && net.guests && net.guests[seat] && net.guests[seat].away) { const aw = el('span', 'tag penalty', 'away'); aw.title = 'A computer player is filling in until they rejoin'; h.append(aw); }
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
    if (g.phase === 'idle') { add('Four players, each playing for themselves. Press Deal to start.'); return st; }
    if (dealing) { add(name(g.dealer) + (g.dealer === ME ? ' deal the cards\u2026' : ' is dealing\u2026')); return st; }
    if (mode === 'local' && promptSeat != null && g.phase !== 'over') { add('Pass the computer to ' + name(promptSeat) + '.'); return st; }
    if (g.phase === 'over') { add(g.result.type === 'draw' ? 'The stock ran out. The hand is a draw.' : winWord(g.result) + '! ' + name(g.result.winner) + ' wins the hand.'); return st; }
    if (g.phase === 'rubOffer') {
      const p = g.rubOffer.seat;
      add(p === ME ? 'Rub! Win now, or wait for the fourth king.' : name(p) + ' is looking at their cards…');
      return st;
    }
    if (g.phase === 'timeOffer') {
      const p = C.currentClaimant(g);
      add(p === ME ? 'Time! You can claim the ' + cn(C.cardType(g.timeOffer.card)) + '.' : name(p) + ' is looking at the shown card…');
      return st;
    }
    if (g.turn !== ME) { add(name(g.turn) + (g.phase === 'draw' ? ' is drawing…' : ' is choosing a discard…')); return st; }
    if (g.rubWait && g.rubWait[ME]) add('You are waiting for the fourth king. You can still win with the rub on your turn. ');
    const top = C.topDiscard(g);
    if (g.phase === 'draw') {
      const la = C.legalActions(g, ME);
      const pen = g.penalty[ME] > 0 ? ' Your purro was broken: this draw is shown and you cannot win for ' + plural(g.penalty[ME], 'more turn') + '.' : '';
      if (!g.stock.length) { add('The stock is empty, so the hand is a draw. Press End hand.'); return st; }
      if (top == null) { add('Your turn. Draw a card from the stock.' + pen); return st; }
      if (completesMe(C.cardType(top))) { add('The ' + cn(C.cardType(top)) + ' would complete your hand, but a winning card has to come from the stock. Draw from the stock.' + pen); return st; }
      add('Your turn. Draw from the stock, or take the ' + cn(C.cardType(top)) + ' from the discard pile.' + pen);
      return st;
    }
    if (pickExtra != null) { add('Choose any fourth card from your hand to lay down with your three ' + cn(pickExtra) + ' cards.'); return st; }
    const drew = g.drawn != null ? 'You ' + (g.drawnFrom === 'discard' ? 'took' : 'drew') + ' the ' + cn(C.cardType(g.drawn)) + '. ' + (C.blockedType(g, ME) != null ? 'Keep it until your next turn. ' : '') : (g.turnCount === 0 ? 'You dealt, so you discard first. ' : '');
    add(drew + (selIds.length === 1 && !C.isKing(selIds[0]) && C.cardType(selIds[0]) !== C.blockedType(g, ME) ? 'Discard the ' + cn(C.cardType(selIds[0])) + '?' : 'Choose a card to discard.'));
    return st;
  }
  function completesMe(t) { return C.completesWith(g, ME, t); }

  // Each player's discards sit between them and the next player to the right, who may take the top card.
  const CORNER = ['se', 'ne', 'nw', 'sw'];
  function topDiscardSeat() { return g.discardedBy && g.discardedBy.length ? g.discardedBy[g.discardedBy.length - 1] : null; }
  function discardTopEl(seat) { return document.querySelector('.pile.discard[data-seat="' + seat + '"] .card.top'); }
  function discardRect(seat) {
    if (seat == null) return null;
    const n = discardTopEl(seat); if (n) return n.getBoundingClientRect();
    const p = document.querySelector('.pile.discard[data-seat="' + seat + '"] .dstack'); return p ? p.getBoundingClientRect() : null;
  }
  function openDiscards(seat) { discardFocus = seat; modal = 'discards'; render(); }
  function renderDiscardSpots(canTake) {
    const topSeat = topDiscardSeat();
    for (let k = 0; k < 4; k++) {
      const seat = (ME + k) % 4, spot = $('.dspot.d-' + CORNER[k]);
      if (!spot) continue;
      spot.innerHTML = '';
      if (g.phase === 'idle') continue;
      const list = (g.history || []).filter(h => h.seat === seat && h.takenBy == null);
      const takeHere = canTake && topSeat === seat;
      const pd = el('div', 'pile discard' + (seat === ME ? ' mine' : '') + (takeHere ? ' clickable' : ''));
      pd.dataset.seat = seat;
      const stack = el('div', 'dstack');
      const show = list.slice(-3);
      if (!show.length) stack.append(el('div', 'slot'));
      show.forEach((h, i) => { const cd = cardEl(h.type); if (i === show.length - 1) cd.classList.add('top'); stack.append(cd); });
      pd.append(stack);
      if (list.length) pd.append(el('span', 'cnt', String(list.length)));
      const lb = el('button', 'dlbl', name(seat)); lb.type = 'button'; lb.dataset.key = 'dlbl-' + seat;
      lb.title = L('See all the discards'); lb.setAttribute('aria-label', L('See all the discards'));
      lb.addEventListener('click', () => openDiscards(seat));
      pd.append(lb);
      const top = stack.querySelector('.card.top');
      const onKey = fn => e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } };
      if (takeHere && top) {
        top.setAttribute('role', 'button'); top.setAttribute('aria-label', L('Take the ' + cn(top.dataset.t != null ? +top.dataset.t : list[list.length - 1].type) + ' from the discard pile'));
        top.dataset.key = 'discard'; top.tabIndex = 0; top.addEventListener('click', onTake); top.addEventListener('keydown', onKey(onTake));
        for (const c of stack.querySelectorAll('.card:not(.top)')) c.addEventListener('click', () => openDiscards(seat));
      } else {
        stack.setAttribute('role', 'button'); stack.tabIndex = 0; stack.dataset.key = 'dstack-' + seat;
        stack.setAttribute('aria-label', L('See all the discards'));
        stack.addEventListener('click', () => openDiscards(seat)); stack.addEventListener('keydown', onKey(() => openDiscards(seat)));
      }
      spot.append(pd);
    }
  }
  /** Every card thrown this hand, player by player, oldest first; picked-up cards are faded. */
  function discardsBox() {
    const box = el('div', 'box discards-box');
    box.append(el('h2', null, 'Discards'));
    box.append(el('p', 'note', 'Every card thrown this hand, oldest first. Faded cards were picked up by the next player.'));
    const hist = g.history || [], last = hist.length ? hist[hist.length - 1] : null;
    for (let k = 0; k < 4; k++) {
      const seat = (ME + k) % 4, list = hist.filter(h => h.seat === seat);
      const sec = el('section', 'dgroup' + (seat === discardFocus ? ' focus' : ''));
      sec.append(el('h3', null, name(seat) + ' \u00b7 ' + plural(list.length, 'card')));
      const row = el('div', 'drow');
      if (!list.length) row.append(el('span', 'note', 'Nothing thrown yet.'));
      for (const h of list) {
        const c = cardEl(h.type, { mini: true });
        if (h.takenBy != null) { c.classList.add('taken'); c.title = L(cn(h.type) + ' \u00b7 taken by ' + name(h.takenBy)); }
        if (h === last) c.classList.add('latest');
        row.append(c);
      }
      sec.append(row);
      box.append(sec);
    }
    box.append(barWith(btn('Close', closeModal, 'primary')));
    return box;
  }
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
    const pw = el('div', 'pile sowee');
    pw.append(g.sowee != null && g.phase !== 'idle' ? cardEl(C.cardType(g.sowee)) : el('div', 'slot'));
    pw.append(el('span', 'lbl', 'Sowee'));
    piles.append(ps, pw);
    renderDiscardSpots(mine && C.legalActions(g, ME).takeDiscard);

    const status = $('.status'); status.innerHTML = ''; status.append(statusText());
    const cb = $('#center-bar'); cb.innerHTML = '';
    if (waitingOnOthers() && g.phase !== 'over') {
      const nb = btn('Next move', skipAhead, 'next');
      nb.append(el('kbd', null, 'N'));
      nb.title = 'Skip the pause. The cards still move, you just wait less. Shortcut: N';
      cb.append(nb);
    }
    if (g.phase !== 'idle' && !dealing && (g.history || []).length) cb.append(btn('See all discards', () => openDiscards(null), 'link'));
    const log = $('.log'); log.innerHTML = '';
    const recent = g.events.slice(-5).reverse();
    for (const e of recent) {
      const li = el('li', e.kind);
      li.append(logText(e.msg));
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
    const pri = { set: 0, run: 0, pong: 0, secret: 0, king: 1, secret3: 2, set2: 2, run2: 2, pong2: 2, secret2: 2, seed: 3, drop: 4 };
    const plan = C.planFor(g, ME).map((gp, i) => ({ gp, i }));
    const pr = k => (pri[k] == null ? 3 : pri[k]);
    plan.sort((x, y) => (pr(x.gp.kind) - pr(y.gp.kind)) || (y.gp.baksyo ? 1 : 0) - (x.gp.baksyo ? 1 : 0) || x.i - y.i);
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
      if (parts.length === 1) {
        const text = { set: 'Set', run: 'Run', pong: 'Pong', secret: 'Four alike' }[parts[0].kind] || 'Combination';
        return C.isBaksyo(parts[0].types) ? { cls: 'ok baksyo', text: text + ' \u00b7 baksyo', title: 'This combination is a baksyo' } : { cls: 'ok', text };
      }
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
  function canDropOnDiscard(d) { return d.kind === 'card' && myTurn('discard') && pickExtra == null && !C.isKing(d.id) && C.cardType(d.id) !== C.blockedType(g, ME); }

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
    const pile = document.querySelector('.pile.discard.mine');
    if (pile && canDropOnDiscard(d)) pile.classList.add('drop-target');
    moveDrag(x, y);
  }
  /** Position of a node inside the hand box, ignoring any animation transforms. */
  function posIn(node, root) { let x = 0, y = 0, n = node; while (n && n !== root) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; } return n === root ? [x, y] : null; }
  function moveDrag(x, y) {
    const d = drag;
    d.ghost.style.left = (x - d.offX) + 'px'; d.ghost.style.top = (y - d.offY) + 'px';
    const pile = document.querySelector('.pile.discard.mine');
    d.overPile = false;
    if (pile && canDropOnDiscard(d)) {
      const r = pile.getBoundingClientRect();
      d.overPile = x >= r.left - 12 && x <= r.right + 12 && y >= r.top - 12 && y <= r.bottom + 12;
      pile.classList.toggle('drop-hover', d.overPile);
    }
    if (d.overPile) return;
    const hand = $('#hand'), hr = hand.getBoundingClientRect();
    if (x < hr.left - 40 || x > hr.right + 40 || y < hr.top - 50 || y > hr.bottom + 50) return; // outside the hand: keep the spot
    const px = x - hr.left + hand.scrollLeft, py = y - hr.top + hand.scrollTop;   // the hand can scroll sideways on small screens
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
    const pile = document.querySelector('.pile.discard.mine'); if (pile) pile.classList.remove('drop-target', 'drop-hover');
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

  // Sorting: three tabs in one bar; the current one is filled in. Tapping a tab always re-sorts.
  const SORTS = [['suit', 'Suit', 'Loose cards by suit, then rank'], ['rank', 'Rank', 'Loose cards by rank, then suit'], ['combos', 'Auto-group', 'Finished combinations first, then cards one short']];
  function sortTabs() {
    const bar = el('div', 'sort-tabs'); bar.setAttribute('role', 'tablist'); bar.setAttribute('aria-label', L('Sort'));
    for (const [m, label, tip] of SORTS) {
      const on = settings.sortMode === m;
      const t = el('button', 'sort-tab' + (on ? ' on' : ''), label); t.type = 'button';
      t.setAttribute('role', 'tab'); t.setAttribute('aria-selected', on ? 'true' : 'false'); t.title = L(tip); t.dataset.key = 'sort-' + m;
      t.addEventListener('click', () => sortHand(m));
      bar.append(t);
    }
    return bar;
  }

  function renderHandTools() {
    const tools = $('#hand-tools'); tools.innerHTML = '';
    if (g.phase === 'idle' || dealing || !g.hands[ME].length) return;
    tools.append(el('span', 'lbl sort-lbl', 'Sort'), sortTabs());
    if (selIds.length >= 2) { const b = btn('Group ' + selIds.length + ' cards', groupSelected, 'chip primary'); b.dataset.key = 'group-sel'; tools.append(b); }
    if (selIds.some(id => groupOf[id] != null)) { const b = btn('Take out of group', ungroupSelected, 'link'); b.dataset.key = 'ungroup-sel'; tools.append(b); }
    if (Object.keys(groupOf).length && !selIds.length) { const b = btn('Ungroup all', ungroupAll, 'link'); b.dataset.key = 'ungroup-all'; tools.append(b); }
    if (selIds.length) { const b = btn('Clear selection', () => { selIds = []; render(); }, 'link'); b.dataset.key = 'clear-sel'; tools.append(b); }
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
      const keepType = discarding ? C.blockedType(g, ME) : null;
      const marks = handMarks();
      const cards = orderedHand();
      const inHand = new Set(cards);
      selIds = selIds.filter(id => inHand.has(id));
      let pos = 0;
      for (const sg of segmentsOf(cards)) {
        const box = el('div', 'seg ' + (sg.gid == null ? 'loose' : 'grp'));
        if (sg.gid != null) {
          const lab = groupLabel(sg.ids);
          box.dataset.gid = sg.gid; box.classList.add(...lab.cls.split(' '));
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
          let label = cn(C.cardType(id));
          if (discarding && pickExtra == null && C.isKing(id)) { cd.classList.add('king-lock'); label += ' (cannot be discarded)'; }
          else if (discarding && pickExtra == null && C.cardType(id) === keepType) { cd.classList.add('keep-lock'); label += ' (just taken from the discards: keep it until your next turn)'; cd.title = L('Just taken from the discards: keep it until your next turn'); }
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
    if (settings.hints && g.phase !== 'idle' && g.phase !== 'over' && g.phase !== 'timeOffer' && g.phase !== 'rubOffer') {
      const a = C.analyze(g, ME), top = C.topDiscard(g);
      const takeIt = myTurn('draw') && top != null && g.stock.length && !completesMe(C.cardType(top)) && C.aiChooseDraw(g, ME) === 'discard';
      if (takeIt) hint.append(L('Hint: take the ' + cn(C.cardType(top)) + ' from the discard pile. It brings you closer than a blind draw.'));
      else if (a.n === a.slots) {
        if (a.complete) hint.append(L('Your hand is complete.'));
        else if (a.bestDiscard) hint.append(L('Hint: discarding the ' + cn(a.bestDiscard.type) + ' leaves you ' + plural(a.bestDiscard.distance, 'card') + ' from a complete hand.'));
      } else if (a.n === a.slots - 1) {
        if (a.waiting.length) { hint.append(L('Purro! Any of these completes your hand: ')); hint.append(miniRow(a.waiting)); }
        else { hint.append(L('You need ' + plural(a.distance, 'more card') + '. Useful draws: ')); hint.append(miniRow(a.useful.slice(0, 12))); if (a.useful.length > 12) hint.append(L(' +' + (a.useful.length - 12) + ' more')); }
      }
      if (a.needB && !a.baksyo && !takeIt) hint.append(el('span', 'hint-b', 'You hold a king, so you need a baksyo to win: any pong, three or four aces, or 3-4-5 or jack-horse-king of one suit.'));
    }

    const bar = $('#bar'); bar.innerHTML = '';
    if (dealing) { /* nothing to press while the cards go round */ }
    else if (g.phase === 'idle') bar.append(btn('Deal', deal, 'primary'));
    else if (g.phase === 'over') bar.append(btn('Show result', () => { modal = 'result'; render(); }), matchDone() ? btn('New match', onNewMatch, 'primary') : btn('Next hand', deal, 'primary'));
    else if (myTurn('draw')) {
      if (C.legalActions(g, ME).declareRub) bar.append(btn('Win now with the rub', onDeclareRub, 'primary'));
      const top = C.topDiscard(g);
      if (g.stock.length) bar.append(btn('Draw from stock', onStock, top == null ? 'primary' : ''));
      if (top != null && C.legalActions(g, ME).takeDiscard) { const b = btn('Take the ' + cn(C.cardType(top)), onTake, completesMe(C.cardType(top)) && g.penalty[ME] === 0 ? 'primary' : ''); bar.append(b); }
      if (!g.stock.length) bar.append(btn('End hand (stock empty)', onEnd));
    } else if (myTurn('discard')) {
      if (C.legalActions(g, ME).declareRub && pickExtra == null) bar.append(btn('Win now with the rub', onDeclareRub));
      if (pickExtra != null) bar.append(btn('Cancel secret', () => { pickExtra = null; render(); }));
      else {
        const one = selIds.length === 1 ? selIds[0] : null;
        let label = 'Discard (select a card)', off = true;
        if (selIds.length > 1) label = 'Select one card to discard';
        else if (one != null && C.isKing(one)) label = 'Kings can\u2019t be discarded';
        else if (one != null && C.cardType(one) === C.blockedType(g, ME)) label = 'Keep the card you just took until your next turn';
        else if (one != null) { label = 'Discard the ' + cn(C.cardType(one)); off = false; }
        const db = btn(label, () => onDiscard(), 'primary', off); db.dataset.key = 'discard-btn';
        bar.append(db);
        for (const opt of C.secretOptions(g, ME)) {
          const label = opt.kind === 'four' ? 'Lay down secret: four ' + cn(opt.type) : 'Lay down secret: three ' + cn(opt.type) + ' (sowee) + one card';
          bar.append(btn(label, () => onSecret(opt)));
        }
      }
    }
  }

  /** Class per card id from the planner: complete groups 'meld', one-short groups 'part'. */
  function handMarks() {
    const marks = {};
    if (!settings.hints || g.phase === 'idle' || g.phase === 'over') return marks;
    const plan = C.planFor(g, ME);
    const pool = g.hands[ME].slice().sort(byType).concat(C.extrasOf(g, ME));
    const complete = { king: 1, secret: 1, set: 1, run: 1, pong: 1 }, partial = { set2: 1, run2: 1, pong2: 1, secret3: 1 };
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
  let modalKind = null, discardFocus = null;
  function renderModal(force) {
    const m = $('#modal');
    if (!modal) { m.hidden = true; m.innerHTML = ''; modalKind = null; return; }
    if (!force && modalKind === modal && m.firstElementChild && (modal === 'rules' || modal === 'settings' || modal === 'friend')) return; // keep typed text, scroll and focus
    const opening = modalKind !== modal;
    const keepScroll = !opening && m.firstElementChild ? m.firstElementChild.scrollTop : 0;
    m.hidden = false; m.innerHTML = '';
    let box;
    if (modal === 'result') box = resultBox();
    else if (modal === 'time') box = timeBox();
    else if (modal === 'rub') box = rubBox();
    else if (modal === 'discards') box = discardsBox();
    else if (modal === 'rules') box = rulesBox();
    else if (modal === 'friend') box = friendBox();
    else if (modal === 'stats') box = statsBox();
    else box = settingsBox();
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
    const h2 = box.querySelector('h2'); if (h2) { h2.id = 'dialog-title-' + modal; box.setAttribute('aria-labelledby', h2.id); }
    m.append(box);
    if (keepScroll) box.scrollTop = keepScroll;
    m.onclick = e => { if (e.target === m && modal !== 'time' && modal !== 'rub') closeModal(); };
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
      const w = r.winner, mine = w === ME;
      box.append(el('h2', null, winWord(r) + '! ' + (mine ? 'You win the hand' : name(w) + ' wins the hand')));
      const src = r.special && r.source === 'deal' ? 'the kings were dealt to the winner'
        : { stock: 'drawn from the stock', discard: 'taken from the discard pile', time: 'claimed with “time” from another player’s stock draw', claim: 'claimed from another player’s shown stock draw', deal: 'the hand was complete as dealt' }[r.source];
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
      box.append(el('h3', null, 'Payment'));
      const dl = el('dl', 'kv');
      const kv = (k, v) => dl.append(el('dt', null, k), el('dd', null, v));
      if (r.bounit != null) kv('Winning card', cn(C.cardType(r.bounit)) + ' — ' + src); else kv('How it was won', src);
      if (r.special) kv('Special win', { prinsesa: 'Prinsesa: one king of every suit and no other kings', rub: 'Rub: three or four kings of the same suit', sevenkings: 'Seven kings: seven kings in one hand' }[r.special]);
      kv('Starting price', C.money(r.start) + ' (' + START_LABEL[r.startKind] + ')');
      for (const it of r.items || []) kv(ITEM_LABEL[it.key], it.count + ' \u00d7 ' + C.money(it.each) + ' = ' + C.money(it.amount));
      kv('Each opponent pays', C.money(r.perOpponent));
      const delta = mine ? r.total : -r.perOpponent;
      kv('Your balance', (delta > 0 ? '+' : '') + C.money(delta));
      kv('Next dealer', name(g.nextDealer) + (g.dealRule === 'right' ? ' (the deal passes to the right)' : ' (the winner deals)'));
      box.append(dl);
    }
    matchSection(box);
    box.append(barWith(btn('See your stats', () => { modal = 'stats'; statsReset = false; renderModal(true); }), btn('Close', closeModal), matchDone() ? btn('New match', onNewMatch, 'primary') : btn('Next hand', deal, 'primary')));
    return box;
  }

  const START_LABEL = { fourKings: 'four kings of one suit', prinsesa: 'prinsesa', rub: 'rub', sevenkings: 'seven kings', nokings: 'no kings', oneking: 'only one king', kingBaksyo: 'won with the king that finishes a jack-horse-king baksyo', singrey: 'singrey: every king in a jack-horse-king baksyo', regular: '2 to 6 kings' };
  const ITEM_LABEL = { kings: 'Kings', run345: '3-4-5 runs (baksyo)', runJHK: 'Jack-horse-king runs (a king as the baksyo)', pong: 'Pongs', fourAces: 'Four aces', threeAces: 'Three aces', setOfFour: 'Sets of four', secrets: 'Secrets', sowee: 'Cards matching the sowee' };
  /** Dealt three kings of one suit: win now, or wait for the fourth. */
  function rubBox() {
    const o = g.rubOffer, box = el('div', 'box');
    box.append(el('h2', null, 'Rub!'));
    const row = el('div', 'time-card');
    const three = el('div', 'stack'); for (let i = 0; i < 3; i++) three.append(cardEl(o.type));
    row.append(three);
    row.append(el('p', null, 'You were dealt three ' + cn(o.type) + ' cards. Win now with the rub, or keep playing and wait for the fourth: four kings of one suit start at ' + C.money(C.PRICE.fourKings) + ' instead of ' + C.money(C.PRICE.top) + '. While you wait you can still take the rub on any of your turns, but if someone else wins first, it is gone.'));
    box.append(row);
    box.append(barWith(btn('Wait for the fourth king', () => onRub(false)), btn('Win now with the rub', () => onRub(true), 'primary')));
    return box;
  }

  function timeBox() {
    const o = g.timeOffer, box = el('div', 'box');
    box.append(el('h2', null, 'Time!'));
    const row = el('div', 'time-card');
    row.append(cardEl(C.cardType(o.card)));
    row.append(el('p', null, name(o.from) + ' drew the ' + cn(C.cardType(o.card)) + ' from the stock and showed it because you are purro. It completes your hand: say “time” to claim it and win.'));
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

    row('Language', select('lang', settings.lang, [['en', 'English'], ['tl', 'Taglish (Tagalog and English)']], v => { settings.lang = v; applyLook(); save(); render(); renderModal(true); }));
    box.append(el('h3', null, 'Players'));
    const where = i => i === ME ? 'Your name' : i === (ME + 2) % 4 ? 'Across the table' : i === (ME + 1) % 4 ? 'On your right' : 'On your left';
    for (const i of [ME, (ME + 1) % 4, (ME + 2) % 4, (ME + 3) % 4]) {
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
      row('Match length', select('match', settings.match, [['free', 'Free play (no end)'], ['h8', '8 hands'], ['h16', '16 hands'], ['m10', 'First to ' + C.money(1000)], ['m20', 'First to ' + C.money(2000)]], v => { settings.match = v; g.match = freshMatch(); save(); render(); }));
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
    installRow(box);
    const sr = el('div', 'row'); sr.append(el('span', null, 'Your stats: hands won, best streak, biggest payout'), btn('View stats', () => { modal = 'stats'; statsReset = false; renderModal(true); })); box.append(sr);
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
    box.innerHTML = settings.lang === 'tl' ? tlVocab(RULES_TL) : RULES_HTML;
    box.append(barWith(btn('Close', closeModal, 'primary')));
    return box;
  }
  function barWith() { const b = el('div', 'bar'); for (const x of arguments) b.append(x); return b; }

  const RULES_HTML = [
    '<h2>How to play Cuajo</h2>',
    '<p>Cuajo (also written <i>kuajo</i> or <i>kuwaho</i>) is a Filipino rummy game of the mahjong family, played with a 112-card Spanish-suited pack: coins (<i>oros</i>), cups (<i>copas</i>), swords (<i>espadas</i>) and batons (<i>bastos</i>), each suit holding ace, 3, 4, 5, jack (<i>sota</i>), horse (<i>caballo</i>) and king (<i>rey</i>), with four identical copies of every card.</p>',
    '<p>The cards follow the traditional Spanish pattern: the ace is numbered 1, the court cards 10 (sota, the jack), 11 (caballo, the horse) and 12 (rey, the king), and the breaks in each card’s frame line show its suit: none for coins, one for cups, two for swords, three for batons.</p>',
    '<h3>Players and deal</h3>',
    '<p>Four players, each playing for themselves: there are no partners. The dealer takes 16 cards and everyone else 15. The next card is turned face up as the <b>sowee</b>; it is never played but affects the payment. The rest is the stock. The dealer discards first, and play passes to the right (you, then East, North, West). The winner of a hand deals the next one; after a drawn hand the same player deals again.</p>',
    '<h3>Your turn</h3>',
    '<ol><li>Take the top card of the stock, or the previous player’s discard (the top of the discard pile). A discard can only be taken by the next player in turn. You can never win with a discard: if the top discard would complete your hand, leave it and draw from the stock.</li><li>If you hold four identical cards, you may lay them face down as a <b>secret</b>, and each opponent pays you ₱50 at once, whether or not you win the hand. The three cards identical to the sowee also make a secret when laid down together with any fourth card from your hand; that fourth card is not free: it must still be part of a combination when you win, so a king is the usual choice.</li><li>Discard one card face up. <b>Kings are never discarded</b>, and a card you just took from the discards stays in your hand until your next turn.</li></ol>',
    '<h3>Combinations</h3>',
    '<ul><li><b>Set</b>: three or four cards of the same rank in different suits.</li><li><b>Run</b>: 3-4-5 or jack-horse-king in one suit (aces never run).</li><li><b>Pong</b>: three or four identical cards (same rank and suit).</li><li><b>Secret</b>: four identical cards laid face down.</li><li><b>King</b>: a king counts as a combination on its own.</li></ul>',
    '<h3>Baksyo</h3>',
    '<p>If your hand holds any king, one of your combinations must be a <b>baksyo</b> before you can win: any pong (three or four identical cards), three or four aces, or 3-4-5 or jack-horse-king of one suit. A laid secret counts as the baksyo too, since its cards are identical. A hand with no kings at all does not need a baksyo. In your hand, a finished group that is a baksyo is labelled baksyo.</p>',
    '<h3>Purro and time</h3>',
    '<p>When one more card would complete your hand, you say <b>purro</b> after discarding and set a king face up as a marker. From then on the other players show every card they draw from the stock. If someone draws the card you need, you call <b>time</b>, take it, and win. When a shown card completes more than one hand, the player who drew it wins if it completes theirs; otherwise the first purro player after them in turn order. Whether it is your turn or not, you can only win with a card from the stock, never with a discard.</p>',
    '<p>If you draw a king that does not complete your hand and you can no longer finish with one card, you announce that you are no longer purro and take back the marker. For your next two turns you must show every card you draw and may not announce purro or win; on the third turn you play normally again.</p>',
    '<h3>Winning and payment</h3>',
    '<p>The first player to arrange all 16 cards (secrets included) into combinations wins the hand; the winning card is the <b>bounit</b>. All three other players pay the winner. The price is a starting amount plus points for what the winning hand holds, counted in the arrangement worth the most.</p>',
    '<table><tr><th>Starting price</th><th>Each opponent pays</th></tr>',
    '<tr><td>Four kings of one suit</td><td>₱1,000</td></tr>',
    '<tr><td>Prinsesa, rub or seven kings</td><td>₱500</td></tr>',
    '<tr><td>A win with no kings, or with only one king</td><td>₱500</td></tr>',
    '<tr><td><b>Singrey</b>: every king you hold (2 to 6 of them) is used as baksyo in a jack-horse-king run</td><td>₱500</td></tr>',
    '<tr><td>Winning with the king that finishes your jack-horse-king baksyo (you hold the jack and horse of a suit and the king of that suit is your winning card)</td><td>₱500</td></tr>',
    '<tr><td>Any other win (2 to 6 kings)</td><td>₱200</td></tr>',
    '<tr><th>Plus</th><th></th></tr>',
    '<tr><td>Every king</td><td>₱5</td></tr>',
    '<tr><td>A 3-4-5 run (baksyo)</td><td>₱5</td></tr>',
    '<tr><td>A jack-horse-king run (a king used as the baksyo)</td><td>₱10</td></tr>',
    '<tr><td>Every pong</td><td>₱20</td></tr>',
    '<tr><td>Three aces / four aces</td><td>₱5 / ₱10</td></tr>',
    '<tr><td>Every set of four cards</td><td>₱5</td></tr>',
    '<tr><td>Every card identical to the sowee</td><td>₱20</td></tr></table>',
    '<p>If the stock runs out, the hand is a draw and nobody pays.</p>',
    '<h3>Winning with kings</h3>',
    '<p>Three special hands win at once, whether you are purro or not, straight from the deal or right after a stock draw. They need no baksyo.</p>',
    '<ul><li><b>Prinsesa</b>: exactly four kings, one of each suit, and no other kings.</li><li><b>Rub</b>: three or four kings of the same suit. When someone is purro, stock draws are shown, so if a shown card is the third of a king you hold two of, you claim it and win. If you are <b>dealt</b> three kings of one suit, you choose: win now, or keep playing and wait for the fourth, since four kings of one suit start at ₱1,000. While you wait you can still take the rub on any of your turns, but if someone else wins first, it is gone.</li><li><b>Seven kings</b>: any seven kings. Drawn one at a time, seven kings always make a rub or a prinsesa first, so in practice this comes from the deal.</li></ul>',
    '<h3>Arranging your hand</h3>',
    '<p>Click cards to select them (click again to let go), then press <b>Group</b> to keep them together. Each group is labelled: Set, Run, Pong, Kings or Four alike when it is a finished combination (with baksyo added when it is one), Needs 1 when one card is missing, or No match. Drag a card into or out of a group, drag a group by its label to move it, or press the \u00d7 on its label to break it up. <b>Auto-group</b> sorts your whole hand into groups for you; Suit and Rank sort the loose cards. Drag cards to put them in any order (on a touch screen, press and hold a card first). New cards arrive at the right end. On your discard turn, select one card and press Discard, double-click it, or drop it on the discard pile. With the keyboard, Enter selects the focused card and Shift + left or right arrow moves it.</p>',
    '<p>The computer players are not perfect. On Normal they now and then miss a useful discard, throw away a slightly worse card, or fail to notice a card they could claim with \u201ctime\u201d. Easy makes them sloppier and Hard makes them play their best; choose in Settings.</p>',
    '<p>The other players take their time like real people: you can watch each one think, draw, and discard. If it feels slow, press <b>Next move</b> (or the N key) to skip the pause; every card still moves across the table so you can follow it. Each hand starts with the deal going round the table. You can also change the pace in Settings.</p>',
    '<h3>Playing with a friend</h3>',
    '<p>Press <b>Play with a friend</b>. <b>On this computer</b>, you take turns: your cards are hidden between turns and the game asks you to pass the computer when it is the other person\u2019s go. <b>Online</b>, one of you starts a game and sends the code or link; the other joins with it, and each plays on their own computer. Your friend sits across the table or on your right, and computer players fill the other seats. Online play needs the website version of the game (' + PAGES_URL + ') or the downloaded file.</p>',
    '<p><b>Settings</b> lets you rename the players, choose the table and card backs, card size, pesos or dollars, sounds, where picked-up cards go, and whether the winner or the next player deals after a win.</p>',
    '<p>Online, up to three friends can join one game; each takes over a computer player\u2019s seat, even in the middle of a game. Use <b>Chat</b> to send quick messages that pop up over your seat. In Settings you can play a <b>match</b> (8 or 16 hands, or first to a money target) and see <b>your stats</b>.</p>',
    '<h3>House choices in this version</h3>',
    '<ul><li>You can only win with a card from the stock (your own draw, or another player’s draw claimed with “time”), never with a discard. When the stock runs out, the hand is a draw.</li><li>Pongs, the baksyo, prinsesa, rub, seven kings and the price list are house rules from Filipino family tables.</li><li>Purro is announced automatically whenever you are one card away, and the two-turn penalty after a broken purro is applied automatically.</li><li>Prices follow the house list above, in whole pesos. Secrets are paid when they are laid down.</li></ul>',
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
  /** Host: to every friend at the table. Guest: to the host. */
  function send(msg) {
    if (!net) return;
    if (net.role === 'host') { for (const gu of Object.values(net.guests || {})) if (gu.link) gu.link.send(msg); }
    else if (net.link) net.link.send(msg);
  }
  // Every few seconds each side says hello; after 16 s of silence the other computer counts as gone.
  setInterval(() => {
    if (!net) return;
    if (net.role === 'host') {
      for (const gu of Object.values(net.guests || {})) {
        if (!gu.link) continue;
        gu.link.send({ t: 'ping' });
        if (Date.now() - (gu.lastSeen || Date.now()) > 16000) friendGone(gu.seat, false);
      }
      return;
    }
    if (!net.link) return;
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
      if (v.rubWait) v.rubWait[s] = false;
    }
    if (!over && v.rubOffer && v.rubOffer.seat !== seat) v.rubOffer = Object.assign({}, v.rubOffer, { type: -1 });
    if (!over && g.drawn != null && g.turn !== seat && g.drawnFrom === 'stock' && !(g.lastShown && g.lastShown.id === g.drawn)) v.drawn = null;
    return v;
  }
  function sendState() {
    const move = lastMove; lastMove = null;
    if (!net || net.role !== 'host') return;
    for (const gu of Object.values(net.guests)) if (gu.link) sendStateTo(gu, move);
  }
  function sendStateTo(gu, move) {
    const m = move && move.kind === 'draw' && move.src === 'stock' && !move.shown && move.seat !== gu.seat ? Object.assign({}, move, { id: null }) : (move || null);
    gu.link.send({ t: 'state', view: viewFor(gu.seat), move: m });
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

  // --- hosting (up to three friends; they take the computer players' seats) ---
  const FRIEND_SEATS = [2, 1, 3];
  async function hostOnline() {
    myNameInput(); save();
    const pref = +(($('#friend-seat') || {}).value || 2);
    friendUi.error = '';
    const mine = net = { role: 'host', code: makeCode(), prefSeat: pref, ready: false, started: false, peer: null, relay: null, guests: {} };
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
          l.onClose(() => { if (net !== mine) return; const gu = Object.values(mine.guests).find(x => x.link && x.link.direct === l); if (gu) friendGone(gu.seat, false); });
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
  function activeHumans() { return [0].concat(Object.values(net.guests).filter(x => !x.away).map(x => x.seat)).sort(); }
  function freeSeat() { return [net.prefSeat].concat(FRIEND_SEATS.filter(s => s !== net.prefSeat)).find(s => !net.guests[s]); }
  function makeLink(via) {
    return via.kind === 'relay'
      ? { kind: 'relay', from: via.from, send: m => net && net.relay && net.relay.send(Object.assign({ to: via.from }, m)) }
      : { kind: 'direct', direct: via.link, send: m => via.link.send(m) };
  }
  function guestFor(via) {
    for (const gu of Object.values(net.guests)) {
      const l = gu.link;
      if (l && (via.kind === 'relay' ? l.kind === 'relay' && l.from === via.from : l.direct === via.link)) return gu;
    }
    return null;
  }
  function seatWord(seat) { return seat === 2 ? 'the seat across the table' : seat === 1 ? 'the seat on your right' : 'the seat on your left'; }
  function hostIncoming(msg, via) {
    if (!msg || !net || net.role !== 'host') return;
    const mine = net;
    let gu = guestFor(via);
    if (msg.t === 'hello') {
      if (gu && mine.started) { gu.lastSeen = Date.now(); gu.link.send({ t: 'welcome', seat: gu.seat, v: 3 }); sendStateTo(gu, null); return; }   // a repeated hello
      const nm0 = String(msg.name || '').trim().slice(0, 14);
      let seat = null;
      for (const x of Object.values(mine.guests)) if (msg.pid && x.pid === msg.pid) seat = x.seat;   // the same person coming back
      const back = seat != null;
      if (!back) seat = freeSeat();
      if (seat == null) {
        if (via.kind === 'relay') mine.relay.send({ t: 'full', to: via.from }); else via.link.send({ t: 'full' });
        return;
      }
      const old = mine.guests[seat];
      if (old && old.link && old.link.direct && old.link.direct !== via.link) old.link.direct.close();
      const taken = Object.values(mine.guests).filter(x => x.seat !== seat).map(x => x.name);
      let nm = nm0 && nm0 !== 'You' ? nm0 : 'Friend';
      if (taken.indexOf(nm) >= 0 || nm === name(0)) nm = nm + ' ' + (seat === 2 ? 'N' : seat === 1 ? 'E' : 'W');
      gu = mine.guests[seat] = { seat, pid: msg.pid || null, name: nm, link: makeLink(via), lastSeen: Date.now(), away: false };
      humanNames[seat] = nm;
      gu.link.send({ t: 'welcome', seat, v: 3 });
      if (!mine.started) {
        mine.started = true; mode = 'host'; if (ME !== 0) switchMe(0);
        if (modal === 'friend') modal = null;
        newGame(activeHumans());      // a fresh scoreboard for everyone at the table
        deal();
        flash(nm + ' joined the game.');
        return;
      }
      g.humans = activeHumans(); applyNames(); C.setDifficulty(g, settings.difficulty);
      flash(back ? nm + ' is back in the game.' : nm + ' joined and takes over ' + seatWord(seat) + '.');
      changed();
      if (modal === 'friend') renderModal(true);
      return;
    }
    if (!gu) return;
    gu.lastSeen = Date.now();
    const seat = gu.seat;
    if (msg.t === 'ping') { gu.link.send({ t: 'pong' }); return; }
    if (msg.t === 'pong') return;
    if (msg.t === 'bye') { friendGone(seat, true); return; }
    if (msg.t === 'chat') { const text = cleanChat(msg.text); if (text) { addChat(seat, text); send({ t: 'chat', seat, text }); } return; }
    if (mode !== 'host') return;
    if (msg.t === 'skip') { skipAhead(); return; }
    if (msg.t !== 'act') return;
    try {
      if (msg.a === 'deal') { if (!dealing && (g.phase === 'over' || g.phase === 'idle')) deal(); return; }
      if (msg.a === 'newmatch') { if (!dealing && g.phase === 'over' && g.match && g.match.done) newMatch(); return; }
      if (dealing) return;
      const la = C.legalActions(g, seat), a = msg.a, arg = msg.arg;
      const ok = a === 'drawStock' ? la.drawStock : a === 'takeDiscard' ? la.takeDiscard : a === 'endHand' ? la.endHand
        : a === 'discard' ? la.discard && g.hands[seat].indexOf(arg) >= 0 && !C.isKing(arg) && C.cardType(arg) !== C.blockedType(g, seat)
        : a === 'secret' ? la.discard && !!arg && la.secrets.some(o => o.type === arg.type)
        : a === 'time' ? la.timeClaim : a === 'rub' ? la.rubChoice : a === 'rubNow' ? la.declareRub : false;
      if (!ok) { sendStateTo(gu, null); return; }
      const r = act(seat, a, arg); announce(r.b); drive();
    } catch (e) { console.error(e); sendStateTo(gu, null); }
  }
  /** A friend left on purpose (their seat opens up) or dropped out (their seat waits for them; a computer fills in). */
  function friendGone(seat, onPurpose) {
    if (!net || net.role !== 'host' || !net.guests[seat]) return;
    const gu = net.guests[seat], nm = gu.name;
    if (gu.link && gu.link.direct) gu.link.direct.close();
    gu.link = null;
    if (onPurpose) { delete net.guests[seat]; delete humanNames[seat]; } else gu.away = true;
    if (!net.started) { renderModal(true); return; }
    if (g) { g.humans = activeHumans(); applyNames(); C.setDifficulty(g, settings.difficulty); }
    flash(onPurpose ? nm + ' left. A computer player takes that seat.' : nm + ' lost the connection. A computer player fills in until they rejoin.');
    changed();
    if (modal === 'friend') renderModal(true);
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
    if (msg.t === 'full') { mine.welcomed = false; friendUi.error = 'That game is full.'; closeNet(mine); net = null; renderModal(true); return; }
    if (msg.t === 'bye') { hostGone(true); return; }
    if (mode !== 'guest') return;
    if (msg.t === 'bubble') { bubbleOnly(msg.seat, msg.text, msg.msec); return; }
    if (msg.t === 'chat') { addChat(msg.seat, msg.text); return; }
    if (msg.t === 'state' && msg.view) applyRemote(msg.view, msg.move);
  }
  function applyRemote(view, move) {
    let from = null;
    if (move) {
      if (move.kind === 'draw') from = move.src === 'stock' ? rectOf('.pile.stock .card') : discardRect(topDiscardSeat());
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
    if (net.role === 'host') return;   // the host watches each friend separately
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
    chatLog = []; chatOpen = false; chatUnread = 0;
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
    net = null; chatLog = []; chatOpen = false; chatUnread = 0;
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
  function joinNames(a) { return a.length <= 1 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
  function modeLabel() {
    if (mode === 'local') return 'Pass-and-play with ' + (humanNames[Object.keys(humanNames)[0]] || 'a friend');
    if (mode === 'host') { const n = Object.values(net ? net.guests : {}).filter(x => !x.away).map(x => x.name); return n.length ? 'Online with ' + joinNames(n) : 'Online game'; }
    if (mode === 'guest') return 'Online in ' + name(0) + '’s game';
    return 'Play with a friend';
  }
  function seatLabel(s) { return s === 2 ? 'Across the table' : s === 1 ? 'On your right' : 'On your left'; }
  function friendBox() {
    const box = el('div', 'box friend');
    box.append(el('h2', null, 'Play with a friend'));
    if (net && net.role === 'host') {
      const people = Object.values(net.guests);
      box.append(el('p', null, net.started ? 'Anyone else can join with this code or link and take over a computer player’s seat.' : 'Send your friends this code or link. The game starts as soon as the first one joins; up to three friends can play, from any network.'));
      box.append(el('div', 'join-code', net.ready ? net.code : '…'));
      if (net.ready) {
        const link = el('input'); link.type = 'text'; link.readOnly = true; link.id = 'join-link'; link.value = joinLink(net.code);
        const copy = btn('Copy link', () => {
          const done = () => { copy.textContent = L('Copied'); setTimeout(() => { copy.textContent = L('Copy link'); }, 1500); };
          try { navigator.clipboard.writeText(link.value).then(done, () => { link.select(); }); } catch (e) { link.select(); }
        });
        const row = el('div', 'link-row'); row.append(link, copy); box.append(row);
      }
      const seats = el('div', 'seats');
      for (const s of FRIEND_SEATS) {
        const gu = net.guests[s], r = el('div', 'row');
        r.append(el('span', null, seatLabel(s)));
        r.append(el('span', gu ? (gu.away ? 'who away' : 'who here') : 'who open', gu ? gu.name + (gu.away ? ' (reconnecting…)' : gu.link && gu.link.kind === 'relay' ? ' (via relay)' : '') : 'Computer player'));
        seats.append(r);
      }
      box.append(seats);
      if (!net.started) {
        const st = el('p', 'wait'); st.append(net.ready ? 'Waiting for your friends to join' : 'Setting up the game', el('span', 'thinking'));
        st.lastChild.append(el('i'), el('i'), el('i'));
        box.append(st);
      }
      if (friendUi.error) box.append(el('p', 'error', friendUi.error));
      box.append(net.started ? barWith(btn('Back to playing alone', stopFriend, 'danger'), btn('Close', closeModal, 'primary')) : barWith(btn('Cancel', cancelOnline)));
      return box;
    }
    if (mode !== 'solo') {
      const who = mode === 'guest' ? 'You joined ' + name(0) + '’s game.'
        : 'You are sharing this computer with ' + humanNames[Object.keys(humanNames)[0]] + '.';
      box.append(el('p', null, who));
      if (mode === 'guest') {
        const others = humansOf().filter(s => s !== ME && s !== 0).map(s => name(s));
        if (others.length) box.append(el('p', null, 'Also playing: ' + joinNames(others) + '.'));
        if (routeLabel()) box.append(el('p', 'route', routeLabel()));
      }
      box.append(barWith(btn('Back to playing alone', stopFriend, 'danger'), btn('Close', closeModal, 'primary')));
      return box;
    }
    if (net && net.role === 'guest') {
      const st = el('p', 'wait'); st.append(L('Connecting to game') + ' ' + net.code + ' ' + L('(this can take up to 15 seconds on some networks)'), el('span', 'thinking')); st.lastChild.append(el('i'), el('i'), el('i'));
      box.append(st, barWith(btn('Cancel', cancelOnline)));
      return box;
    }
    const form = el('div', 'settings');
    const row = (label, control) => { const r = el('label', 'row'); r.append(el('span', null, label), control); form.append(r); };
    const me = el('input'); me.type = 'text'; me.id = 'friend-myname'; me.maxLength = 14; me.placeholder = L('Your name'); me.value = settings.names[0] === 'You' ? '' : settings.names[0];
    row('Your name', me);
    const seat = el('select'); seat.id = 'friend-seat';
    for (const [v, t] of [['2', 'Across the table from me'], ['1', 'On my right']]) { const o = el('option', null, t); o.value = v; seat.append(o); }
    row('My (first) friend plays as', seat);
    box.append(form);
    box.append(el('h3', null, 'Online, each on your own device'));
    box.append(el('p', null, 'Start a game and send the code or link to up to three friends, or join with the code a friend sent you. Works across different networks.'));
    const hb = el('div', 'link-row'); hb.append(btn('Start an online game', hostOnline, 'primary')); box.append(hb);
    const jc = el('input'); jc.type = 'text'; jc.id = 'join-code'; jc.maxLength = 8; jc.placeholder = L('Game code'); jc.value = friendUi.joinCode || ''; jc.autocapitalize = 'characters';
    const jr = el('div', 'link-row'); jr.append(jc, btn('Join', joinOnline)); box.append(jr);
    box.append(el('h3', null, 'On this computer'));
    box.append(el('p', null, 'Take turns on one computer. Your cards stay hidden while the other person has it.'));
    const fr = el('input'); fr.type = 'text'; fr.id = 'friend-name'; fr.maxLength = 14; fr.placeholder = L('Friend’s name');
    const lr = el('div', 'link-row'); lr.append(fr, btn('Start pass-and-play', startLocal, 'primary')); box.append(lr);
    if (friendUi.error) box.append(el('p', 'error', friendUi.error));
    box.append(barWith(btn('Close', closeModal)));
    return box;
  }

  // ---------- chat (online games) ----------
  let chatLog = [], chatOpen = false, chatUnread = 0, chatLang = null;
  const QUICK = { en: ['Nice!', 'Hurry up!', 'Ay!', 'Lucky!', 'Oops', 'Good game', 'One more hand?', 'Thanks!'], tl: ['Galing!', 'Bilisan mo!', 'Ay naku!', 'Swerte!', 'Hala', 'Good game!', 'Isa pa?', 'Salamat!'] };
  function online() { return !!net && (mode === 'host' || mode === 'guest'); }
  function cleanChat(t) { return String(t || '').replace(/\s+/g, ' ').trim().slice(0, 120); }
  function addChat(seat, text) {
    text = cleanChat(text);
    if (!text || !g) return;
    chatLog.push({ seat, who: name(seat), text });
    if (chatLog.length > 40) chatLog.shift();
    if (!chatOpen) chatUnread++;
    bubbleOnly(seat, text.length > 48 ? text.slice(0, 46) + '…' : text, 3400, 'chat');
    renderChat();
  }
  function sayChat(text) {
    text = cleanChat(text);
    if (!text || !online()) return;
    if (mode === 'guest') send({ t: 'chat', text });
    else { addChat(0, text); send({ t: 'chat', seat: 0, text }); }
  }
  function renderChat() {
    const b = $('#btn-chat');
    if (b) { b.hidden = !online(); b.textContent = L('Chat') + (chatUnread ? ' (' + chatUnread + ')' : ''); }
    const p = $('#chat');
    if (!p) return;
    if (!online() || !chatOpen) { p.hidden = true; return; }
    p.hidden = false;
    if (!p.firstChild || chatLang !== settings.lang) buildChat(p);
    const list = p.querySelector('.chat-list'); list.innerHTML = '';
    if (!chatLog.length) list.append(el('li', 'empty', 'Say hello, or tap a quick message.'));
    for (const m of chatLog) { const li = el('li'); const who = el('b'); who.textContent = (m.seat === ME ? L('You') : m.who) + ': '; li.append(who, document.createTextNode(m.text)); list.append(li); }
    list.scrollTop = list.scrollHeight;
  }
  function buildChat(p) {
    chatLang = settings.lang; p.innerHTML = '';
    const head = el('div', 'chat-head'); head.append(el('span', null, 'Chat'), btn('Close', () => { chatOpen = false; renderChat(); }, 'chip'));
    const quick = el('div', 'chat-quick');
    for (const q of QUICK[settings.lang === 'tl' ? 'tl' : 'en']) { const b = el('button', 'btn chip'); b.type = 'button'; b.textContent = q; b.addEventListener('click', () => sayChat(q)); quick.append(b); }
    const form = el('form', 'chat-form'), inp = el('input');
    inp.type = 'text'; inp.id = 'chat-input'; inp.maxLength = 120; inp.autocomplete = 'off'; inp.placeholder = L('Type a message');
    const go = () => { sayChat(inp.value); inp.value = ''; inp.focus(); };
    form.addEventListener('submit', e => { e.preventDefault(); go(); });
    form.append(inp, btn('Send', go, 'primary'));
    p.append(head, el('ul', 'chat-list'), quick, form);
  }
  function toggleChat() {
    chatOpen = !chatOpen; chatUnread = 0; renderChat();
    if (chatOpen) { const i = $('#chat-input'); if (i) setTimeout(() => i.focus(), 0); }
  }

  // ---------- matches ----------
  const MATCHES = { free: null, h8: { kind: 'hands', n: 8 }, h16: { kind: 'hands', n: 16 }, m10: { kind: 'money', target: 1000 }, m20: { kind: 'money', target: 2000 } };
  function freshMatch() {
    const m = MATCHES[settings.match] || null;
    return m ? Object.assign({ key: settings.match, startHands: g.handsPlayed, startBalances: g.balances.slice(), done: false, winners: [], checked: g.phase === 'over' ? g.handNo : -1 }, m) : null;
  }
  function matchScores() { const m = g.match; return [0, 1, 2, 3].map(s => g.balances[s] - (m ? m.startBalances[s] : 0)); }
  function matchProgress() {
    const m = g && g.match;
    if (!m) return '';
    if (m.done) return L('Match over');
    if (m.kind === 'hands') { const played = g.handsPlayed - m.startHands; return L('Hand') + ' ' + Math.min(played + (g.phase === 'over' ? 0 : 1), m.n) + ' ' + L('of') + ' ' + m.n; }
    return L('First to') + ' ' + C.money(m.target);
  }
  /** After each hand: is the match over? Runs where the game is kept (not on a guest's computer). */
  function checkMatch() {
    const m = g && g.match;
    if (!m || m.done || g.phase !== 'over' || m.checked === g.handNo) return;
    m.checked = g.handNo;
    const sc = matchScores(), best = Math.max.apply(null, sc);
    if (!(m.kind === 'hands' ? g.handsPlayed - m.startHands >= m.n : best >= m.target)) return;
    m.done = true; m.winners = [0, 1, 2, 3].filter(s => sc[s] === best);
    save();
  }
  function newMatch() { newGame(mode === 'solo' ? [0] : humansOf().slice()); deal(); }
  function onNewMatch() { if (mode === 'guest') send({ t: 'act', a: 'newmatch' }); else newMatch(); }
  function matchDone() { return !!(g && g.match && g.match.done); }
  function matchSection(box) {
    const m = g.match;
    if (!m) return;
    const sc = matchScores();
    box.append(el('h3', null, m.done ? 'Match over' : 'Match'));
    if (m.done) {
      const mine = m.winners.indexOf(ME) >= 0;
      box.append(el('p', 'match-win', mine ? (m.winners.length > 1 ? 'You share the match win!' : 'You win the match!') : joinNames(m.winners.map(name)) + (m.winners.length > 1 ? ' share the match win.' : ' wins the match.')));
    } else box.append(el('p', null, matchProgress()));
    const dl = el('dl', 'kv');
    for (const s of [ME, (ME + 1) % 4, (ME + 2) % 4, (ME + 3) % 4]) dl.append(el('dt', null, name(s)), el('dd', null, C.money(sc[s])));
    box.append(dl);
  }

  // ---------- stats (kept on this device, for your own seat) ----------
  const STATS_KEY = 'cuajo.stats.v1';
  const STATS0 = { hands: 0, won: 0, draws: 0, fromStock: 0, byTime: 0, fromDiscard: 0, special: 0, porbis: 0, purros: 0, secrets: 0, bestPayout: 0, totalWon: 0, streak: 0, bestStreak: 0, matches: 0, matchesWon: 0, counted: [] };
  let stats = loadStats(), statsReset = false;
  function loadStats() { try { const s = JSON.parse(localStorage.getItem(STATS_KEY) || '{}'); return Object.assign({}, STATS0, s, { counted: Array.isArray(s.counted) ? s.counted : [] }); } catch (e) { return Object.assign({}, STATS0, { counted: [] }); } }
  function saveStats() { try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch (e) { /* storage unavailable */ } }
  function statsSeat() { return mode === 'guest' ? ME : 0; }
  function gameId() { return mode === 'guest' ? 'g' + (net ? net.code : '') : 's' + (g.seed || 0); }
  function trackStats() {
    if (!g || g.phase === 'idle' || dealing) return;
    const me = statsSeat(), id = gameId() + ':' + g.handNo;
    const mark = k => { if (stats.counted.indexOf(k) >= 0) return false; stats.counted.push(k); if (stats.counted.length > 80) stats.counted.splice(0, stats.counted.length - 80); return true; };
    let dirty = false;
    if (g.purro[me] && mark('p:' + id)) { stats.purros++; dirty = true; }
    const ns = g.secrets[me].length;
    if (ns && mark('s' + ns + ':' + id)) { stats.secrets++; dirty = true; }
    if (g.phase === 'over' && g.result && mark('h:' + id)) {
      const r = g.result;
      stats.hands++;
      if (r.type === 'draw') stats.draws++;
      else if (r.winner === me) {
        stats.won++; stats.streak++; stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
        stats.totalWon += r.total; stats.bestPayout = Math.max(stats.bestPayout, r.total);
        if (r.source === 'time' || r.source === 'claim') stats.byTime++; else if (r.source === 'discard') stats.fromDiscard++; else stats.fromStock++;
        if (r.porbis) stats.porbis++;
        if (r.special) stats.special = (stats.special || 0) + 1;
      } else stats.streak = 0;
      dirty = true;
    }
    if (g.match && g.match.done && mark('m:' + gameId() + ':' + g.match.startHands)) { stats.matches++; if (g.match.winners.indexOf(me) >= 0) stats.matchesWon++; dirty = true; }
    if (dirty) saveStats();
  }
  function statsBox() {
    const box = el('div', 'box stats');
    box.append(el('h2', null, 'Your stats'));
    const pct = (a, b) => (b ? Math.round(100 * a / b) + '%' : '–');
    const grid = el('div', 'stat-grid');
    const tile = (label, value) => { const t = el('div', 'stat'); const v = el('b'); v.textContent = String(value); t.append(v, el('span', null, label)); grid.append(t); };
    tile('Hands played', stats.hands);
    tile('Hands won', stats.won + ' (' + pct(stats.won, stats.hands) + ')');
    tile('Best winning streak', stats.bestStreak);
    tile('Biggest payout', C.money(stats.bestPayout));
    tile('Money won in total', C.money(stats.totalWon));
    tile('Times purro', stats.purros);
    tile('Secrets laid down', stats.secrets);
    tile('No-king wins', stats.porbis);
    tile('Prinsesa, rub and seven kings', stats.special || 0);
    tile('Matches won', stats.matchesWon + ' / ' + stats.matches);
    box.append(grid);
    box.append(el('h3', null, 'How you won'));
    const dl = el('dl', 'kv');
    dl.append(el('dt', null, 'Drew the winning card'), el('dd', null, String(stats.fromStock)), el('dt', null, 'Called time'), el('dd', null, String(stats.byTime)), el('dt', null, 'Took it from the discard pile'), el('dd', null, String(stats.fromDiscard)));
    box.append(dl);
    box.append(el('p', 'note', 'Stats are kept on this device and count your own seat, whether you play alone, pass-and-play or online.'));
    const reset = statsReset
      ? btn('Yes, reset my stats', () => { stats = Object.assign({}, STATS0, { counted: stats.counted }); statsReset = false; saveStats(); renderModal(true); }, 'danger')
      : btn('Reset stats…', () => { statsReset = true; renderModal(true); });
    box.append(barWith(reset, btn('Close', closeModal, 'primary')));
    return box;
  }

  // ---------- installing as an app ----------
  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; try { render(); } catch (x) { /* not started yet */ } });
  window.addEventListener('appinstalled', () => { installPrompt = null; flash('Cuajo is installed. Open it from your home screen or apps.'); });
  function fullscreenEl() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
  function canFullscreen() { return !standaloneApp() && !!(document.fullscreenEnabled || document.webkitFullscreenEnabled); }
  function toggleFullscreen() {
    const d = document.documentElement;
    try {
      if (fullscreenEl()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else { const p = (d.requestFullscreen || d.webkitRequestFullscreen).call(d, { navigationUI: 'hide' }); if (p && p.catch) p.catch(() => {}); }
    } catch (e) { /* not allowed here */ }
  }
  function standaloneApp() { return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; }
  function appleDevice() { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  function onWebsite() { return location.protocol === 'https:' && /github\.io$/.test(location.hostname); }
  function installApp() {
    if (!installPrompt) { modal = 'settings'; renderModal(true); return; }
    const p = installPrompt; installPrompt = null;
    p.prompt();
    Promise.resolve(p.userChoice).then(() => render(), () => render());
  }
  function installRow(box) {
    const r = el('div', 'row');
    r.append(el('span', null, 'Install Cuajo as an app (home-screen icon, plays offline alone)'));
    if (standaloneApp()) r.append(el('span', 'fixed-name', 'Installed'));
    else if (installPrompt) r.append(btn('Install', installApp, 'primary'));
    else if (!onWebsite() && location.hostname !== 'localhost') r.append(el('span', 'fixed-name', 'Open the website to install: ' + PAGES_URL));
    else if (appleDevice()) r.append(el('span', 'fixed-name', 'On iPhone or iPad: tap Share, then Add to Home Screen.'));
    else r.append(el('span', 'fixed-name', 'Use your browser menu: Install Cuajo, or Add to Home Screen.'));
    box.append(r);
  }
  if ('serviceWorker' in navigator && (onWebsite() || location.hostname === 'localhost')) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ }); });
  }

  const RULES_TL = [
    '<h2>Paano laruin ang Cuajo</h2>',
    '<p>Ang Cuajo (kuajo o kuwaho) ay Filipino rummy na kamag-anak ng mahjong. Ginagamit ang 112 barahang Espanyol: oros, copas, espadas at bastos. Bawat suit ay may as, tres, cuatro, cinco, sota, caballo at rey, at tig-apat na kopya ang bawat baraha.</p>',
    '<p>Sa baraha, 1 ang as, 10 ang sota, 11 ang caballo at 12 ang rey. Makikita ang suit sa mga puwang sa linya ng frame: wala sa oros, isa sa copas, dalawa sa espadas, tatlo sa bastos.</p>',
    '<h3>Manlalaro at deal</h3>',
    '<p>Apat ang naglalaro, at kanya-kanya ang bawat isa: walang magkakampi. Labing-anim na baraha ang hawak ng dealer at labinlima naman ang sa iba. Ang susunod na baraha ay ibinubukas bilang <b>sowee</b>: hindi ito nilalaro pero may epekto sa bayad. Ang matitira ang magiging stock. Ang dealer ang unang magtatapon, at pakanan ang ikot ng laro. Ang nanalo ang magde-deal sa susunod; kapag tabla, parehong dealer ulit.</p>',
    '<h3>Sa turn mo</h3>',
    '<ol><li>Bumunot sa stock, o kunin ang huling itinapon ng naunang manlalaro. Ang susunod lang sa turn ang puwedeng kumuha ng itinapon. Hindi ka puwedeng manalo gamit ang itinapon: kung bubuo sa hawak mo ang huling itinapon, iwan ito at bumunot sa stock.</li><li>Kung may apat kang magkaparehong baraha, puwede mo itong ilapag nang nakataob bilang <b>secret</b>, at magbabayad agad sa iyo ng ₱50 ang bawat kalaban, manalo ka man o hindi. Ang tatlong kapareho ng sowee, kasama ang kahit anong ikaapat na baraha, ay secret din; pero kailangan pa ring bahagi ng kombinasyon ang ikaapat na iyon sa pagpanalo, kaya king ang karaniwang pinipili.</li><li>Magtapon ng isang baraha. <b>Hindi puwedeng itapon ang king</b>, at ang barahang kakakuha mo lang sa tapunan ay hindi muna puwedeng itapon hanggang sa susunod mong turn.</li></ol>',
    '<h3>Mga kombinasyon</h3>',
    '<ul><li><b>Set</b>: tatlo o apat na magkaparehong numero na magkakaiba ang suit.</li><li><b>Run</b>: 3-4-5 o sota-caballo-rey sa iisang suit (hindi puwede ang as).</li><li><b>Pong</b>: tatlo o apat na magkaparehong-magkapareho na baraha (parehong numero at suit).</li><li><b>Secret</b>: apat na magkaparehong baraha na nakataob na inilapag.</li><li><b>King</b>: kombinasyon na ang isang king kahit mag-isa.</li></ul>',
    '<h3>Baksyo</h3>',
    '<p>Kapag may king ka sa hawak, kailangang <b>baksyo</b> ang isa sa mga kombinasyon mo bago ka manalo: kahit anong pong (tatlo o apat na magkaparehong-magkapareho), tatlo o apat na as, o 3-4-5 o sota-caballo-rey sa iisang suit. Baksyo na rin ang nailapag na secret, dahil magkakapareho ang mga baraha nito. Kapag wala kang kahit isang king, hindi mo kailangan ng baksyo. Sa hawak mo, may nakasulat na baksyo sa label ng grupong baksyo.</p>',
    '<h3>Purro at time</h3>',
    '<p>Kapag isang baraha na lang ang kulang mo, sabihin ang <b>purro</b> pagkatapos magtapon at maglabas ng isang king bilang marker. Mula noon, ipinapakita ng iba ang bawat bunot nila sa stock. Kapag may nakabunot ng barahang kailangan mo, sabihin ang <b>time</b>, kunin ito, at panalo ka. Kung higit sa isa ang nangangailangan ng parehong baraha, panalo ang bumunot kung bubuo rin ito sa hawak niya; kung hindi, panalo ang unang naka-purro na kasunod niya. Turn mo man o hindi, puwede ka lang manalo sa barahang galing sa stock, hindi sa itinapon.</p>',
    '<p>Kapag nasira ang purro mo (halimbawa, nakabunot ka ng king na hindi bumuo), hindi ka na naka-purro. Sa susunod na dalawang turn, ipapakita mo ang bawat bunot at bawal kang mag-purro o manalo; sa ikatlong turn, normal na ulit.</p>',
    '<h3>Pagpanalo at bayad</h3>',
    '<p>Panalo ang unang makabuo ng 16 na baraha (kasama ang secret) sa mga kombinasyon; ang panalong baraha ay ang <b>bounit</b>. Nagbabayad sa nanalo ang tatlong ibang manlalaro. Ang bayad ay panimulang halaga at dagdag para sa laman ng panalong hawak, sa ayos na pinakamalaki ang halaga.</p>',
    '<table><tr><th>Panimulang bayad</th><th>Bayad ng bawat kalaban</th></tr>',
    '<tr><td>Apat na king na pareho ang suit</td><td>₱1,000</td></tr>',
    '<tr><td>Prinsesa, rub o 7 kings</td><td>₱500</td></tr>',
    '<tr><td>Panalo nang walang king, o iisa lang ang king</td><td>₱500</td></tr>',
    '<tr><td><b>Singrey</b>: lahat ng king mo (2 hanggang 6) ay ginamit na baksyo sa sota-caballo-rey</td><td>₱500</td></tr>',
    '<tr><td>Nanalo sa king na bumuo ng sota-caballo-rey na baksyo (hawak mo ang sota at caballo ng isang suit, at ang rey ng suit na iyon ang panalong baraha)</td><td>₱500</td></tr>',
    '<tr><td>Ibang panalo (2 hanggang 6 na king)</td><td>₱200</td></tr>',
    '<tr><th>Dagdag</th><th></th></tr>',
    '<tr><td>Bawat king</td><td>₱5</td></tr>',
    '<tr><td>Run na 3-4-5 (baksyo)</td><td>₱5</td></tr>',
    '<tr><td>Run na sota-caballo-rey (king ang baksyo)</td><td>₱10</td></tr>',
    '<tr><td>Bawat pong</td><td>₱20</td></tr>',
    '<tr><td>Tatlong as / apat na as</td><td>₱5 / ₱10</td></tr>',
    '<tr><td>Bawat set na apat na baraha</td><td>₱5</td></tr>',
    '<tr><td>Bawat barahang kapareho ng sowee</td><td>₱20</td></tr></table>',
    '<p>Kapag naubos ang stock, tabla ang hand at walang magbabayad.</p>',
    '<h3>Panalo sa king</h3>',
    '<p>Tatlong espesyal na hawak ang agad na panalo, naka-purro ka man o hindi, mula pa sa deal o pagkabunot sa stock. Hindi na kailangan ng baksyo.</p>',
    '<ul><li><b>Prinsesa</b>: eksaktong apat na king, isa sa bawat suit, at wala nang ibang king.</li><li><b>Rub</b>: tatlo o apat na king na pareho ang suit. Kapag may naka-purro, ipinapakita ang bawat bunot sa stock; kung ang ipinakita ay ang ikatlong king na may dalawa ka na, kunin mo ito at panalo ka. Kapag tatlong king na pareho ang suit ang <b>na-deal</b> sa iyo, ikaw ang pipili: manalo na, o maghintay sa ikaapat, dahil ₱1,000 ang panimula ng apat na king na pareho ang suit. Habang naghihintay, puwede mo pa ring kunin ang rub sa alinmang turn mo, pero kapag may ibang nanalo muna, wala na ito.</li><li><b>7 kings</b>: kahit anong pitong king. Kapag isa-isang nabunot, laging nauuna ang rub o prinsesa, kaya kadalasan sa deal ito nangyayari.</li></ul>',
    '<h3>Pag-aayos ng hawak</h3>',
    '<p>I-click ang mga baraha para piliin, tapos pindutin ang <b>I-grupo</b>. May label ang bawat grupo: Set, Run, Pong, Kings o Apat na pareho kapag buo na (may baksyo kapag baksyo ito), Kulang 1 kapag isa na lang ang kulang, o Hindi tugma. I-drag ang baraha papasok o palabas ng grupo, i-drag ang grupo sa label nito, o pindutin ang × para buwagin. Inaayos ng <b>Auto-grupo</b> ang buong hawak mo. Para magtapon: pumili ng isang baraha at pindutin ang Itapon, i-double-click, o ihulog sa tapunan.</p>',
    '<p>Naglalaro ang mga computer sa bilis na parang totoong tao; pindutin ang <b>Susunod</b> (o N) kung gusto mong bilisan. Sa Normal, paminsan-minsan silang nagkakamali. Sa Settings mapapalitan ang pangalan, wika, mesa, laki ng baraha, pera, tunog, match at iba pa.</p>',
    '<h3>Makipaglaro</h3>',
    '<p><b>Online</b>: magsimula ng laro at ipadala ang code o link sa hanggang tatlong kaibigan, kahit magkaiba ang network; papalitan nila ang mga computer. May <b>Chat</b> para sa mabilis na mensahe. <b>Sa computer na ito</b>: maghalinhinan sa iisang computer; nakatago ang baraha sa pagitan ng mga turn. Gumagana ang online sa website (' + PAGES_URL + ') at sa na-download na file.</p>',
    '<p>Batay sa mga patakaran ng <a href="https://www.pagat.com/rummy/cuajo.html" target="_blank" rel="noopener">pagat.com: Cuajo</a>.</p>'
  ].join('');

  // ---------- boot ----------
  function wire() {
    $('#btn-rules').addEventListener('click', () => { modal = 'rules'; render(); });
    $('#btn-friend').addEventListener('click', () => { modal = 'friend'; friendUi.error = ''; renderModal(true); });
    $('#btn-chat').addEventListener('click', toggleChat);
    $('#btn-install').addEventListener('click', installApp);
    $('#btn-full').addEventListener('click', toggleFullscreen);
    document.addEventListener('fullscreenchange', () => render());
    document.addEventListener('webkitfullscreenchange', () => render());
    $('#btn-settings').addEventListener('click', () => { modal = 'settings'; confirmReset = false; render(); });
    document.addEventListener('keydown', e => {
      const typing = e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
      if ((e.key === 'n' || e.key === 'N') && !typing && !modal && !e.metaKey && !e.ctrlKey && !e.altKey) { skipAhead(); return; }
      if (e.key !== 'Escape') return;
      if (drag && drag.active) { endDrag(true); return; }
      if (modal && modal !== 'time' && modal !== 'rub') closeModal();
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
    tr: x => L(x), log: x => logText(x),
    chat: t => sayChat(t), chatLog: () => chatLog.slice(), stats: () => Object.assign({}, stats), match: () => g.match, newMatch: onNewMatch,
    guests: () => net && net.guests ? Object.values(net.guests).map(x => ({ seat: x.seat, name: x.name, away: x.away, route: x.link ? x.link.kind : null })) : null,
    mode: () => mode, me: () => ME, net: () => net && { role: net.role, code: net.code, ready: net.ready, connected: net.connected, route: net.link ? net.link.kind : null, away: !!net.away, reconnecting: !!net.reconnecting, relayServers: net.relay ? net.relay.servers() : 0, direct: !!net.peer },
    dropLink: () => { const n = net; if (!n) return; if (n.link && n.link.direct) n.link.direct.close(); if (n.relay) { n.relay.close(); n.relay = null; } if (n.peer) { try { n.peer.destroy(); } catch (e) { /* ignore */ } n.peer = null; } n.link = null; if (n.role === 'guest') reconnect(n); },
    startLocal: (friend, seat) => { modal = 'friend'; renderModal(true); $('#friend-name').value = friend || 'Friend'; $('#friend-seat').value = String(seat || 2); startLocal(); },
    reveal: seat => reveal(seat), covered: () => covered(), promptSeat: () => promptSeat, stopFriend,
  };
  const hot = window.claude && window.claude.hot;
  if (hot && hot.snapshot) hot.snapshot(() => ({ g, settings, order: { ids: handOrder, hand: orderHand }, ui: { selIds, pickExtra, modal } }));
  if (hot && hot.ready) hot.ready(start); else start((hot && hot.data) || {});
})();
