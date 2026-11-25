import { FF_URL } from '../config.js';

// Tin USD "High" theo ForexFactory, sắp xếp theo giờ
export async function fetchFFHigh() {
  const res = await fetch(FF_URL, {
    signal: AbortSignal.timeout(10_000),
    headers: { 'User-Agent': 'Mozilla/5.0' }, // một số CDN chặn request không có User-Agent
  });
  if (!res.ok) {
    const err = new Error(`FF feed ${res.status}`);
    err.status = res.status;
    const retryAfter = Number(res.headers.get('retry-after'));
    if (res.status === 429 && retryAfter > 0) err.retryAfterMs = retryAfter * 1000;
    throw err;
  }

  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error('FF feed trả về dữ liệu lạ');

  return rows
    .filter((r) => r.country === 'USD' && r.impact === 'High')
    .map((r) => ({
      title: r.title,
      time: new Date(r.date).toISOString(), // date có offset (-05:00/-04:00) nên đổi sang UTC
      forecast: r.forecast || null,
      previous: r.previous || null,
    }))
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}