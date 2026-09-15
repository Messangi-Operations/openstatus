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
 * The markdown formatters have two implementations of every function — a UTC
 * arithmetic path and a zoned `Intl.formatToParts` path — and they used to
 * disagree about invalid input: the UTC one rendered "undefined NaN, NaN", the
 * zoned one threw `RangeError`. That asymmetry meant one corrupt report date
 * would 500 the whole public `.md` route on a zoned page while a UTC page
 * served nonsense.
 *
 * The contract is now: identical, defined output in both branches, never a
 * throw. These pin it for every formatter.
 */
const BAD: Array<Date | string | number> = [
  "garbage",
  new Date("nope"),
  Number.NaN,
  "2026-13-45T99:99:99Z",
];

describe("invalid dates never throw and never diverge by zone", () => {
  for (const tz of ["UTC", "America/Bogota", "Asia/Tokyo"]) {
    test(`formatDay / formatStamp / formatDayTime in ${tz}`, () => {
      for (const bad of BAD) {
        expect(formatDay(bad, tz)).toBe("—");
        expect(formatStamp(bad, tz)).toBe("—");
        expect(formatDayTime(bad, tz)).toBe("—");
      }
    });

    test(`formatLogStamp keeps its column width in ${tz}`, () => {
      // 16 chars, matching "2026-06-18 14:50", or the event log's columns skew.
      for (const bad of BAD) {
        const out = formatLogStamp(bad, tz);
        expect(out).toBe("????-??-?? ??:??");
        expect(out.length).toBe("2026-06-18 14:50".length);
      }
    });
  }

  test("a corrupt row does not take down the whole event log", () => {
    const out = eventLog(
      [
        {
          timestamp: "2026-06-18T14:50:00Z",
          label: "resolved",
          glyph: "✓",
          ref: "r-1",
          title: "fine",
        },
        {
          timestamp: "garbage",
          label: "investigating",
          glyph: "!",
          ref: "r-2",
          title: "corrupt",
        },
      ],
      "America/Bogota",
    );
    expect(out).toContain("????-??-?? ??:??");
    expect(out).toContain("fine");
    expect(out).toContain("corrupt");
  });

  test("valid input is untouched by the guards", () => {
    const d = "2026-06-18T14:50:00Z";
    expect(formatDay(d)).toBe("Jun 18, 2026");
    expect(formatLogStamp(d)).toBe("2026-06-18 14:50");
    expect(formatDay(d, "America/Bogota")).toBe("Jun 18, 2026");
    expect(formatLogStamp(d, "America/Bogota")).toBe("2026-06-18 09:50");
  });
});
