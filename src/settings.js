import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { TP_R } from './config.js';

// Cài đặt đổi được lúc chạy qua Telegram, lưu vào data/settings.json để restart không mất
const FILE = 'data/settings.json';
const TP_R_MIN = 0.5;
const TP_R_MAX = 10;

const settings = { tpR: TP_R }; // giá trị trong config chỉ là mặc định

try {
  const saved = JSON.parse(readFileSync(FILE, 'utf8'));
  if (Number.isFinite(saved.tpR) && saved.tpR >= TP_R_MIN && saved.tpR <= TP_R_MAX) settings.tpR = saved.tpR;
} catch {
  // chưa có file hoặc file hỏng => dùng mặc định
}

export const getTpR = () => settings.tpR;

export function setTpR(v) {
  if (!Number.isFinite(v) || v < TP_R_MIN || v > TP_R_MAX) {
    throw new Error(`TP_R phải là số từ ${TP_R_MIN} đến ${TP_R_MAX}`);
  }
  settings.tpR = v;
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(settings, null, 2));
  return v;
}
