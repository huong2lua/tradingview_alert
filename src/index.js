import { RECONNECT_DELAY_MS } from './config.js';
import { sleep } from './utils.js';
import { runSession } from './session.js';

while (true) {
  await runSession();
  console.log(`Mất kết nối, thử lại sau ${RECONNECT_DELAY_MS / 1000}s...`);
  await sleep(RECONNECT_DELAY_MS);
}