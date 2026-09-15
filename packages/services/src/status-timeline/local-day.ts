/**
 * Calendar-day arithmetic in an arbitrary IANA zone.
 *
 * The uptime tracker groups checks into calendar days. Those days used to be
 * UTC days everywhere; a status page can now be configured with its own zone,
 * so the same maths has to work for `America/Bogota` (UTC-5), `Asia/Kolkata`
 * (UTC+5:30) and zones that observe DST, where a local day can be 23 or 25
 * hours long.
 *
 * Everything here works in terms of INSTANTS: a "day" is represented by the
 * instant at which it begins in the target zone, and the interval it covers is
 * `[start, nextStart)`. Never by a date string, and never by assuming a day is
 * 86_400_000 ms — that assumption is what breaks twice a year.
 *
 * Implemented with Intl rather than date-fns: `@date-fns/tz`'s `TZDate` needs
 * date-fns v4's generic-date support and this workspace is on 3.6.0, where
 * `startOfDay(new TZDate(d, "UTC"))` silently falls back to the HOST's local
 * zone.
 */

/** Calendar date in `tz` as `YYYY-MM-DD`. "en-CA" is the locale that yields it. */
export function dayKeyIn(date: Date, tz: string): string {
  return date.toLocaleDateString("en-CA", { timeZone: tz });
}

/**
 * Offset of `tz` from UTC at a given instant, in milliseconds. Positive east of
 * Greenwich. Recomputed per instant so DST is handled rather than assumed.
 */
function offsetMsAt(date: Date, tz: string): number {
  // Read the offset directly rather than diffing two formatted local strings.
  // That older trick re-parses a local time, and on a fall-back day the same
  // wall-clock hour occurs twice — the parser silently picks one, so the offset
  // comes back an hour wrong for exactly the instants this code must get right.
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "longOffset",
  })
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName")?.value;

  // "GMT-05:00", or bare "GMT" at zero offset.
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name ?? "");
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3])) * 60_000;
}

/**
 * The instant at which `date`'s calendar day begins in `tz`.
 *
 * Two passes: shift into wall-clock terms using the offset at `date`, truncate
 * to midnight, then shift back using the offset *at that midnight* — which can
 * differ across a DST boundary. Without the second pass, the day containing a
 * transition starts an hour off.
 */
export function startOfDayIn(date: Date, tz: string): Date {
  const off = offsetMsAt(date, tz);
  const wall = new Date(date.getTime() + off);
  wall.setUTCHours(0, 0, 0, 0);

  let start = new Date(wall.getTime() - off);
  const off2 = offsetMsAt(start, tz);
  if (off2 !== off) start = new Date(wall.getTime() - off2);

  // A spring-forward transition can leave the computed midnight inside the
  // skipped hour, landing on the previous day. Nudge forward to the real start.
  if (dayKeyIn(start, tz) !== dayKeyIn(date, tz)) {
    const nudged = new Date(start.getTime() + 60 * 60 * 1000);
    if (dayKeyIn(nudged, tz) === dayKeyIn(date, tz)) return nudged;
  }
  return start;
}

/**
 * Start of the calendar day `n` days before `date`'s day, in `tz`.
 *
 * Steps through wall-clock days rather than subtracting fixed milliseconds, so
 * 23- and 25-hour days do not accumulate drift.
 */
export function startOfDayBeforeIn(date: Date, tz: string, n: number): Date {
  const off = offsetMsAt(date, tz);
  const wall = new Date(date.getTime() + off);
  wall.setUTCHours(0, 0, 0, 0);
  wall.setUTCDate(wall.getUTCDate() - n);

  const approx = new Date(wall.getTime() - off);
  const off2 = offsetMsAt(approx, tz);
  const start = off2 === off ? approx : new Date(wall.getTime() - off2);

  // Re-truncate in the target zone: the arithmetic above can land just off
  // midnight when the offset changed between the two dates.
  return startOfDayIn(start, tz);
}

/** Length of `date`'s calendar day in `tz`, in ms. 23h / 25h on DST days. */
export function dayLengthMsIn(date: Date, tz: string): number {
  const start = startOfDayIn(date, tz);
  // +36h then truncate lands squarely inside the NEXT day for any real zone,
  // whether the current one is 23, 24 or 25 hours long.
  const next = startOfDayIn(
    new Date(start.getTime() + 36 * 60 * 60 * 1000),
    tz,
  );
  return next.getTime() - start.getTime();
}
