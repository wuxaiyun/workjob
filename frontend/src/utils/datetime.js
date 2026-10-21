const pad2 = (n) => String(n).padStart(2, '0');

// 本地时区当天（避免 toISOString 在 UTC+8 的 0-8 点取到前一天）
export function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// 后端存 UTC 时间串（"YYYY-MM-DD HH:MM:SS"），按本地时区转换显示
export function fmtTime(s) {
  if (!s) return '-';
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(s));
  if (!m) return s;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
