export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const round = (v, d = 3) =>
  v === null || v === undefined || !Number.isFinite(v) ? null : Number(v.toFixed(d));