import { round } from '../utils.js';
// =====================
// Đo nến
// =====================
export function calcCandleMetrics(c, atrValue) {
  const candleRange = c.high - c.low;
  const body = Math.abs(c.close - c.open);
  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const rangeATR = atrValue > 0 ? candleRange / atrValue : null; // Pine: na

  return {
    candleRange: round(candleRange),
    body: round(body),
    upperWick: round(upperWick),
    lowerWick: round(lowerWick),
    rangeATR: round(rangeATR),
  };
}