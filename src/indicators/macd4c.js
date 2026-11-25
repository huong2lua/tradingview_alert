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

  const stateAt = (i) => (i >= 1 ? macdState(macd[i], macd[i - 1]) : null);
  const signalAt = (i) => SIGNAL_BY_STATE[stateAt(i)] ?? null;

  const state = stateAt(n - 1);
  const prevState = stateAt(n - 2);
  const signal = state ? SIGNAL_BY_STATE[state] : null;
  const prevSignal = prevState ? SIGNAL_BY_STATE[prevState] : null;

  // Đếm lùi số nến liên tiếp cùng màu / cùng tín hiệu (tính lại từ dữ liệu nên không mất khi reconnect)
  const countStreak = (getter, value) => {
    if (value === null) return 0;
    let k = 0;
    for (let i = n - 1; i >= 1 && getter(i) === value; i--) k++;
    return k;
  };

  return {
      macd: round(macd[n - 1], 4),
      macdState: state,
      macdPrevState: prevState,
      macdChanged: state !== null && state !== prevState, // = colorChanged
      macdSignal: signal, // = isBuySignal / isSellSignal
      macdPrevSignal: prevSignal,
      signalChanged: signal !== null && signal !== prevSignal,
      colorStreak: countStreak(stateAt, state),
      signalStreak: countStreak(signalAt, signal),
  };
}