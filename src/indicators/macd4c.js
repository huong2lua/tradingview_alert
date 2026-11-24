import { MACD_FAST, MACD_SLOW } from '../config.js';
import { round } from '../utils.js';
import { ema } from './ema.js';

function macdLine(closes, fast = MACD_FAST, slow = MACD_SLOW) {
  const f = ema(closes, fast);
  const s = ema(closes, slow);
  return closes.map((_, i) => (f[i] !== null && s[i] !== null ? f[i] - s[i] : null));
}
function macdState(curr, prev) {
  if (curr === null || prev === null) return null;
  if (curr > 0 && curr > prev) return 'UP_STRONG'; // xanh lá sáng
  if (curr > 0 && curr <= prev) return 'UP_WEAK'; // xanh lá đậm
  if (curr <= 0 && curr >= prev) return 'DOWN_WEAK'; // đỏ sáng
  if (curr < 0 && curr < prev) return 'DOWN_STRONG'; // đỏ đậm
  return null;
}
const SIGNAL_BY_STATE = {
  UP_STRONG: 'BUY',
  DOWN_WEAK: 'BUY',
  DOWN_STRONG: 'SELL',
  UP_WEAK: 'SELL',
};
// Trạng thái màu của nến vừa đóng và có đổi màu so với nến trước không
export function calcMacd4C(closedCandles) {
  const macd = macdLine(closedCandles.map((c) => c.close));
  const n = macd.length;

  const state = macdState(macd[n - 1], macd[n - 2]);
  const prevState = n >= 3 ? macdState(macd[n - 2], macd[n - 3]) : null;

  return {
      macd: round(macd[n - 1], 4),
      macdState: state,
      macdPrevState: prevState,
      macdChanged: state !== null && state !== prevState, // = colorChanged
      macdSignal: state ? SIGNAL_BY_STATE[state] : null, // = isBuySignal / isSellSignal
  };
}