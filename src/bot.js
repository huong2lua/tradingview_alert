import { bot } from './outputs/telegram.js';
import { eventsToday, eventsThisWeek } from './calendar/queries.js';
import { todayMessage, weekMessage, esc } from './calendar/format.js';
import { TELEGRAM_OWNER_ID } from './config.js';
import { parseCommand, toEaLines, describe, orderKeyboard } from './bridge/command.js';
import { broadcast, listClients } from './bridge/tcp.js';
import { getLiquidityLevels, formatLiqMessage } from './liquidity.js';
import { getTpR, setTpR } from './settings.js';

const handler = (build) => async (ctx) => {
  try {
    await ctx.reply(await build(), { parse_mode: 'HTML' });
  } catch (err) {
    console.error('Lệnh bot lỗi:', err.message);
    await ctx.reply('Chưa lấy được lịch ForexFactory, thử lại sau vài phút nhé.').catch(() => {});
  }
};

bot.command('today', handler(async () => todayMessage(await eventsToday())));
bot.command('week', handler(async () => weekMessage(await eventsThisWeek())));

// High/Low hôm qua, phiên NY hôm qua, tuần trước (bấm số để copy)
bot.command('liq', async (ctx) => {
  try {
    await ctx.reply(formatLiqMessage(await getLiquidityLevels()), { parse_mode: 'HTML' });
  } catch (err) {
    console.error('Lệnh /liq lỗi:', err.message);
    await ctx.reply('Chưa lấy được dữ liệu TradingView, thử lại sau nhé.').catch(() => {});
  }
});

// ===== Bridge MT5: chỉ chủ bot, chỉ chat riêng =====
const isOwner = (ctx) => ctx.chat?.type === 'private' && TELEGRAM_OWNER_ID && ctx.from?.id === TELEGRAM_OWNER_ID;

const HELP = [
  'Cú pháp lệnh gửi EA:',
  '<code>BUY 4152.35 SL 4146.15 TP 4164.75 R25</code>',
  '<code>SELL 4155.45-4156.5 SL 4161.65 TP 4143.05 R25</code> (2 entry, chia đôi R)',
  '<code>SL 4146.15</code> · <code>TP 4164.75</code> · <code>BE</code> · <code>CANCEL</code>',
  '<code>CLOSE</code> · <code>CLOSE BUY</code> · <code>CLOSE SELL</code> (đóng lệnh đang mở)',
  '/ea: xem EA đang kết nối',
].join('\n');

bot.command('ea', async (ctx) => {
  if (!isOwner(ctx)) return;
  const list = listClients();
  await ctx.reply(list.length ? `🖥 EA đang kết nối:\n${list.map((s) => `• ${esc(s)}`).join('\n')}` : 'Không có EA nào đang kết nối.', {
    parse_mode: 'HTML',
  });
});

// /tpr: xem TP_R; /tpr 2.5: đổi TP_R (chỉ chủ bot)
bot.command('tpr', async (ctx) => {
  if (!TELEGRAM_OWNER_ID || ctx.from?.id !== TELEGRAM_OWNER_ID) return;
  const arg = String(ctx.match ?? '').trim().replace(',', '.');
  try {
    if (!arg) return void (await ctx.reply(`🎯 TP_R hiện tại: <code>${getTpR()}</code>\nĐổi: <code>/tpr 2.5</code>`, { parse_mode: 'HTML' }));
    const old = getTpR();
    const v = setTpR(Number(arg));
    await ctx.reply(`✅ Đã đổi TP_R: ${old} ➜ <b>${v}</b>`, { parse_mode: 'HTML' });
  } catch (err) {
    await ctx.reply(`⚠️ ${esc(err.message)}`, { parse_mode: 'HTML' }).catch(() => {});
  }
});

// Đăng ký sau các command để /today, /week, /ea không bị nuốt
bot.on('message:text', async (ctx) => {
  if (!isOwner(ctx)) return;
  const text = ctx.message.text;
  if (text.startsWith('/')) return;

  try {
    const cmd = parseCommand(text);
    if (!cmd) return void (await ctx.reply(HELP, { parse_mode: 'HTML' }));
    if (cmd.error) return void (await ctx.reply(`⚠️ ${esc(cmd.error)}\nLệnh KHÔNG được gửi.`, { parse_mode: 'HTML' }));

    const lines = toEaLines(cmd);
    const sent = broadcast(lines);
    console.log(`[BRIDGE] ${describe(cmd)} -> ${sent} EA`, JSON.stringify(lines));

    await ctx.reply(
      sent > 0 ? `✅ ${esc(describe(cmd))} → ${sent} EA` : 'Không có EA nào đang kết nối.',
      {
        parse_mode: 'HTML',
        reply_parameters: { message_id: ctx.message.message_id },
        // lệnh vào: kèm nút copy entry / TP / mức R / SL (hiện cả khi 0 EA để vào tay)
        reply_markup: cmd.kind === 'order' ? orderKeyboard(cmd) : undefined,
      },
    );
  } catch (err) {
    console.error('Lệnh trade lỗi:', err.message);
  }
});

bot.catch((err) => console.error('Bot error:', err.message));

export function startBot() {
  // hiện menu lệnh trong Telegram
  bot.api
    .setMyCommands([
      { command: 'today', description: 'Tin USD high impact hôm nay' },
      { command: 'week', description: 'Tin USD high impact cả tuần' },
      { command: 'liq', description: 'High/Low hôm qua, phiên NY, tuần trước' },
      { command: 'tpr', description: 'Xem/đổi TP_R trên nút copy' },
      { command: 'ea', description: 'EA MT5 đang kết nối' },
    ])
    .catch((err) => console.error('setMyCommands lỗi:', err.message));

  if (!TELEGRAM_OWNER_ID) console.warn('[BRIDGE] Thiếu TELEGRAM_OWNER_ID, bot sẽ bỏ qua mọi lệnh trade');

  bot
    .start({ onStart: (me) => console.log(`Bot @${me.username} đang nhận lệnh`) })
    .catch((err) => console.error('Bot dừng:', err.message));
}
