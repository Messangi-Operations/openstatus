import { expect } from "@std/expect";
import { describe, test } from "@std/testing/bdd";

import {
  dayWindowIn,
  type Event,
  isDateWithinEvent,
  reportEventDayImpact,
  reportEventDayStatus,
  resolveDayStatus,
  type StatusData,
} from "./events";
import { startOfDayBeforeIn, startOfDayIn } from "./local-day";
import { dayCoverage, probeDowntimeIntervals } from "./uptime";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * The PREVIOUS day-window implementation, pinned verbatim. Every "UTC is
 * unchanged" assertion below compares against this rather than against a
 * hand-copied expectation, so the compatibility claim is checked against the
 * real old code instead of against my reading of it.
 */
function legacyWindow(date: Date): { start: number; end: number } {
  const startOfDay = new Date(date);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setUTCHours(23, 59, 59, 999);
  return { start: startOfDay.getTime(), end: endOfDay.getTime() };
}

function legacyIsDateWithinEvent(date: Date, event: Event): boolean {
  const { start, end } = legacyWindow(date);
  const eventStart = new Date(event.from);
  const eventEnd = event.to ? new Date(event.to) : new Date();
  return eventStart.getTime() <= end && eventEnd.getTime() >= start;
}

function ev(partial: Partial<Event> & Pick<Event, "from">): Event {
  return {
    id: 1,
    name: "e",
    type: "incident",
    status: "error",
    to: null,
    ...partial,
  } as Event;
}

// A spread of dates that deliberately includes both 2026 DST transitions and
// days either side of them, plus a leap day.
const DATES = [
  "2026-01-15T00:00:00Z",
  "2026-02-28T00:00:00Z",
  "2026-03-08T00:00:00Z", // US spring forward
  "2026-03-09T00:00:00Z",
  "2026-07-04T00:00:00Z",
  "2026-09-14T00:00:00Z",
  "2026-10-31T00:00:00Z",
  "2026-11-01T00:00:00Z", // US fall back
  "2026-11-02T00:00:00Z",
  "2026-12-31T00:00:00Z",
].map((s) => new Date(s));

describe("dayWindowIn — UTC is byte-identical to the old setUTCHours pair", () => {
  test("for every date in the spread", () => {
    for (const d of DATES) {
      expect(dayWindowIn(d, "UTC")).toEqual(legacyWindow(d));
    }
  });

  test("also for instants that are not midnight", () => {
    for (const d of DATES) {
      const noon = new Date(d.getTime() + 13 * HOUR + 22 * 60_000 + 33_000);
      expect(dayWindowIn(noon, "UTC")).toEqual(legacyWindow(noon));
    }
  });
});

describe("dayWindowIn — zoned", () => {
  test("a Bogota day is the 24h starting at 05:00Z", () => {
    const w = dayWindowIn(new Date("2026-09-14T12:00:00Z"), "America/Bogota");
    expect(new Date(w.start).toISOString()).toBe("2026-09-14T05:00:00.000Z");
    expect(w.end - w.start).toBe(DAY - 1);
  });

  test("a fall-back day really spans 25 hours", () => {
    const w = dayWindowIn(new Date("2026-11-01T12:00:00Z"), "America/New_York");
    expect(w.end - w.start).toBe(25 * HOUR - 1);
  });

  test("a spring-forward day spans 23 hours", () => {
    const w = dayWindowIn(new Date("2026-03-08T12:00:00Z"), "America/New_York");
    expect(w.end - w.start).toBe(23 * HOUR - 1);
  });

  test("consecutive days tile with no gap and no overlap, across DST", () => {
    // If they did not, an incident in the seam would be counted twice or not
    // at all — the class of bug a flat 86_400_000 introduces.
    const anchor = new Date("2026-11-05T12:00:00Z");
    for (let i = 0; i < 10; i++) {
      const a = dayWindowIn(
        startOfDayBeforeIn(anchor, "America/New_York", i + 1),
        "America/New_York",
      );
      const b = dayWindowIn(
        startOfDayBeforeIn(anchor, "America/New_York", i),
        "America/New_York",
      );
      expect(a.end + 1).toBe(b.start);
    }
  });
});

