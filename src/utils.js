export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const round = (v, d = 3) =>
  v === null || v === undefined || !Number.isFinite(v) ? null : Number(v.toFixed(d));

export function getVietnamTimeTags() {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Ho_Chi_Minh',
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hourCycle: 'h23'
    }).formatToParts(new Date());

    const get = type => parts.find(p => p.type === type).value;

    return {
        timeTag: `T${get('hour')}${get('minute')}`,
        dateTag: `D${get('day')}${get('month')}${get('year')}`
    };
}