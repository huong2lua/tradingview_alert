# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A long-running Node.js (ESM) process that does three things around Telegram:
1. **XAUUSD M15 signal feed**: streams OANDA:XAUUSD 15-minute candles from TradingView. Each time a candle closes, it computes ATR, a 4-colour MACD state, candle metrics and ATR-based entry levels, then posts a message with copy-to-clipboard inline buttons.
2. **USD high-impact economic calendar** (from the ForexFactory JSON feed): sends a daily digest at 07:00 Asia/Ho_Chi_Minh, a pre-alert 30 min before each event, and handles the bot commands `/today` and `/week`.
3. **Telegram → MT5 bridge**: the owner pastes a trade command into a private chat with the bot, and the bot pushes it over TCP to every connected MT5 EA (`mt5/ea.mq5`).

4. **`/liq`** (`src/liquidity.js`): replies with yesterday's high/low (the previous D1 candle), yesterday's NY session high/low (`NY_SESSION_START`–`NY_SESSION_END` America/New_York, taken from H1 candles inside that D1 candle) and last week's high/low (W1). It fetches on demand with `getCandles` and does not touch `runSession`. Numbers go in `<code>` so tapping copies them.

Code comments, logs and user-facing messages are in Vietnamese. Keep them that way.

## Commands

- `npm start`: runs `node src/index.js` (needs a `.env`, see `.env.example`).
- `node test-bridge.mjs`: prints how `parseCommand` handles valid and invalid trade commands. It needs no `.env`.
- `node test-liq.mjs`: prints the `/liq` message to the console (fetches from TradingView, sends nothing to Telegram).
- `node test-calendar.mjs`: manual smoke test. It fetches the calendar (through the cache) and sends the `/week` message to `TELEGRAM_CHAT_ID`.
- No build, lint or test framework is set up.

## Environment

`.env` is loaded through `dotenv/config` in `src/config.js`:
- `TELEGRAM_BOT_TOKEN` (required: `src/outputs/telegram.js` throws on import without it), `TELEGRAM_CHAT_ID` (signal channel).
- `TV_SESSION` + `TV_SIGNATURE`: optional TradingView auth. Without both, the client connects anonymously.
- `CAL_DIGEST_CHAT_ID`, `CAL_ALERT_CHAT_ID`: optional. Both default to `TELEGRAM_CHAT_ID`.
- `SOCKET_TOKEN`: the shared secret EAs send in HELLO. Without it the bridge does not start.
- `TELEGRAM_OWNER_ID`: the only Telegram user whose private messages are treated as trade commands.

All tunables (symbol, timeframe, ATR/MACD lengths, history, calendar hours/intervals) are constants in `src/config.js`.

## Architecture

`src/index.js` starts the Telegram bot (long polling) and the calendar scheduler. It then loops forever on `runSession()` and reconnects after `RECONNECT_DELAY_MS` whenever a session resolves.

**Signal pipeline**
- `session.js`: one TradingView connection (`@mathieuc/tradingview`). The promise resolves on close/error and never rejects. A closed candle is detected when the forming candle's `time` changes. The first update only records the open time. It then calls `analyzeClosedCandle(candles.slice(0, -1))`, so the last element passed in is the candle that just closed.
- `analyze.js`: merges the outputs of `indicators/*` into one flat result object (`atr`, `macd*`, candle metrics, `upper0382…upper2000` / `lower0382…lower2000`).
- `indicators/atr.js` `calcLevels` builds the level keys as `close ± m*ATR` for m in `[0.382, 0.5, 0.618, 0.786, 1, 2]`, zero-padded to 4 digits. `outputs/telegram.js` (`formatMessage0`, `buildKeyboard`) reads these keys by name, so renaming a level breaks the messages.
- `indicators/macd4c.js` ports a Pine-style 4-colour MACD (MACD line only, no signal line) and maps colour states to BUY/SELL.

**Telegram** (`outputs/telegram.js`): one shared grammY `bot` instance with the auto-retry plugin. Sending and command handling both use it. `sendTelegram` always uses HTML parse mode and swallows errors, so a Telegram failure never kills the TradingView session. HTML-escape any dynamic text (see `esc` in `calendar/format.js`).

**Calendar** (`src/calendar/`)
- `api.js`: fetches the FF this-week feed, keeps only `country === 'USD' && impact === 'High'`, and normalises times to UTC ISO strings.
- `store.js`: `getFFEvents()` is the only entry point. It caches to `data/ff-cache.json` (gitignored) with a persisted `nextFetchAt`. Refresh is at most once every 65 min, there is a 6-min cooldown after every attempt (written *before* the request so restarts can't spam), and a 20-min backoff or `Retry-After` on HTTP 429. It falls back to stale cache on error and dedupes concurrent calls via `inflight`. FF rate-limits aggressively, so don't bypass this cache.
- `scheduler.js`: a `tick()` every 10s. Duplicate digests and pre-alerts are prevented by in-memory state only (`lastDigestDate`, `sentPre`), so a restart within the alert window can resend.
- `format.js`: all message builders plus the VN-timezone helpers (`vnDateKey`, `vnHour`). Day boundaries are computed in `CAL_TZ`, not UTC.
- `queries.js` / `src/bot.js`: the `/today` and `/week` command handlers.

**Bridge MT5** (`src/bridge/`, `mt5/ea.mq5`)
- **Command syntax** (case-insensitive): `BUY|SELL <entry>[-<entry2>] SL <p> TP <p> R<usd>`, `SL <p>`, `TP <p>`, `BE`, `CANCEL`, `CLOSE [BUY|SELL]`. With two entries, R is split equally. The syntax is defined in `command.js` (`parseCommand`). `buildKeyboard` in `outputs/telegram.js` produces copy-button text in this same syntax (TP = `TP_R`, R = `DEFAULT_RISK_USD`), so the two must stay in sync.
- **`command.js`**: pure functions. `parseCommand` validates the command: SL and TP must be on the correct side of the entry, and R is required. `toEaLines` turns it into flat JSON lines, one per entry, e.g. `{"id","type":"BUY","entry","sl","tp","risk"}`, `{"type":"SL","price"}`, `{"type":"BE"}`. The EA's JSON parser is naive, so keep payloads flat (no nesting, no arrays).
- **`tcp.js`**: a line-based TCP server on `BRIDGE_PORT` 3002. It does HELLO+token auth, PING/PONG, and drops EAs after 90 s of silence. `broadcast` sends to every authenticated EA; there are no groups.
- **`bot.js`**: `message:text` is registered after the commands and only handles private chats from `TELEGRAM_OWNER_ID`. `/ea` lists connected EAs.
- **`mt5/ea.mq5`**:
  - Lot size comes from `risk` and the distance to SL (`CalcLotForRisk`). `MAX_RISK_MONEY` is a per-account cap.
  - For BUY/SELL it places a LIMIT order at entry. If price has already moved past entry in the favourable direction, it opens at MARKET instead, with the lot recomputed.
  - `SL`/`TP`/`BE` apply to every open gold position. `CANCEL` deletes Buy/Sell Limits. `CLOSE` closes open gold positions, either all or one side, including manual trades unless `CLOSE_ONLY_OWN_POSITIONS` is set.
