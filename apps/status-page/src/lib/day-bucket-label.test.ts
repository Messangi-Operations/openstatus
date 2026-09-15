import { expect } from "@std/expect";
import { describe, test } from "@std/testing/bdd";

import { formatDate } from "./formatter";

/**
 * The uptime tracker's bars are labelled by `formatDayBucket`, which formats a
 * bucket's `day` value. That value is the INSTANT at which the bucket's day
 * begins in the status page's configured zone — not a date string, and not
 * necessarily UTC midnight.
 *
 * These pin the rule that makes the label correct: format the instant in the
 * same zone the bucket was cut in. Getting this wrong is silent — the bars
 * still render, they are just labelled with the wrong date, which is exactly
 * the bug the whole local-day effort set out to fix.
 */
const label = (iso: string, timeZone: string) =>
  formatDate(new Date(iso), { month: "short", locale: "en-US", timeZone });

describe("day bucket labels", () => {
  test("a UTC page is unchanged: UTC midnight reads as its own date", () => {
    expect(label("2026-09-14T00:00:00Z", "UTC")).toBe("Sep 14, 2026");
  });

  test("west of Greenwich: Bogota's Sep 14 starts at 05:00Z and reads Sep 14", () => {
    expect(label("2026-09-14T05:00:00Z", "America/Bogota")).toBe(
      "Sep 14, 2026",
    );
  });

  test("east of Greenwich: Tokyo's Sep 15 starts at 15:00Z on Sep 14", () => {
    // The direction that proves the zone is required rather than optional.
    // Formatted in UTC this instant reads "Sep 14" — off by a full day.
    expect(label("2026-09-14T15:00:00Z", "Asia/Tokyo")).toBe("Sep 15, 2026");
    expect(label("2026-09-14T15:00:00Z", "UTC")).toBe("Sep 14, 2026");
  });

  test("half-hour zone: Kolkata's Sep 15 starts at 18:30Z on Sep 14", () => {
    expect(label("2026-09-14T18:30:00Z", "Asia/Kolkata")).toBe("Sep 15, 2026");
  });

  test("a DST fall-back day is named once, not twice", () => {
    // New York's Nov 1 2026 starts 04:00Z and runs 25 hours; the NEXT bucket
    // starts 05:00Z on Nov 2. Both must name their own day.
    expect(label("2026-11-01T04:00:00Z", "America/New_York")).toBe(
      "Nov 1, 2026",
    );
    expect(label("2026-11-02T05:00:00Z", "America/New_York")).toBe(
      "Nov 2, 2026",
    );
  });
});
