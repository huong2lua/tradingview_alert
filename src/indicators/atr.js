import { round } from '../utils.js';
const LEVELS = [0.382, 0.5, 0.618, 0.786, 1, 2];
export function calcATR(candles, len = 14) {
  if (candles.length < len + 1) return null;

  const tr = [];
  for (let i = 1; i < candles.length; i++) {
    const { high, low } = candles[i];
    const prevClose = candles[i - 1].close;
    tr.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }

  let atr = tr.slice(0, len).reduce((a, b) => a + b, 0) / len;
  for (let i = len; i < tr.length; i++) {
    atr = (atr * (len - 1) + tr[i]) / len;
  }
  return atr;
}
export function calcLevels(close, atrValue) {
  const out = {};
  for (const m of LEVELS) {
    const key = String(Math.round(m * 1000)).padStart(4, '0'); // 0382, 0500, 0618, 0786, 1000, 2000
    out[`upper${key}`] = round(close + m * atrValue);
    out[`lower${key}`] = round(close - m * atrValue);
  }
  return out;
}