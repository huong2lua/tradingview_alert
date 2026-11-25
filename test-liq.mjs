// Chạy: node test-liq.mjs — in tin /liq ra console, không gửi Telegram
import { getLiquidityLevels, formatLiqMessage } from './src/liquidity.js';

const lv = await getLiquidityLevels();
console.log(lv);
console.log('\n' + formatLiqMessage(lv));
