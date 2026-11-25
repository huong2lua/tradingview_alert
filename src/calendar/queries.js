import { getFFEvents } from './store.js';
import { vnDateKey } from './format.js';

// Tin trong ngày hôm nay theo giờ Việt Nam (00:00 → 24:00)
export async function eventsToday(now = new Date()) {
  const events = await getFFEvents();
  const key = vnDateKey(now);
  return events.filter((e) => vnDateKey(new Date(e.time)) === key);
}

// Toàn bộ tin High của tuần trong file FF
export const eventsThisWeek = () => getFFEvents();