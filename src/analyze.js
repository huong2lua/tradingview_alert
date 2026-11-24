import { ATR_LEN } from './config.js';
import { round } from './utils.js';
import { calcATR, calcLevels } from './indicators/atr.js';
import { calcMacd4C } from './indicators/macd4c.js';
import { calcCandleMetrics } from './indicators/candle.js';

// closedCandles: cũ -> mới, phần tử cuối là nến vừa đóng
export function analyzeClosedCandle(closedCandles) {
  const closed = closedCandles[closedCandles.length - 1];
  const atr = calcATR(closedCandles, ATR_LEN);
  if (atr === null) return null;

  return {
    time: new Date(closed.time * 1000).toLocaleString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false }),
    open: closed.open,
    high: closed.high,
    low: closed.low,
    close: closed.close,
    atr: round(atr),
    ...calcMacd4C(closedCandles),
    ...calcCandleMetrics(closed, atr),
    ...calcLevels(closed.close, atr),
  };
}