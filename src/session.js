import { TradingViewClient } from '@mathieuc/tradingview';
import {
  SYMBOL,
  TIMEFRAME,
  HISTORY,
  MACD_SLOW,
  SEND_ONLY_ON_CHANGE,
  CHANGE_MODE,
  TELEGRAM_CHAT_ID,
  FORWARD_CHAT_ID,
  SILENT_WHEN_UNCHANGED,
  STALE_TIMEOUT_MS,
  WATCHDOG_TICK_MS,
  credentials,
} from './config.js';
import { analyzeClosedCandle } from './analyze.js';
import { formatMessage0, sendTelegram, forwardTelegram, buildKeyboard } from './outputs/telegram.js';

// Một phiên kết nối. Resolve khi kết nối đóng/lỗi
export function runSession() {
  return new Promise(async (resolve) => {
    const client = new TradingViewClient({ credentials });
    let currentOpenTime = null; // time của nến đang chạy
    let finished = false;
    let lastUpdateAt = Date.now();
    let watchdog = null;

    const finish = async () => {
      if (finished) return;
      finished = true;
      clearInterval(watchdog);
      try {
        await client.close();
      } catch {}
      resolve();
    };

    client.on('error', (err) => console.error('Client error:', err.code ?? '', err.message));
    client.on('close', () => finish());

    try {
      await client.ready;
      console.log('isAuthenticated:', client.isAuthenticated);
    } catch (err) {
      console.error('Kết nối thất bại:', err.message);
      return finish();
    }

    const chart = client.createChart();

    chart.on('error', (err) => {
      console.error('Chart error:', err.code, err.message);
      if (err.code === 'DISCONNECTED') finish();
    });

    chart.on('symbolLoaded', (info) => {
      console.log(`Symbol loaded => ${info.pro_name ?? SYMBOL}`);
    });

    chart.on('update', () => {
      lastUpdateAt = Date.now();
      const candles = chart.candles; // cũ -> mới, phần tử cuối là nến đang chạy
      if (candles.length < MACD_SLOW + 3) return;

      const forming = candles[candles.length - 1];

      // Lần đầu: chỉ ghi nhận nến đang chạy
      if (currentOpenTime === null) {
        currentOpenTime = forming.time;
        return;
      }

      // Nến mới mở => nến trước đó vừa đóng
      if (forming.time === currentOpenTime) return;
      currentOpenTime = forming.time;

      const result = analyzeClosedCandle(candles.slice(0, -1));
      if (!result) return;
      const changed = CHANGE_MODE === 'signal' ? result.signalChanged : result.macdChanged;
      if (SEND_ONLY_ON_CHANGE && !changed) return;

      // console.log(result); // open only when test
      const text = formatMessage0(result, { mode: CHANGE_MODE });
      if (text) {
        sendTelegram(text, {
          replyMarkup: buildKeyboard(result),
          silent: SILENT_WHEN_UNCHANGED && !changed, // chỉ có chuông khi đổi trạng thái
        }).then((msg) => {
          // Đổi màu => forward tin vừa gửi ở kênh A sang kênh B
          if (changed && FORWARD_CHAT_ID && msg) forwardTelegram(TELEGRAM_CHAT_ID, msg.message_id, FORWARD_CHAT_ID);
        });
      }
    });

    // Socket có thể treo mà không bắn 'close' => tự đóng để vòng lặp ở index.js kết nối lại
    watchdog = setInterval(() => {
      const idle = Date.now() - lastUpdateAt;
      if (idle < STALE_TIMEOUT_MS) return;
      console.error(`Không có update ${Math.round(idle / 60_000)} phút, kết nối lại...`);
      finish();
    }, WATCHDOG_TICK_MS);

    lastUpdateAt = Date.now();
    chart.setMarket(SYMBOL, { timeframe: TIMEFRAME, count: HISTORY });
  });
}