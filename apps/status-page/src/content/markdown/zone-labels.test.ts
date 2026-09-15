import { expect } from "@std/expect";
import { describe, test } from "@std/testing/bdd";

import {
  eventLog,
  formatDay,
  formatDayTime,
  formatLogStamp,
  formatStamp,
} from "./helpers";

/**
 * The .md surface labels the same events the HTML page does, so its day/time
 * strings must be cut in the page's configured zone. The regression this
 * pins: a Bogota page whose HTML said "Sep 14" while the markdown said
 * "Sep 15" for the same instant — 02:00Z is the evening of the PREVIOUS
 * calendar day five hours west of Greenwich.
 */
describe("markdown labels in the page's zone", () => {
  // 2026-09-15T02:00:00Z = Sep 14 21:00 in Bogota, Sep 15 11:00 in Tokyo.
  const instant = new Date("2026-09-15T02:00:00Z");

  test("formatDay names the LOCAL calendar day", () => {
    expect(formatDay(instant)).toBe("Sep 15, 2026");
    expect(formatDay(instant, "UTC")).toBe("Sep 15, 2026");
    expect(formatDay(instant, "America/Bogota")).toBe("Sep 14, 2026");
    expect(formatDay(instant, "Asia/Tokyo")).toBe("Sep 15, 2026");
  });

  test("formatDayTime shifts both the day and the clock", () => {
    expect(formatDayTime(instant)).toBe("Sep 15, 2:00 AM");
    expect(formatDayTime(instant, "America/Bogota")).toBe("Sep 14, 9:00 PM");
    // Half-hour zone: the minutes shift too.
    expect(formatDayTime(instant, "Asia/Kolkata")).toBe("Sep 15, 7:30 AM");
    expect(formatDayTime(null, "America/Bogota")).toBe("—");
  });

  test("formatLogStamp stays sortable and fixed-width in any zone", () => {
    expect(formatLogStamp(instant)).toBe("2026-09-15 02:00");
    expect(formatLogStamp(instant, "America/Bogota")).toBe("2026-09-14 21:00");
  });

  test("formatStamp shows the real offset, not a hardcoded GMT+0", () => {
    expect(formatStamp(instant)).toBe("Sep 15, 2026 02:00 (GMT+0)");
    expect(formatStamp(instant, "America/Bogota")).toBe(
      "Sep 14, 2026 21:00 (GMT-5)",
    );
    // DST zones report the offset AT that instant: New York is EDT (-4) in
    // September and EST (-5) in January.
    expect(formatStamp(instant, "America/New_York")).toBe(
      "Sep 14, 2026 22:00 (GMT-4)",
    );
    expect(
      formatStamp(new Date("2026-01-15T02:00:00Z"), "America/New_York"),
    ).toBe("Jan 14, 2026 21:00 (GMT-5)");
  });

  test("UTC output is byte-identical to the historical arithmetic path", () => {
    // Unconfigured pages must not change at all — same strings, same widths.
    for (const iso of [
      "2026-01-01T00:00:00Z",
      "2026-06-18T14:50:00Z",
      "2026-12-31T23:59:00Z",
    ]) {
      const d = new Date(iso);
      expect(formatStamp(d, "UTC")).toBe(formatStamp(d));
      expect(formatDay(d, "UTC")).toBe(formatDay(d));
      expect(formatLogStamp(d, "UTC")).toBe(formatLogStamp(d));
    }
  });

  test("eventLog stamps rows in the page's zone", () => {
    const md = eventLog(
      [
        {
          timestamp: instant,
          label: "downtime",
          glyph: "x",
          ref: "r1",
          title: "outage",
        },
      ],
      "America/Bogota",
    );
    expect(md).toContain("2026-09-14 21:00");
    expect(md).not.toContain("2026-09-15");
  });
});
