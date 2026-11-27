import { CAL_TZ } from '../config.js';

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ===== Giờ theo múi giờ Việt Nam =====
export const vnDateKey = (d) => d.toLocaleDateString('en-CA', { timeZone: CAL_TZ }); // 2026-11-25
export const vnHour = (d) =>
  Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: CAL_TZ, hour: '2-digit', hourCycle: 'h23' }).format(d),
  );
const hhmm = (d) =>
  d.toLocaleTimeString('en-GB', { timeZone: CAL_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const ddmm = (d) => d.toLocaleDateString('en-GB', { timeZone: CAL_TZ, day: '2-digit', month: '2-digit' });
const weekday = (d) => d.toLocaleDateString('vi-VN', { timeZone: CAL_TZ, weekday: 'long' });

// ===== Thành phần chung =====
const val = (v) => (v ? `<code>${esc(v)}</code>` : '-');
const detail = (e) => `Dự báo: ${val(e.forecast)} | Trước: ${val(e.previous)}`;

function item(e, passed = false) {
  const icon = passed ? '✔️' : '🔴'; // ✔️ = tin đã ra
  return `${icon} <b>${hhmm(new Date(e.time))}</b> — ${esc(e.title)}\n${detail(e)}`;
}

// ===== Tin nhắn =====

// Bản tin 7h sáng: 24 giờ tới
export function digestMessage(list, from, to) {
  const head = `📅 <b>Tin USD high impact</b>\n(${ddmm(from)} ${hhmm(from)} → ${ddmm(to)} ${hhmm(to)})`;
  if (!list.length) return `${head}\n\n✅ Không có tin USD.`;
  return `${head}\n\n${list.map((e) => item(e)).join('\n\n')}`;
}

// Báo trước: list là các tin cùng một giờ
export function preAlertMessage(list) {
  const t = new Date(list[0].time);
  const mins = Math.max(1, Math.ceil((t.getTime() - Date.now()) / 60000));
  const body = list.map((e) => `🔴 ${esc(e.title)}\n${detail(e)}`).join('\n\n');
  return `⏰ <b>Còn ~${mins} phút: tin USD lúc ${hhmm(t)}</b>\n\n${body}`;
}

// /today
export function todayMessage(list, now = new Date()) {
  const head = `📅 <b>Tin USD high impact hôm nay</b>\n(${weekday(now)} ${ddmm(now)})`;
  if (!list.length) return `${head}\n\n✅ Hôm nay không có tin USD.`;
  const body = list.map((e) => item(e, Date.parse(e.time) <= now.getTime())).join('\n\n');
  return `${head}\n\n${body}`;
}

// /week: gom theo ngày (giờ VN)
export function weekMessage(list, now = new Date()) {
  const head = '🗓 <b>Tin USD high impact tuần này</b>';
  if (!list.length) return `${head}\n\n✅ Tuần này không có tin USD.`;

  const days = new Map();
  for (const e of list) {
    const d = new Date(e.time);
    const k = vnDateKey(d);
    if (!days.has(k)) days.set(k, { label: `${weekday(d)} ${ddmm(d)}`, items: [] });
    days.get(k).items.push(item(e, Date.parse(e.time) <= now.getTime()));
  }

  const body = [...days.values()]
    .map((day) => `<b>${day.label}</b>\n${day.items.join('\n\n')}`)
    .join('\n\n');
  return `${head}\n\n${body}`;
}