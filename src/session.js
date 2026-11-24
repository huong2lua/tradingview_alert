import { TradingViewClient } from '@mathieuc/tradingview';
import {
  SYMBOL,
  TIMEFRAME,
  HISTORY,
  MACD_SLOW,
  LOG_ONLY_ON_COLOR_CHANGE,
  credentials,
} from './config.js';
import { analyzeClosedCandle } from './analyze.js';

// Một phiên kết nối. Resolve khi kết nối đóng/lỗi
export function runSession() {
  return new Promise(async (resolve) => {
    const client = new TradingViewClient({ credentials });
    let currentOpenTime = null; // time của nến đang chạy
    let finished = false;

    const finish = async () => {
      if (finished) return;
      finished = true;
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
      if (LOG_ONLY_ON_COLOR_CHANGE && !result.macdChanged) return;

      console.log(result);
    });

    chart.setMarket(SYMBOL, { timeframe: TIMEFRAME, count: HISTORY });
  });
}