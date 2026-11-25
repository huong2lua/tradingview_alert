import fs from 'node:fs';
import path from 'node:path';
import { fetchFFHigh } from './api.js';

const CACHE_FILE = path.resolve('data/ff-cache.json');
const MIN_AGE_MS = 65 * 60_000; // FF chỉ cập nhật 1 lần/giờ, dư 5 phút cho an toàn
const ATTEMPT_COOLDOWN_MS = 6 * 60_000; // sau mỗi lần thử, tối thiểu chờ bấy nhiêu
const RATE_LIMIT_COOLDOWN_MS = 20 * 60_000; // bị 429 mà không có Retry-After

let events = null;
let nextFetchAt = 0;
let lastError = null;
let inflight = null;

function readCache() {
  try {
    const c = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (Array.isArray(c.events)) events = c.events;
    if (Number.isFinite(c.nextFetchAt)) nextFetchAt = c.nextFetchAt;
  } catch {
    // chưa có cache
  }
}

// ghi ra file tạm rồi rename để file không bị hỏng nếu process chết giữa chừng
function writeCache() {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    const tmp = `${CACHE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ events, nextFetchAt }));
    fs.renameSync(tmp, CACHE_FILE);
  } catch (err) {
    console.error('Không ghi được cache lịch:', err.message);
  }
}

readCache();

async function load() {
  // ghi trước khi gọi: restart liên tục cũng không dồn request
  nextFetchAt = Date.now() + ATTEMPT_COOLDOWN_MS;
  writeCache();

  try {
    events = await fetchFFHigh();
    lastError = null;
    nextFetchAt = Date.now() + MIN_AGE_MS;
  } catch (err) {
    lastError = err;
    const wait =
      err.retryAfterMs ?? (err.status === 429 ? RATE_LIMIT_COOLDOWN_MS : ATTEMPT_COOLDOWN_MS);
    nextFetchAt = Date.now() + wait;
    console.error(
      `Lấy lịch ForexFactory lỗi: ${err.message} | thử lại sau ~${Math.round(wait / 60_000)} phút` +
        (events ? ' | đang dùng cache cũ' : ''),
    );
  }
  writeCache();
}

export async function getFFEvents() {
  if (Date.now() >= nextFetchAt) {
    inflight ??= load().finally(() => {
      inflight = null;
    });
    await inflight; // load() không bao giờ throw
  }
  if (!events) throw lastError ?? new Error('Chưa có dữ liệu lịch (đang chờ FF mở lại)');
  return events;
}