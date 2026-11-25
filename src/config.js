import 'dotenv/config';

export const SYMBOL = 'OANDA:XAUUSD';
export const TIMEFRAME = process.env.TIMEFRAME || '15';
export const ATR_LEN = 14;
export const MACD_FAST = 12;
export const MACD_SLOW = 26;
export const HISTORY = 500;
export const RECONNECT_DELAY_MS = 5000;
export const STALE_TIMEOUT_MS = 20 * 60_000; // quá lâu không có update => coi như kết nối treo, kết nối lại
export const WATCHDOG_TICK_MS = 60_000;
export const SEND_ONLY_ON_CHANGE = false; // true => bỏ hẳn tin khi không đổi trạng thái
// Thế nào là "đổi trạng thái": 'color' = đổi 1 trong 4 màu MACD, 'signal' = đổi BUY <-> SELL
export const CHANGE_MODE = 'color';
export const SILENT_WHEN_UNCHANGED = true; // tin không đổi trạng thái gửi không chuông
export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
export const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

export const credentials = process.env.TV_SESSION && process.env.TV_SIGNATURE ? { session: process.env.TV_SESSION, signature: process.env.TV_SIGNATURE } : undefined;

// ===== Economic calendar (ForexFactory) =====
export const FF_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
export const CAL_TZ = 'Asia/Ho_Chi_Minh';
export const CAL_DIGEST_HOUR = 7; // giờ gửi bản tin buổi sáng (theo CAL_TZ)
export const CAL_REFRESH_MS = 60 * 60 * 1000; // làm mới lịch mỗi 1 giờ
export const CAL_PRE_ALERT_MIN = 30; // báo trước bao nhiêu phút
export const CAL_TICK_MS = 10_000; // chu kỳ kiểm tra để báo trước
export const CAL_DIGEST_CHAT_ID = process.env.CAL_DIGEST_CHAT_ID || TELEGRAM_CHAT_ID;
export const CAL_ALERT_CHAT_ID = process.env.CAL_ALERT_CHAT_ID || TELEGRAM_CHAT_ID;
// ===== Bridge Telegram -> MT5 (EA kết nối TCP tới process này) =====
export const SOCKET_TOKEN = process.env.SOCKET_TOKEN; // thiếu => không bật bridge
export const TELEGRAM_OWNER_ID = Number(process.env.TELEGRAM_OWNER_ID) || null; // chỉ người này được gửi lệnh
export const BRIDGE_HOST = '0.0.0.0';
export const BRIDGE_PORT = 3002;
export const TP_R = 2; // TP trên nút copy = entry ± TP_R × khoảng cách SL
export const DEFAULT_RISK_USD = 25; // R ghi sẵn trên nút copy
