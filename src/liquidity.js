import { getCandles } from '@mathieuc/tradingview';
import { SYMBOL, credentials, NY_SESSION_START, NY_SESSION_END } from './config.js';
import { round } from './utils.js';

const NY_TZ = 'America/New_York';

const nyHour = (d) =>
  Number(new Intl.DateTimeFormat('en-US', { timeZone: NY_TZ, hour: '2-digit', hourCycle: 'h23' }).format(d));
// Ngày giao dịch hiển thị theo giờ NY (nến D1/W1 của OANDA mở lúc 17:00 NY)
const ddmm = (d) => d.toLocaleDateString('en-GB', { timeZone: NY_TZ, day: '2-digit', month: '2-digit' });
const toDate = (sec) => new Date(sec * 1000); // time của TradingView là Unix giây

const hl = (list) =>
  list.length
    ? { high: round(Math.max(...list.map((c) => c.high))), low: round(Math.min(...list.map((c) => c.low))) }
    : null;

// High/Low nến D1 hôm qua, phiên NY (08:00–17:00 giờ NY) nằm trong nến D1 đó, và nến W1 tuần trước
export async function getLiquidityLevels() {
  const q = (timeframe, count) => getCandles({ symbol: SYMBOL, timeframe, count, credentials });
  const [days, weeks, hours] = await Promise.all([q('D', 3), q('W', 3), q('60', 120)]);
  if (days.length < 2 || weeks.length < 2) throw new Error('Thiếu dữ liệu nến D/W');

  const prevDay = days.at(-2);
  const today = days.at(-1);
  const prevWeek = weeks.at(-2);
  const thisWeek = weeks.at(-1);

  const nyCandles = hours.filter((c) => {
    if (c.time < prevDay.time || c.time >= today.time) return false;
    const h = nyHour(toDate(c.time));
    return h >= NY_SESSION_START && h < NY_SESSION_END;
  });

  return {
    day: { ...hl([prevDay]), date: toDate(prevDay.time + 86400) }, // nến D1 mở 17:00 NY hôm trước => ngày giao dịch là hôm sau
    ny: hl(nyCandles),
    week: { ...hl([prevWeek]), from: toDate(prevWeek.time + 86400), to: toDate(thisWeek.time - 2 * 86400) }, // T2 → T6,
  };
}

const code = (v) => (v === null || v === undefined ? '-' : `<code>${v}</code>`);

export function formatLiqMessage(lv) {
  return [
    '💧 <b>XAUUSD Liquidity</b>',
    `📅 Hôm qua (${ddmm(lv.day.date)}):`,
    `High ${code(lv.day.high)} · Low ${code(lv.day.low)}`,
    `🗽 NY hôm qua (${NY_SESSION_START}h–${NY_SESSION_END}h NY):`,
    `High ${code(lv.ny?.high)} · Low ${code(lv.ny?.low)}`,
    `🗓 Tuần trước (${ddmm(lv.week.from)}–${ddmm(lv.week.to)}):`,
    `High ${code(lv.week.high)} · Low ${code(lv.week.low)}`
  ].join('\n');
}
