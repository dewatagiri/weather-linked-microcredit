export interface LocalParts { year: number; month: number; day: number; hour: number; minute: number; weekday: number }

const fmtCache = new Map<string, Intl.DateTimeFormat>();
/** Wall-clock parts of an instant in an IANA timezone (DST-safe). */
export function localParts(ts: Date | number | string, tz: string): LocalParts {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'short',
    });
    fmtCache.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, weekday: wd };
}

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

/** Active earning window: start inclusive, end exclusive, in the policy's local time. */
export function isWithinWorkingWindow(ts: Date | number | string, tz = 'Asia/Kuala_Lumpur', start = '08:00', end = '19:00') {
  const lp = localParts(ts, tz);
  const m = lp.hour * 60 + lp.minute;
  return { within: m >= toMin(start) && m < toMin(end), localTime: `${String(lp.hour).padStart(2, '0')}:${String(lp.minute).padStart(2, '0')}`, ...lp };
}
