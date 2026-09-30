# Cuajo

A browser version of **Cuajo** (kuajo / kuwaho), the Filipino rummy game of the mahjong family,
played with a 112-card Spanish-suited pack. You play South with a computer partner (North)
against two computer opponents (East, West). Rules follow https://www.pagat.com/rummy/cuajo.html

## Play

- **Website:** https://spacejam91.github.io/cuajo/ (always the latest version; needed for online play)
- **Offline:** open `docs/index.html` in any browser.

## Play with a friend

- **On this computer:** pass-and-play. Cards are hidden between turns and the game asks you to pass the computer.
- **Online:** one person presses Play with a friend, then Start an online game, and sends the code or link.
  The other opens the link (or types the code) and joins. The host's copy runs the game and sends the guest
  only what their seat may see.
- **Different networks:** the browsers first try a direct connection (PeerJS/WebRTC). If that cannot be made
  within a few seconds (phone hotspots, strict routers), the game switches to an encrypted relay through three
  public MQTT servers at once (EMQX, HiveMQ, Eclipse Mosquitto), so it works between any two internet
  connections that can reach them. A heartbeat notices dropped connections; the guest reconnects on its own
  and a computer player fills in until they are back. Add `?relay=1` to the address to test the relay route.

## More

- **Up to four people online:** up to three friends can join one game (even mid-game); each takes over a computer player's seat.
- **Chat:** quick messages and one-tap phrases that pop up as speech bubbles over the sender's seat.
- **Matches and stats:** play 8 or 16 hands, or first to a money target; stats (hands won, streaks, biggest payout) are kept on each device.
- **Install as an app:** on the website, use Install app (Chrome, Edge, Android) or Share, then Add to Home Screen (iPhone, iPad). Solo play works offline.
- **Taglish:** Settings, then Language. Card names switch to the Spanish names used at Filipino tables (Cuatro de Oros); the wording could use a native speaker's review.

## Updating the website

1. Change files in `src/`, then run `node build.js` (this refreshes `docs/index.html`).
2. Commit and push in GitHub Desktop. GitHub Pages republishes within a minute or two.

## Project layout

- `src/engine.js` — rules, hand evaluation (partition / distance planner), scoring and AI. No DOM; also loads in Node.
- `src/app.js` — table UI and controller (rendering, modals, persistence, hot-reload snapshot).
- `src/style.css`, `src/template.html` — page and card styling; suit icons are inline SVG symbols.
- `build.js` — bundles everything into `docs/` (the website, with the app manifest, service worker and icons), `dist/index.html` (standalone) and `dist/page.html` (Claude artifact).
- `tools_icon.py` — draws the app icons into `src/assets/` without any image libraries.
- `test/engine.test.js` — brute-force cross-checks of the combination logic plus simulated AI-only games.

```bash
node build.js                 # rebuild dist/
GAMES=150 node test/engine.test.js
```

## Playing features

- Click cards to select them, then Group them. Group labels say Set, Run, Kings, Four alike, Needs 1, or No match.
- Drag cards (press and hold on touch screens) or whole groups by their label. Auto-group, Suit and Rank sort the hand.
- The other players move at a realistic pace: thinking dots, animated draws and discards, speech bubbles for
  Purro, Secret, Time and Cuajo, and an animated deal. Next move (or the N key) skips a pause but keeps the animation.
- Settings has a pace choice: Relaxed, Realistic, Quick, Fast.
- Computer players: Easy, Normal (default) or Hard. On Normal and Easy they make human-like mistakes: missing a
  useful discard, throwing a slightly worse card, or not noticing a card they could claim with "time". Hard plays exactly.

## Card art

Faces are inline SVG after the Fournier "Cuajo Filipino" deck: ace numbered 1, courts 10 (sota), 11 (caballo), 12 (rey),
frame breaks ("pintas") marking the suit, crossed swords and batons, and suit-coloured court figures.

## Rules implemented beyond the basics

- Up to 15 extra stock cards are drawn to satisfy the payment conditions when the bounit came from another player.
- The fourth card laid with a sowee secret must still be melded to win.
- A broken purro means two turns of shown draws with no purro or win allowed.
- The winner deals the next hand; after a drawn hand the same player deals again.

## House choices

- When the stock is empty, the player to move may still take the last discard if it wins; otherwise the hand ends as a draw.
- Purro and the broken-purro penalty are applied automatically.
- Amounts are shown in pesos with the same figures as the source (₱1.10, 50 centavos per secret, and so on).
