import { expect } from "@std/expect";
import { describe, test } from "@std/testing/bdd";

import type { StatusData } from "./events";
import { dayCoverage, probeDowntimeIntervals } from "./uptime";

/**
 * `local-day.ts` rejects an invalid Date in every entry point, deliberately, so
 * corrupt bucket data fails at the seam instead of rendering a silently wrong
 * bar. `uptime.ts` had its own `tz === "UTC" ? MS_PER_DAY : ...` short-circuit
 * that routed around that guard, so the same corrupt bucket threw in a zoned
 * page and returned NaN in a UTC one — NaN that propagates all the way to a NaN
 * uptime percentage.
 *
 * These pin the property that matters: identical inputs fail identically,
 * whichever zone the page happens to be in.
 */
const corrupt: StatusData = {
  day: "not-a-date",
  count: 10,
  ok: 5,
  degraded: 0,
  error: 5,
  monitorId: "1",
};

const window = {
  start: 0,
  end: Number.MAX_SAFE_INTEGER,
  now: 1_700_000_000_000,
};

describe("invalid bucket data fails the same way in every zone", () => {
  test("probeDowntimeIntervals throws in UTC, not just in a zone", () => {
    expect(() => probeDowntimeIntervals([corrupt], window, "UTC")).toThrow(
      RangeError,
    );
    expect(() =>
      probeDowntimeIntervals([corrupt], window, "America/Bogota"),
    ).toThrow(RangeError);
  });

  test("probeDowntimeIntervals no longer yields NaN intervals under UTC", () => {
    // The old failure mode: an interval object whose from/to were both NaN,
    // which matched nothing and quietly skewed the merged downtime.
    let threw = false;
    try {
      probeDowntimeIntervals([corrupt], window, "UTC");
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  test("dayCoverage throws in UTC rather than returning a NaN total", () => {
    expect(() => dayCoverage([Number.NaN], undefined, "UTC")).toThrow(
      RangeError,
    );
    expect(() =>
      dayCoverage([Number.NaN], undefined, "America/Bogota"),
    ).toThrow(RangeError);
  });

  test("valid data is unaffected in both branches", () => {
    const good: StatusData = { ...corrupt, day: "2026-09-14T00:00:00.000Z" };
    const utc = probeDowntimeIntervals([good], window, "UTC");
    expect(utc.length).toBe(1);
    expect(Number.isNaN(utc[0].from)).toBe(false);

    const start = Date.parse("2026-09-14T05:00:00.000Z");
    const { totalMs } = dayCoverage([start], undefined, "America/Bogota");
    expect(totalMs).toBe(86_400_000);
  });
});
