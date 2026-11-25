import { RECONNECT_DELAY_MS } from './config.js';
import { sleep } from './utils.js';
import { runSession } from './session.js';
import { startBot } from './bot.js';
import { startCalendar } from './calendar/scheduler.js';
import { startBridge } from './bridge/tcp.js';

startBot(); // nhận lệnh /today, /week
startCalendar(); // bản tin 7h + báo trước 30 phút
startBridge(); // TCP cho EA MT5 nhận lệnh từ bot

while (true) {
  await runSession();  
  console.log(`Mất kết nối, thử lại sau ${RECONNECT_DELAY_MS / 1000}s...`);
  await sleep(RECONNECT_DELAY_MS);
}