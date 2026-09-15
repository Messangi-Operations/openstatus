import { expect } from "@std/expect";
import { describe, test } from "@std/testing/bdd";

import { dayKeyIn, startOfDayBeforeIn, startOfDayForKeyIn } from "./local-day";

/**
 * Day buckets are persisted and passed around as date STRINGS — frozen uptime
 * rows store `"YYYY-MM-DD"`, and the history query rebuilds instants from them
 * to measure coverage. Turning a date string back into an instant is where the
 * zone quietly gets dropped: `Date.parse(`${key}T00:00:00Z`)` is that date's
 * UTC midnight, which is a different moment from its local midnight everywhere
 * except UTC.
 */
describe("startOfDayForKeyIn", () => {
  test("UTC is exactly the naive parse", () => {
    for (const key of ["2026-01-01", "2026-09-14", "2026-12-31"]) {
      expect(startOfDayForKeyIn(key, "UTC").toISOString()).toBe(
        `${key}T00:00:00.000Z`,
      );
    }
  });

  test("west of Greenwich the day starts later than UTC midnight", () => {
    expect(
      startOfDayForKeyIn("2026-09-14", "America/Bogota").toISOString(),
    ).toBe("2026-09-14T05:00:00.000Z");
  });

  test("east of Greenwich the day starts on the PREVIOUS UTC date", () => {
    // The case the naive parse gets outright wrong: it would return
    // 2026-09-15T00:00:00Z, which is already 09:00 on Sep 15 in Tokyo.
    expect(startOfDayForKeyIn("2026-09-15", "Asia/Tokyo").toISOString()).toBe(
      "2026-09-14T15:00:00.000Z",
    );
  });

  test("handles the extreme eastern and western zones", () => {
    // Kiritimati is UTC+14 — a full day ahead of UTC midnight.
    expect(
      dayKeyIn(
        startOfDayForKeyIn("2026-09-15", "Pacific/Kiritimati"),
        "Pacific/Kiritimati",
      ),
    ).toBe("2026-09-15");
    expect(
      dayKeyIn(
        startOfDayForKeyIn("2026-09-15", "Pacific/Midway"),
        "Pacific/Midway",
      ),
    ).toBe("2026-09-15");
  });

  test("round-trips with dayKeyIn across every zone and a year of dates", () => {
    // The property that actually matters, checked rather than reasoned about.
    const zones = Intl.supportedValuesOf("timeZone");
    const anchor = new Date("2026-09-15T12:00:00Z");
    const broken: string[] = [];
    for (const tz of zones) {
      for (let n = 0; n < 370; n += 37) {
        const key = dayKeyIn(startOfDayBeforeIn(anchor, tz, n), tz);
        if (dayKeyIn(startOfDayForKeyIn(key, tz), tz) !== key) {
          broken.push(`${tz} ${key}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  test("survives DST transitions in both directions", () => {
    for (const key of ["2026-03-08", "2026-11-01"]) {
      const start = startOfDayForKeyIn(key, "America/New_York");
      expect(dayKeyIn(start, "America/New_York")).toBe(key);
    }
    // Havana falls back AT midnight — the case that broke startOfDayIn.
    const havana = startOfDayForKeyIn("2025-11-02", "America/Havana");
    expect(dayKeyIn(havana, "America/Havana")).toBe("2025-11-02");
  });

  test("rejects a malformed key rather than returning an invalid instant", () => {
    expect(() => startOfDayForKeyIn("not-a-day", "UTC")).toThrow(RangeError);
  });
});
