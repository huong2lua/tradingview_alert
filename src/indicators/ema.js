// EMA seed bằng SMA, giống ta.ema của Pine. Trả về mảng cùng độ dài, null khi chưa đủ dữ liệu
export function ema(values, len) {
  const out = new Array(values.length).fill(null);
  if (values.length < len) return out;
  const k = 2 / (len + 1);
  let prev = values.slice(0, len).reduce((a, b) => a + b, 0) / len;
  out[len - 1] = prev;
  for (let i = len; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}