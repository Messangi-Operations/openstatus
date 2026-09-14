import { expect } from "@std/expect";
import { describe, test } from "@std/testing/bdd";

import { formatNotificationDate, isUsableTimeZone } from "./client";

// 2026-09-14T16:29:45Z — 11:29 in Bogota, 10:29 in Mexico City.
const ISO = "2026-09-14T16:29:45.000Z";

describe("isUsableTimeZone", () => {
  test("accepts real IANA zones", () => {
    for (const tz of [
      "UTC",
      "America/Bogota",
      "America/Mexico_City",
      "Europe/Madrid",
    ]) {
      expect(isUsableTimeZone(tz)).toBe(true);
    }
  });

  test("rejects typos, non-zones and empty values", () => {
    // "America/Bogotá" is the realistic typo: correct Spanish, invalid IANA.
    for (const tz of ["America/Bogotá", "Mars/Olympus", "", undefined]) {
      expect(isUsableTimeZone(tz)).toBe(false);
    }
  });
});

describe("formatNotificationDate", () => {
  test("renders in the page's zone, labelled so the reader knows the clock", () => {
    expect(formatNotificationDate(ISO, "America/Bogota")).toBe(
      "Sep 14, 2026, 11:29 AM GMT-5",
    );
  });

  test("a second market renders its own clock from the same instant", () => {
    expect(formatNotificationDate(ISO, "America/Mexico_City")).toBe(
      "Sep 14, 2026, 10:29 AM CST",
    );
  });

  test("defaults to UTC when no zone is configured", () => {
    expect(formatNotificationDate(ISO)).toBe("Sep 14, 2026, 04:29 PM UTC");
    expect(formatNotificationDate(ISO, "UTC")).toBe(
      "Sep 14, 2026, 04:29 PM UTC",
    );
  });

  // Maintenance dispatch sends "<fromISO> - <toISO>" through this same path.
  // Parsing that as a single date renders "Invalid Date" on every maintenance
  // email. This range also crosses midnight once shifted into Bogota.
  test("formats both sides of a maintenance range", () => {
    const out = formatNotificationDate(
      "2026-09-20T02:00:00.000Z - 2026-09-20T06:00:00.000Z",
      "America/Bogota",
    );
    expect(out).toBe(
      "Sep 19, 2026, 09:00 PM GMT-5 - Sep 20, 2026, 01:00 AM GMT-5",
    );
    expect(out.includes("Invalid Date")).toBe(false);
  });

  // An unusable zone must degrade to UTC *formatting*. Falling back to the raw
  // ISO string would reintroduce exactly the problem this function removes.
  test("degrades an unusable zone to UTC formatting, not to a raw ISO string", () => {
    const out = formatNotificationDate(ISO, "America/Bogotá");
    expect(out).toBe("Sep 14, 2026, 04:29 PM UTC");
    expect(out).not.toBe(ISO);
  });

  test("passes unparseable input through untouched", () => {
    expect(formatNotificationDate("not a date", "America/Bogota")).toBe(
      "not a date",
    );
    expect(formatNotificationDate("", "America/Bogota")).toBe("");
  });

  // Regression guard: dateStyle/timeStyle combined with timeZoneName throws
  // "Invalid option" in Intl. That threw silently once and every timestamp came
  // out unformatted, so assert the output is never the input echoed back.
  test("output is formatted, never the input echoed back", () => {
    expect(formatNotificationDate(ISO, "America/Bogota")).not.toBe(ISO);
  });
});
