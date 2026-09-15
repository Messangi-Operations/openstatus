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


/**
 * Every function here rejects an invalid Date up front, loudly.
 *
 * Deliberate choice, documented once: the pre-timezone code let a NaN date
 * flow through `setUTCHours`, producing NaN windows that silently matched no
 * event and no bucket — a bar that renders wrong with no error anywhere. The
 * Intl path already threw (RangeError, from `formatToParts`), but only on the
 * non-UTC branch, so the two branches disagreed about the same bad input.
 * Throwing uniformly keeps UTC and zoned behaviour identical and turns corrupt
 * bucket data into a visible failure at the seam it entered through. Upstream,
 * bucket days come out of zod transforms that reject unparseable strings, so
 * nothing reachable in production hits this without the data already being
 * corrupt.
 */
function assertValidDate(date: Date, caller: string): void {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`${caller}: invalid Date`);
  }
}

/** Calendar date in `tz` as `YYYY-MM-DD`. "en-CA" is the locale that yields it. */
export function dayKeyIn(date: Date, tz: string): string {
  assertValidDate(date, "dayKeyIn");
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

  // "GMT-05:00" normally; bare "GMT" at zero offset; "GMT+00:19:32"-style
  // seconds for pre-1912 LMT dates. Anything else is a runtime whose ICU does
  // not implement "longOffset" — and that MUST throw, not fall through: a
  // silent 0 here would quietly turn every configured zone into UTC, the exact
  // fail-silent class this module exists to avoid.
  if (name === "GMT") return 0;
  const m = /^GMT([+-])(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(name ?? "");
  if (!m) {
    throw new Error(
      `offsetMsAt: cannot parse longOffset ${JSON.stringify(name)} for zone ${JSON.stringify(tz)}`,
    );
  }
  const sign = m[1] === "-" ? -1 : 1;
  return (
    sign *
    ((Number(m[2]) * 60 + Number(m[3])) * 60_000 + Number(m[4] ?? 0) * 1_000)
  );
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
  assertValidDate(date, "startOfDayIn");
  const key = dayKeyIn(date, tz);
  const off = offsetMsAt(date, tz);
  const wall = new Date(date.getTime() + off);
  wall.setUTCHours(0, 0, 0, 0);

  let start = new Date(wall.getTime() - off);
  const off2 = offsetMsAt(start, tz);
  if (off2 !== off) start = new Date(wall.getTime() - off2);

  if (dayKeyIn(start, tz) !== key) {
    // A spring-forward transition can leave the computed midnight inside the
    // skipped hour, landing on the previous day. Nudge forward to the real
    // start (America/Santiago, America/Havana in spring, and every other zone
    // whose clocks jump forward exactly at midnight).
    const nudged = new Date(start.getTime() + 60 * 60 * 1000);
    if (dayKeyIn(nudged, tz) === key) return nudged;
    return start;
  }

  // Fall-back AT midnight (America/Havana, Atlantic/Azores: clocks go
  // 01:00 -> 00:00, so local midnight happens twice). Both passes above agree
  // on the SECOND occurrence, because the offset at `date` and at that second
  // midnight are the same post-transition value — which is why a two-pass
  // scheme alone cannot see the problem. The tell is the instant just before
  // `start`: if the offset there was larger, the transition landed exactly on
  // `start`, meaning the same wall-clock midnight already happened once,
  // exactly (offBefore - offAtStart) earlier. A day's start is its FIRST
  // midnight — an incident during the repeated hour belongs to this day, and
  // the day really is 25 hours long.
  const offAtStart = offsetMsAt(start, tz);
  const offBefore = offsetMsAt(new Date(start.getTime() - 1), tz);
  if (offBefore > offAtStart) {
    const first = new Date(start.getTime() - (offBefore - offAtStart));
    if (dayKeyIn(first, tz) === key) return first;
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
  assertValidDate(date, "startOfDayBeforeIn");
  // Known, accepted limit: a zone that SKIPS an entire calendar day
  // (Pacific/Apia jumped from Dec 29 to Dec 31, 2011) makes two values of `n`
  // resolve to the same real day, so a 45-day grid crossing the skip renders
  // 44 unique days with one duplicated. No zone has done this since 2011 and
  // none has it scheduled; detecting it here would complicate every call for a
  // case that cannot currently occur. If a country announces one again, this
  // is the function to revisit.
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
  assertValidDate(date, "dayLengthMsIn");
  const start = startOfDayIn(date, tz);
  // +36h then truncate lands squarely inside the NEXT day for any real zone,
  // whether the current one is 23, 24 or 25 hours long.
  const next = startOfDayIn(
    new Date(start.getTime() + 36 * 60 * 60 * 1000),
    tz,
  );
  return next.getTime() - start.getTime();
}
