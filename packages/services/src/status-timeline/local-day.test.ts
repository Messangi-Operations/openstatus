import { expect } from "@std/expect";
import { describe, test } from "@std/testing/bdd";

import {
  dayKeyIn,
  dayLengthMsIn,
  startOfDayBeforeIn,
  startOfDayIn,
} from "./local-day";

const HOUR = 60 * 60 * 1000;

describe("dayKeyIn", () => {
  test("uses the calendar date in the target zone, not UTC", () => {
    // 01:46Z is still the previous evening in Bogota — the exact case that
    // put a 'today' bar on tomorrow's date.
    const d = new Date("2026-09-15T01:46:00Z");
    expect(dayKeyIn(d, "UTC")).toBe("2026-09-15");
    expect(dayKeyIn(d, "America/Bogota")).toBe("2026-09-14");
  });

  test("handles zones AHEAD of UTC", () => {
    // The direction the old `toISOString().split("T")[0]` keying got wrong.
    const d = new Date("2026-09-14T16:00:00Z");
    expect(dayKeyIn(d, "UTC")).toBe("2026-09-14");
    expect(dayKeyIn(d, "Asia/Tokyo")).toBe("2026-09-15");
  });

  test("handles half-hour offsets", () => {
    const d = new Date("2026-09-14T19:00:00Z");
    expect(dayKeyIn(d, "Asia/Kolkata")).toBe("2026-09-15");
  });
});

describe("startOfDayIn", () => {
  test("UTC is unchanged from the old setUTCHours behaviour", () => {
    const d = new Date("2026-09-15T13:22:33Z");
    expect(startOfDayIn(d, "UTC").toISOString()).toBe(
      "2026-09-15T00:00:00.000Z",
    );
  });

  test("a Bogota day starts at 05:00Z", () => {
    const d = new Date("2026-09-15T01:46:00Z"); // Sep 14 local
    expect(startOfDayIn(d, "America/Bogota").toISOString()).toBe(
      "2026-09-14T05:00:00.000Z",
    );
  });

  test("a Tokyo day starts at 15:00Z the previous UTC day", () => {
    const d = new Date("2026-09-14T16:00:00Z"); // Sep 15 local
    expect(startOfDayIn(d, "Asia/Tokyo").toISOString()).toBe(
      "2026-09-14T15:00:00.000Z",
    );
  });

  test("is idempotent", () => {
    const d = new Date("2026-09-15T01:46:00Z");
    const once = startOfDayIn(d, "America/Bogota");
    expect(startOfDayIn(once, "America/Bogota").toISOString()).toBe(
      once.toISOString(),
    );
  });

  test("lands on the right day across a DST fall-back", () => {
    // America/New_York ends DST 2026-11-01; that local day is 25 hours.
    const during = new Date("2026-11-01T12:00:00Z");
    const start = startOfDayIn(during, "America/New_York");
    expect(dayKeyIn(start, "America/New_York")).toBe("2026-11-01");
    expect(start.toISOString()).toBe("2026-11-01T04:00:00.000Z");
  });

  test("lands on the right day across a DST spring-forward", () => {
    // America/Santiago springs forward 2026-09-06 (no 00:00 local hour).
    const during = new Date("2026-09-06T12:00:00Z");
    const start = startOfDayIn(during, "America/Santiago");
    expect(dayKeyIn(start, "America/Santiago")).toBe("2026-09-06");
  });
});

describe("startOfDayBeforeIn", () => {
  test("walks back whole calendar days", () => {
    const d = new Date("2026-09-15T01:46:00Z"); // Sep 14 in Bogota
    expect(
      dayKeyIn(startOfDayBeforeIn(d, "America/Bogota", 0), "America/Bogota"),
    ).toBe("2026-09-14");
    expect(
      dayKeyIn(startOfDayBeforeIn(d, "America/Bogota", 1), "America/Bogota"),
    ).toBe("2026-09-13");
    expect(
      dayKeyIn(startOfDayBeforeIn(d, "America/Bogota", 45), "America/Bogota"),
    ).toBe("2026-07-31");
  });

  test("does not drift across a DST boundary", () => {
    // Stepping back over 2026-11-01 in New York must still land on calendar
    // days, which fixed-86_400_000ms arithmetic would not.
    const d = new Date("2026-11-05T12:00:00Z");
    const keys = [0, 1, 2, 3, 4, 5, 6].map((n) =>
      dayKeyIn(
        startOfDayBeforeIn(d, "America/New_York", n),
        "America/New_York",
      ),
    );
    expect(keys).toEqual([
      "2026-11-05",
      "2026-11-04",
      "2026-11-03",
      "2026-11-02",
      "2026-11-01",
      "2026-10-31",
      "2026-10-30",
    ]);
  });

  test("produces 45 distinct consecutive days", () => {
    const d = new Date("2026-09-15T01:46:00Z");
    const keys = Array.from({ length: 45 }, (_, n) =>
      dayKeyIn(startOfDayBeforeIn(d, "America/Bogota", n), "America/Bogota"),
    );
    expect(new Set(keys).size).toBe(45);
  });
});

