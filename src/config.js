import 'dotenv/config';

export const SYMBOL = 'OANDA:XAUUSD';
export const TIMEFRAME = '15';
export const ATR_LEN = 14;
export const MACD_FAST = 12;
export const MACD_SLOW = 26;
export const HISTORY = 500;
export const RECONNECT_DELAY_MS = 5000;
export const LOG_ONLY_ON_COLOR_CHANGE = false;

export const credentials =
  process.env.TV_SESSION && process.env.TV_SIGNATURE
    ? { session: process.env.TV_SESSION, signature: process.env.TV_SIGNATURE }
    : undefined;