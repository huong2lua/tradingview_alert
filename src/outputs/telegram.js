import { Bot } from 'grammy';
import { autoRetry } from '@grammyjs/auto-retry';
import { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, DEFAULT_RISK_USD } from '../config.js';
import { getTpR } from '../settings.js';
import { getVietnamTimeTags, round } from '../utils.js';

if (!TELEGRAM_BOT_TOKEN) {
  throw new Error('Thiếu TELEGRAM_BOT_TOKEN trong .env');
}

export const bot = new Bot(TELEGRAM_BOT_TOKEN);
bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 10 }));

export function formatMessage(r) {
  const icon = r.macdSignal === 'BUY' ? '🟢' : r.macdSignal === 'SELL' ? '🔴' : '⚪';
  return [
    `${icon} <b>XAUUSD M15</b> | ${r.time}`,
    `Độ lớn nến so với ATR: ${r.rangeATR}x`,
    `range: 0.5 - 0.618 - H/L`,
    `buy: ${r.lower0500} - ${r.upper0618} - ${r.low}`,
    `sell: ${r.upper0500} - ${r.upper0618} - ${r.high}`,
  ].join('\n');
}

const STATE_LABEL = {
  UP_STRONG: '🟩 Mua mạnh',
  UP_WEAK: '🟢 Mua yếu',
  DOWN_WEAK: '🟥 Bán yếu',
  DOWN_STRONG: '🔴 Bán mạnh',
};
const SIGNAL_LABEL = { BUY: '🟢 BUY', SELL: '🔴 SELL' };
const label = (map, k) => map[k] ?? '⚪ N/A';

// Dòng đầu tin: khác nhau giữa đổi / không đổi trạng thái
// mode: 'color' | 'signal'
// Trả về [trạng thái ngắn đặt cạnh tag, dòng chi tiết bên dưới]
function headerParts(r, mode) {
  if (mode === 'signal') {
    return r.signalChanged
      ? ['🔄 <b>ĐỔI TÍN HIỆU</b>', `${label(SIGNAL_LABEL, r.macdPrevSignal)} ➜ <b>${label(SIGNAL_LABEL, r.macdSignal)}</b> (${label(STATE_LABEL, r.macdState)})`]
      : ['⏸️ Giữ', `${label(SIGNAL_LABEL, r.macdSignal)} – nến thứ ${r.signalStreak} | ${label(STATE_LABEL, r.macdState)}`];
  }
  return r.macdChanged
    ? ['🔄 <b>ĐỔI MÀU</b>', `${label(STATE_LABEL, r.macdPrevState)} ➜ <b>${label(STATE_LABEL, r.macdState)}</b> ⇒ ${label(SIGNAL_LABEL, r.macdSignal)}`]
    : ['⏸️ Giữ', `${label(STATE_LABEL, r.macdState)} – nến thứ ${r.colorStreak} ⇒ ${label(SIGNAL_LABEL, r.macdSignal)}`];
}

export function formatMessage0(r, { mode = 'color' } = {}) {
  const { timeTag, dateTag } = getVietnamTimeTags();
  const [status, detail] = headerParts(r, mode);
  return [
    `#${timeTag} #${dateTag} ${status}`,
    detail,
    `Độ lớn nến so với ATR: ${r.rangeATR2}x`,
    `Close: <code>${r.close}</code>, H: <code>${r.high}</code>, L: <code>${r.low}</code>`,
    `buy: <code>${r.lower0382}</code> - <code>${r.lower0500}</code> - <code>${r.lower0618}</code> - <code>${r.lower0786}</code> - <code>${r.lower1000}</code> - <code>${r.lower2000}</code>`,
    `sell: <code>${r.upper0382}</code> - <code>${r.upper0500}</code> - <code>${r.upper0618}</code> - <code>${r.upper0786}</code> - <code>${r.upper1000}</code> - <code>${r.upper2000}</code>`,
  ].join('\n');
}

export async function sendTelegram(text, { chatId = TELEGRAM_CHAT_ID, replyMarkup, silent = false } = {}) {
  try {
    await bot.api.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      reply_markup: replyMarkup,
      disable_notification: silent,
    });
  } catch (err) {
    // Không để lỗi Telegram làm sập phiên TradingView
    console.error('Gửi Telegram thất bại:', err.message);
  }
}

// TP = entry đầu ± TP_R × khoảng cách tới SL (TP_R đổi được bằng /tpr)
const tpFrom = (side, entry, sl) => {
  const k = getTpR();
  return round(side === 'BUY' ? entry + k * (entry - sl) : entry - k * (sl - entry));
};

// Chuỗi copy đúng cú pháp lệnh bot (xem src/bridge/command.js)
const orderText = (side, entries, sl) =>
  `${side} ${entries.join('-')} SL ${sl} TP ${tpFrom(side, entries[0], sl)} R${DEFAULT_RISK_USD}`;

export function buildKeyboard(r) {
  const copy = (label, value) => ({
    text: label,
    copy_text: { text: value },
  });
  const stopBuy  = Math.min(r.lower1000, r.low);
  const stopSell = Math.max(r.upper1000, r.high);

  return {
    inline_keyboard: [
      [
        copy('🟢⚡ Close', orderText('BUY', [r.close], stopBuy)),
        copy('✨ Good', orderText('BUY', [r.lower0382], stopBuy)),
        copy('⚠️ Deep', orderText('BUY', [r.lower0786, r.lower1000], r.lower2000)),
      ],
      [
        copy('🔴⚡ Close', orderText('SELL', [r.close], stopSell)),
        copy('✨ Good', orderText('SELL', [r.upper0382], stopSell)),
        copy('⚠️ Deep', orderText('SELL', [r.upper0786, r.upper1000], r.upper2000)),
      ],
    ],
  };
}