describe("dayLengthMsIn", () => {
  test("a normal day is 24 hours", () => {
    expect(
      dayLengthMsIn(new Date("2026-09-15T12:00:00Z"), "America/Bogota"),
    ).toBe(24 * HOUR);
  });

  test("a fall-back day is 25 hours", () => {
    expect(
      dayLengthMsIn(new Date("2026-11-01T12:00:00Z"), "America/New_York"),
    ).toBe(25 * HOUR);
  });

  test("a spring-forward day is 23 hours", () => {
    expect(
      dayLengthMsIn(new Date("2026-03-08T12:00:00Z"), "America/New_York"),
    ).toBe(23 * HOUR);
  });
});

describe("repeated local midnight — fall-back AT 00:00 (Havana/Azores class)", () => {
  // These two zones turn their clocks back 01:00 -> 00:00, so local midnight
  // happens TWICE on the fall-back day. The existing DST tests use
  // America/New_York, which transitions at 02:00 and can never catch this:
  // there, midnight happens once and the repeated hour sits safely inside the
  // day. Here the repeated hour IS the first hour of the day, and the day
  // must start at its FIRST midnight or that hour is misfiled into the
  // previous day (and the 25h day measured as 24h).

  test("Havana 2025-11-02 starts at the FIRST midnight (04:00Z, CDT)", () => {
    const during = new Date("2025-11-02T12:00:00Z");
    expect(startOfDayIn(during, "America/Havana").toISOString()).toBe(
      "2025-11-02T04:00:00.000Z",
    );
    // ...and it is a true boundary: 1ms earlier is Nov 1.
    expect(dayKeyIn(new Date("2025-11-02T03:59:59.999Z"), "America/Havana")).toBe(
      "2025-11-01",
    );
  });

  test("an instant inside the repeated hour maps to the same start", () => {
    // 04:30Z = 00:30 CDT, first pass through the repeated hour.
    const inRepeated = new Date("2025-11-02T04:30:00Z");
    expect(startOfDayIn(inRepeated, "America/Havana").toISOString()).toBe(
      "2025-11-02T04:00:00.000Z",
    );
    // 05:30Z = 00:30 CST, second pass — same day, same start.
    const inSecondPass = new Date("2025-11-02T05:30:00Z");
    expect(startOfDayIn(inSecondPass, "America/Havana").toISOString()).toBe(
      "2025-11-02T04:00:00.000Z",
    );
  });

  test("the Havana fall-back day is 25 hours and its neighbours are 24", () => {
    expect(
      dayLengthMsIn(new Date("2025-11-02T12:00:00Z"), "America/Havana"),
    ).toBe(25 * HOUR);
    expect(
      dayLengthMsIn(new Date("2025-11-01T12:00:00Z"), "America/Havana"),
    ).toBe(24 * HOUR);
    expect(
      dayLengthMsIn(new Date("2025-11-03T12:00:00Z"), "America/Havana"),
    ).toBe(24 * HOUR);
  });

  test("Azores 2026-10-25 starts at the FIRST midnight (00:00Z)", () => {
    const during = new Date("2026-10-25T12:00:00Z");
    expect(startOfDayIn(during, "Atlantic/Azores").toISOString()).toBe(
      "2026-10-25T00:00:00.000Z",
    );
    expect(
      dayLengthMsIn(new Date("2026-10-25T12:00:00Z"), "Atlantic/Azores"),
    ).toBe(25 * HOUR);
  });

  test("consecutive Havana days still tile with no gap or overlap", () => {
    const nov1 = startOfDayIn(new Date("2025-11-01T12:00:00Z"), "America/Havana");
    const nov2 = startOfDayIn(new Date("2025-11-02T12:00:00Z"), "America/Havana");
    const nov3 = startOfDayIn(new Date("2025-11-03T12:00:00Z"), "America/Havana");
    expect(nov1.getTime() + 24 * HOUR).toBe(nov2.getTime());
    expect(nov2.getTime() + 25 * HOUR).toBe(nov3.getTime());
  });

  test("New_York-style 02:00 fall-back is untouched by the backtrack", () => {
    expect(
      startOfDayIn(new Date("2026-11-01T12:00:00Z"), "America/New_York")
        .toISOString(),
    ).toBe("2026-11-01T04:00:00.000Z");
  });
});

describe("invalid Date input", () => {
  // Uniform, deliberate behaviour: every entry point throws. The old UTC path
  // silently produced NaN windows that matched nothing; the Intl path threw
  // only on the non-UTC branch. See assertValidDate in local-day.ts.
  const bad = new Date(Number.NaN);

  test("all four entry points throw RangeError, for UTC and zoned alike", () => {
    for (const tz of ["UTC", "America/Bogota"]) {
      expect(() => dayKeyIn(bad, tz)).toThrow(RangeError);
      expect(() => startOfDayIn(bad, tz)).toThrow(RangeError);
      expect(() => startOfDayBeforeIn(bad, tz, 1)).toThrow(RangeError);
      expect(() => dayLengthMsIn(bad, tz)).toThrow(RangeError);
    }
  });
});

describe("zero-offset zones parse the bare 'GMT' longOffset form", () => {
  test("London in winter (GMT, no offset digits) resolves midnight correctly", () => {
    expect(
      startOfDayIn(new Date("2026-01-15T13:00:00Z"), "Europe/London")
        .toISOString(),
    ).toBe("2026-01-15T00:00:00.000Z");
  });
});
