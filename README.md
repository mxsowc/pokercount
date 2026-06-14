# potcount

Two tools for poker home games, in one small web app:

1. **Game tracker** — log every buy-in and top-up; at the end each player enters
   what they cash out, and it tells everyone **who pays who** with the fewest
   payments. Games are shared by a numeric code (e.g. `#2137`) — anyone with the
   code joins and edits live, synced across phones. Everyone picks a name, so
   every change is **attributed**: each stack keeps a full edit history of what
   changed, when, and by whom.
2. **Pot splitter** — works out exactly who wins what when players go all-in for
   different amounts, including **double-board PLO**, **run-it-twice**, **hi-lo
   (8-or-better)**, side pots, coverage and folded-but-funding players — and
   explains each pot in plain English.

**Zero runtime dependencies.** Backend is Node's built-in `http`; data is plain
JSON files; live sync is Server-Sent Events. Nothing to install, hosts anywhere
that runs Node.

## Run it

```bash
npm start            # → http://localhost:3000
npm test             # 23 engine + settlement tests
```

Open `http://localhost:3000`, create a game, share the code. The pot splitter is
at `/pot` (linked from every page).

## Deploy

Any Node host (Railway, Render, Fly, a VPS). Set `PORT` if needed. Persist the
`data/` directory (a volume) so games **and accounts** survive restarts. No build step.

```bash
PORT=8080 node server/index.js
```

### Environment variables

| Var | Purpose |
| --- | --- |
| `PORT` | HTTP port (default 3000) |
| `GOOGLE_CLIENT_ID` | Enables "Sign in with Google". Without it, the Google button is hidden and handle+PIN is used. |
| `COOKIE_SECURE` | `1` forces the session cookie to be `Secure` (HTTPS-only); `0` forces it off. If unset, it's auto-enabled whenever a request arrives over HTTPS (detected via `X-Forwarded-Proto` from the reverse proxy), so a normal HTTPS deploy is correct without setting anything, while plain-HTTP localhost dev still works. |

## Accounts & profiles

Accounts are **optional** — you can run and settle games anonymously. Signing in
links your *seat* in each game to your account so stats accrue.

- **Handle + PIN** works out of the box (passwords hashed with scrypt; sessions
  are signed, HttpOnly cookies — no dependencies).
- **Sign in with Google**: create an OAuth client ID in the Google Cloud Console
  (Authorized JavaScript origin = your site), then start the server with
  `GOOGLE_CLIENT_ID=…`. The button appears automatically and the ID token is
  **verified server-side** against Google's JWKS (`server/auth.js`). On first
  sign-in the user **picks their own name** (a suggestion from their Google
  account is pre-filled); it can be changed later via `PUT /api/me`.
- **Apple**: the provider interface is in place (`users.upsertOAuth`); wiring it
  needs an Apple Developer account (Service ID + key + client-secret JWT). Not
  enabled yet.

Each finished game contributes the player's net to their stats. A profile at
`/u/<handle>` shows **total profit, average per game, games played, % profitable,
home games, and best night**. Per your setup, **profiles are visible to
signed-in users only** (`/api/users/:handle/stats` returns 401 otherwise).

> All amounts are in euros (€).

## How the two tools work

### Settlement (`src/settle.js`)
For each player, `net = cash-out − total bought in`. A greedy match of biggest
creditor against biggest debtor yields at most *n−1* payments. All math runs in
integer cents, so decimals never drift. If the chips counted at the end don't
equal the money bought in, it reports the **discrepancy** instead of silently
"balancing" — so you recount before anyone pays.

The auto plan is only a suggestion: after a game ends you can **Adjust** it to
re-route who pays whom (pay a specific person, split, add/remove lines). The
server re-validates against the frozen balances (`PUT /api/games/:id/settlement`)
so every debtor still pays their exact total and every creditor receives theirs.

### Pot resolution (`src/resolve.js`)
Every variant is the same nested resolution:

```
for each POT LAYER (main + side pots, from contributions & all-ins):
  split across BOARDS        (double board → equal halves)
  split across RUNS          (run-it-twice → equal fractions per board)
    one SHOWDOWN per (board, run) segment among that layer's eligible players:
      high-only : best high takes it        (ties split, odd chip by seat)
      hi-lo     : best high ½, best 8-or-better low ½
                  (no qualifier → high scoops; tied low → quartering)
```

Key rules it enforces: side pots from mixed all-ins (you only win what you
matched), uncalled bets returned first, folded players keep funding pots they
can't win, Omaha's *exactly two hole cards*, hi-lo quartering and scooping, and
whole-chip division with the odd chip going to the first seat left of the button.
Straddles/antes/blinds need no special handling — they're just contributions
that changed the pot size.

## Project layout

```
src/                      shared engine (runs in Node AND the browser)
  cards.js                parsing + combinatorics
  evaluate.js             5-card high & 8-or-better low scoring + hand names
  select.js               best hand per game type (holdem / omaha 2+3)
  sidepots.js             main + side pots, uncalled-bet return
  money.js                integer-chip division with odd-chip handling
  resolve.js              the pot engine (pots × boards × runs × hi/lo)
  settle.js               who-owes-who settlement
  index.js                public exports

server/
  store.js                JSON file store, game codes, change events
  index.js                http server: REST API + SSE + static hosting

public/
  index.html / app.css    home (create / join a game)
  game.html  + js/game.js ledger: buy-ins, top-ups, cash-outs, settlement
  pot.html   + js/pot.js  pot splitter UI (imports the engine directly)
  js/api.js               REST + SSE client

test/                     node:test suites (engine, side pots, settlement)
```

## REST API

| Method | Path | Body | Purpose |
| --- | --- | --- | --- |
| POST | `/api/games` | `{name, unit, players:[{name}], code?}` | create a game (optional custom numeric code) |
| GET | `/api/games/:id` | | fetch game state |
| GET | `/api/games/:id/events` | | SSE live update stream |
| GET | `/api/games/:id/settlement` | | computed who-pays-who |
| PUT | `/api/games/:id/meta` | `{name, unit}` | rename / set currency |
| POST | `/api/games/:id/players` | `{name}` | add player |
| PATCH/DELETE | `/api/games/:id/players/:pid` | `{name}` | rename / remove |
| POST | `/api/games/:id/transactions` | `{playerId, amount, type}` | buy-in / top-up |
| PATCH | `/api/games/:id/transactions/:txId` | `{amount}` | edit a buy-in amount |
| DELETE | `/api/games/:id/transactions/:txId` | | undo a transaction |
| PUT | `/api/games/:id/final` | `{playerId, amount}` | set a cash-out |

Every mutating request carries `X-Actor-Id` and `X-Actor-Name` headers (set from
the name you enter). The server appends an entry to `game.log` for each change —
`{action, actorName, playerName, detail:{from,to,amount,type}, at}` — which is
what the per-stack edit history and the activity feed render.

## Using the engine directly

```js
import { resolve, computeSettlement } from './src/index.js';

resolve({
  game: 'omaha', hiLo: false,
  players: [
    { id: 'A', hole: 'Ah Kh Qh Jh', contributed: 100 },           // short all-in
    { id: 'B', hole: 'As Ks Qs Js', contributed: 300 },
    { id: 'C', hole: '2c 2d 7c 8d', contributed: 300 },            // covers
  ],
  boards: ['Th 9h 4c 2s 5d', '8s 6s 5s 2h Kd'],                    // double board
});
// → A wins 0, B 350, C 350; main pot (all 3) + side pot (B,C); per-board breakdown
```
