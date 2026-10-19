const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const thisMonth = () => today().slice(0, 7);
const pct = (done, total) => total ? Math.round(done * 100 / total) : 0;
const hours = min => (min / 60).toFixed(min >= 600 ? 0 : 1);

// "2026-10-14" → local midnight (iOS can't parse every ISO variant, so do it by hand)
function parseYmd(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
}
const addDays = (date, n) => { const d = parseYmd(date); d.setDate(d.getDate() + n); return ymd(d); };
const daysUntil = date => Math.ceil((parseYmd(date) - parseYmd(today())) / 86400000);

// server timestamps carry nanoseconds, which iOS refuses to parse
const parseInstant = s => new Date(String(s).replace(/(\.\d{3})\d+/, '$1'));
const time = d => `${d.getHours()}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
// same shape as the web's toLocaleString() in zh-CN: 2026/10/9 16:43:20
const dateTime = s => { const d = s instanceof Date ? s : parseInstant(s); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${time(d)}`; };

function isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const year = d.getUTCFullYear();
  return { year, week: Math.ceil(((d - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7) };
}

const toast = title => wx.showToast({ title: String(title).slice(0, 40), icon: 'none', duration: 1800 });

const confirm = content => new Promise(resolve => wx.showModal({ content, success: r => resolve(r.confirm), fail: () => resolve(false) }));

module.exports = { pad, ymd, today, thisMonth, pct, hours, parseYmd, addDays, daysUntil, dateTime, time, isoWeek, toast, confirm };