describe("isDateWithinEvent", () => {
  test("UTC matches the pinned legacy implementation exactly", () => {
    const events = [
      ev({ from: new Date("2026-09-14T00:00:00Z") }),
      ev({
        from: new Date("2026-09-13T23:59:59.999Z"),
        to: new Date("2026-09-14T00:00:00.000Z"),
      }),
      ev({
        from: new Date("2026-09-14T23:59:59.999Z"),
        to: new Date("2026-09-15T04:00:00Z"),
      }),
      ev({
        from: new Date("2026-01-01T00:00:00Z"),
        to: new Date("2026-12-31T23:59:59Z"),
      }),
      ev({
        from: new Date("2020-01-01T00:00:00Z"),
        to: new Date("2020-01-02T00:00:00Z"),
      }),
    ];
    for (const d of DATES) {
      for (const e of events) {
        expect(isDateWithinEvent(d, e)).toBe(legacyIsDateWithinEvent(d, e));
        // explicit "UTC" must agree with the default
        expect(isDateWithinEvent(d, e, "UTC")).toBe(
          legacyIsDateWithinEvent(d, e),
        );
      }
    }
  });

  test("an event is attributed to the LOCAL day it happened on", () => {
    // 02:00Z on Sep 14 is 21:00 on Sep 13 in Bogota. Under UTC days it belongs
    // to Sep 14; under Bogota days it belongs to Sep 13 — which is the date the
    // bar is labelled with, and the whole point of the feature.
    const e = ev({
      from: new Date("2026-09-14T02:00:00Z"),
      to: new Date("2026-09-14T03:00:00Z"),
    });
    const sep14 = startOfDayIn(
      new Date("2026-09-14T12:00:00Z"),
      "America/Bogota",
    );
    const sep13 = startOfDayIn(
      new Date("2026-09-13T12:00:00Z"),
      "America/Bogota",
    );

    expect(isDateWithinEvent(sep14, e, "America/Bogota")).toBe(false);
    expect(isDateWithinEvent(sep13, e, "America/Bogota")).toBe(true);
    // ...and unchanged under UTC
    expect(isDateWithinEvent(new Date("2026-09-14T00:00:00Z"), e)).toBe(true);
  });

  test("an incident in the repeated fall-back hour still lands in its day", () => {
    // 05:30Z on 2026-11-01 is 01:30 EDT — the first pass through the repeated
    // hour. A 24h-wide window anchored at the day's start covers it; the point
    // here is that the day's END also extends past it.
    const e = ev({
      from: new Date("2026-11-02T04:30:00Z"), // 23:30 EST, still Nov 1 local
      to: new Date("2026-11-02T04:45:00Z"),
    });
    const nov1 = startOfDayIn(
      new Date("2026-11-01T12:00:00Z"),
      "America/New_York",
    );
    expect(isDateWithinEvent(nov1, e, "America/New_York")).toBe(true);
    // a flat 24h window from the day start would have ended at 03:00Z and missed it
    expect(e.from.getTime() - nov1.getTime()).toBeGreaterThan(DAY);
  });
});

describe("reportEventDayImpact / reportEventDayStatus", () => {
  const report = ev({
    type: "report",
    from: new Date("2026-09-14T02:00:00Z"),
    impactIntervals: [
      {
        from: new Date("2026-09-14T02:00:00Z"),
        to: new Date("2026-09-14T03:00:00Z"),
        impact: "major_outage",
      },
    ],
  } as Partial<Event> & Pick<Event, "from">);

  test("UTC behaviour is unchanged", () => {
    const d = new Date("2026-09-14T00:00:00Z");
    expect(reportEventDayImpact(report, d)).toBe("major_outage");
    expect(reportEventDayImpact(report, d, "UTC")).toBe("major_outage");
    expect(reportEventDayStatus(report, d)).toBe("error");
  });

  test("the impact follows the interval into its local day", () => {
    const sep13 = startOfDayIn(
      new Date("2026-09-13T12:00:00Z"),
      "America/Bogota",
    );
    const sep14 = startOfDayIn(
      new Date("2026-09-14T12:00:00Z"),
      "America/Bogota",
    );
    expect(reportEventDayImpact(report, sep13, "America/Bogota")).toBe(
      "major_outage",
    );
    // not null — null is reserved for legacy reports with no impact rows at
    // all. A day this report does not touch has no non-operational impact.
    expect(reportEventDayImpact(report, sep14, "America/Bogota")).toBe(
      "operational",
    );
    expect(reportEventDayStatus(report, sep14, "America/Bogota")).toBe(
      "success",
    );
  });
});

