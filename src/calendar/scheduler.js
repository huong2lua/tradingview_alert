import {
  CAL_DIGEST_HOUR,
  CAL_PRE_ALERT_MIN,
  CAL_TICK_MS,
  CAL_DIGEST_CHAT_ID,
  CAL_ALERT_CHAT_ID,
} from '../config.js';
import { sendTelegram } from '../outputs/telegram.js';
import { getFFEvents } from './store.js';
import { digestMessage, preAlertMessage, vnDateKey, vnHour } from './format.js';

const MIN = 60_000;
const HOUR = 60 * MIN;

let lastDigestDate = null;
let busy = false;
const sentPre = new Set(); // các tin đã báo trước

const keyOf = (e) => `${e.title}@${e.time}`;

function groupByTime(list) {
  const m = new Map();
  for (const e of list) m.set(e.time, [...(m.get(e.time) ?? []), e]);
  return [...m.values()];
}

// ===== Bản tin buổi sáng: 24 giờ tới =====
async function maybeDigest(events, now) {
  const d = new Date(now);
  const today = vnDateKey(d);
  if (lastDigestDate === today || vnHour(d) !== CAL_DIGEST_HOUR) return;
  lastDigestDate = today;

  const to = new Date(now + 24 * HOUR);
  const list = events.filter((e) => {
    const t = Date.parse(e.time);
    return t >= now && t < to.getTime();
  });
  await sendTelegram(digestMessage(list, d, to), { chatId: CAL_DIGEST_CHAT_ID });
}

// ===== Báo trước =====
async function maybePreAlerts(events, now) {
  const due = events.filter((e) => {
    if (sentPre.has(keyOf(e))) return false;
    const t = Date.parse(e.time);
    return now >= t - CAL_PRE_ALERT_MIN * MIN && now < t;
  });
  if (!due.length) return;

  due.forEach((e) => sentPre.add(keyOf(e)));
  for (const group of groupByTime(due)) {
    await sendTelegram(preAlertMessage(group), { chatId: CAL_ALERT_CHAT_ID });
  }
}

async function tick() {
  if (busy) return;
  busy = true;
  try {
    let events;
    try {
      events = await getFFEvents(); // dùng cache, tối đa 1 giờ mới gọi FF một lần
    } catch {
      return; // store đã log lỗi
    }

    const now = Date.now();

    // dọn khoá của tin không còn trong lịch
    const live = new Set(events.map(keyOf));
    for (const k of sentPre) if (!live.has(k)) sentPre.delete(k);

    await maybeDigest(events, now);
    await maybePreAlerts(events, now);
  } catch (err) {
    console.error('Calendar tick lỗi:', err.message);
  } finally {
    busy = false;
  }
}

export function startCalendar() {
  tick();
  setInterval(tick, CAL_TICK_MS);
}