import { round } from '../utils.js';

// Cú pháp lệnh gửi vào bot (không phân biệt hoa/thường):
//   BUY 4152.35 SL 4146.15 TP 4164.75 R25
//   BUY 4152.35 SL 4146.15 R25                      (TP không bắt buộc)
//   SELL 4155.45-4156.5 SL 4161.65 TP 4143.05 R25   (tối đa 2 entry, chia đều risk)
//   SL 4146.15 | TP 4164.75 | BE | CANCEL | CLOSE [BUY|SELL]
const NUM = '(\\d+(?:\\.\\d+)?)';

const pick = (text, key) => {
  const m = text.match(new RegExp(`\\b${key} ?${NUM}\\b`));
  return m ? Number(m[1]) : null;
};

// Trả về null nếu không phải lệnh, { error } nếu sai, còn lại là lệnh đã kiểm tra
export function parseCommand(raw) {
  const text = String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/(\d),(\d)/g, '$1.$2') // 4146,15 -> 4146.15
    .replace(/\s+/g, ' ');
  if (!text) return null;

  if (text === 'BE') return { kind: 'BE' };
  if (text === 'CANCEL') return { kind: 'CANCEL' };

  const close = text.match(/^CLOSE(?: (BUY|SELL))?$/);
  if (close) return { kind: 'CLOSE', side: close[1] ?? null };

  const level = text.match(new RegExp(`^(SL|TP) ${NUM}$`));
  if (level) return { kind: level[1], price: Number(level[2]) };

  const side = text.match(/^(BUY|SELL)\b/)?.[1];
  return side ? parseOrder(side, text) : null;
}

function parseOrder(side, text) {
  const entryMatch = text.match(new RegExp(`^${side} ${NUM}(?: ?- ?${NUM})?(?= |$)`));
  if (!entryMatch) return { error: `Thiếu entry (vd: ${side} 4152.35 hoặc ${side} 4147.47-4146.15)` };

  const entries = [entryMatch[1], entryMatch[2]].filter(Boolean).map(Number);
  const sl = pick(text, 'SL');
  const tp = pick(text, 'TP');
  const risk = pick(text, 'R');

  if (sl === null) return { error: 'Thiếu SL' };
  if (risk === null) return { error: 'Thiếu R (vd: R25 = rủi ro 25$)' };
  if (!(risk > 0)) return { error: 'R phải > 0' };

  const isBuy = side === 'BUY';
  for (const e of entries) {
    if (isBuy ? sl >= e : sl <= e) return { error: `SL ${sl} nằm sai phía entry ${e}` };
    if (tp !== null && (isBuy ? tp <= e : tp >= e)) return { error: `TP ${tp} nằm sai phía entry ${e}` };
  }

  return { kind: 'order', side, entries, sl, tp, risk };
}

// Mỗi phần tử là một dòng JSON phẳng gửi EA
export function toEaLines(cmd, id = Date.now().toString(36)) {
  if (cmd.kind === 'order') {
    const risk = round(cmd.risk / cmd.entries.length, 2);
    return cmd.entries.map((entry, i) => ({
      id: `${id}-${i + 1}`,
      type: cmd.side,
      entry,
      sl: cmd.sl,
      tp: cmd.tp ?? 0, // 0 = không đặt TP (EA bỏ qua)
      risk,
    }));
  }
  if (cmd.kind === 'SL' || cmd.kind === 'TP') return [{ type: cmd.kind, price: cmd.price }];
  if (cmd.kind === 'CLOSE') return [{ type: 'CLOSE', side: cmd.side ?? 'ALL' }];
  return [{ type: cmd.kind }];
}

// Mô tả ngắn để bot trả lời
export function describe(cmd) {
  if (cmd.kind === 'order') {
    const n = cmd.entries.length;
    const tp = cmd.tp === null ? ' · không TP' : '';
    return `${cmd.side} ${cmd.entries.join(' - ')}${n > 1 ? ` (${n} lệnh)` : ''} · SL ${cmd.sl}${tp} · ${cmd.risk}$`;
  }
  if (cmd.kind === 'SL' || cmd.kind === 'TP') return `${cmd.kind} all ${cmd.price}`;
  if (cmd.kind === 'CLOSE') return `CLOSE ${cmd.side ?? 'all'}`;
  return cmd.kind;
}

// Nút copy dưới câu trả lời lệnh BUY/SELL: entry, TP, các mức R và SL.
// Chuỗi copy "TP x" / "SL x" dán lại vào bot = dời TP/SL mọi lệnh.
const R_LEVELS = [1, 2, 3, 5];

export function orderKeyboard(cmd) {
  const copy = (text, value) => ({ text, copy_text: { text: String(value) } });
  const dir = cmd.side === 'BUY' ? 1 : -1;
  const rows = [];

  cmd.entries.forEach((entry, i) => {
    const dist = Math.abs(entry - cmd.sl);
    const [r1, r2, r3, r5] = R_LEVELS.map((n) => round(entry + dir * n * dist));
    const first = [copy(`📥 E${i + 1} ${entry}`, entry)];
    if (cmd.tp !== null) first.push(copy(`🎯 TP ${cmd.tp}`, `TP ${cmd.tp}`));
    rows.push(
      first,
      [copy(`1R ${r1}`, `TP ${r1}`), copy(`2R ${r2}`, `TP ${r2}`)],
      [copy(`3R ${r3}`, `TP ${r3}`), copy(`5R ${r5}`, `TP ${r5}`)],
    );
  });

  rows.push([copy(`🛑 SL ${cmd.sl}`, `SL ${cmd.sl}`)]);
  return { inline_keyboard: rows };
}