describe("resolveDayStatus", () => {
  const bucket = (day: Date): StatusData => ({
    day: day.toISOString(),
    count: 1,
    ok: 1,
    degraded: 0,
    error: 0,
    monitorId: "1",
  });

  test("an incident colours the local day, not the UTC one", () => {
    const incident = ev({
      from: new Date("2026-09-14T02:00:00Z"),
      to: new Date("2026-09-14T03:00:00Z"),
    });
    const sep13 = startOfDayIn(
      new Date("2026-09-13T12:00:00Z"),
      "America/Bogota",
    );
    const sep14 = startOfDayIn(
      new Date("2026-09-14T12:00:00Z"),
      "America/Bogota",
    );

    expect(
      resolveDayStatus(bucket(sep13), [incident], "America/Bogota").status,
    ).toBe("down");
    expect(
      resolveDayStatus(bucket(sep14), [incident], "America/Bogota").status,
    ).toBe("operational");
  });

  test("defaulting to UTC is unchanged", () => {
    const incident = ev({
      from: new Date("2026-09-14T02:00:00Z"),
      to: new Date("2026-09-14T03:00:00Z"),
    });
    const utcSep14 = new Date("2026-09-14T00:00:00Z");
    expect(resolveDayStatus(bucket(utcSep14), [incident]).status).toBe("down");
  });
});

describe("dayCoverage", () => {
  const starts = (tz: string) => {
    const anchor = new Date("2026-11-05T12:00:00Z");
    return Array.from({ length: 10 }, (_, i) =>
      startOfDayBeforeIn(anchor, tz, i).getTime(),
    ).sort((a, b) => a - b);
  };

  test("UTC total is unchanged: n days x 24h", () => {
    const { totalMs } = dayCoverage(starts("UTC"));
    expect(totalMs).toBe(10 * DAY);
  });

  test("across a fall-back the zoned total gains the extra hour", () => {
    // The 10-day window ending Nov 5 contains Nov 1, a 25-hour day.
    const { totalMs, segments } = dayCoverage(
      starts("America/New_York"),
      undefined,
      "America/New_York",
    );
    expect(totalMs).toBe(10 * DAY + HOUR);
    // and the segments tile exactly — no double-counted hour
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i - 1].end).toBe(segments[i].start);
    }
  });
});

describe("probeDowntimeIntervals", () => {
  const item = (day: Date): StatusData => ({
    day: day.toISOString(),
    count: 10,
    ok: 5,
    degraded: 0,
    error: 5,
    monitorId: "1",
  });

  test("a UTC day's interval is 24h, as before", () => {
    const day = new Date("2026-11-01T00:00:00Z");
    const [iv] = probeDowntimeIntervals([item(day)], {
      start: 0,
      end: Number.MAX_SAFE_INTEGER,
      now: Date.now(),
    });
    expect(iv.to - iv.from).toBe(DAY);
  });

  test("a zoned fall-back day's interval is 25h", () => {
    const day = startOfDayIn(
      new Date("2026-11-01T12:00:00Z"),
      "America/New_York",
    );
    const [iv] = probeDowntimeIntervals(
      [item(day)],
      { start: 0, end: Number.MAX_SAFE_INTEGER, now: Date.now() },
      "America/New_York",
    );
    expect(iv.to - iv.from).toBe(25 * HOUR);
  });
});
