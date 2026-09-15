import { expect } from "@std/expect";
import { describe, test } from "@std/testing/bdd";

import {
  type Event,
  getUptime,
  setDataByType,
  type StatusData,
  startOfDayIn,
} from "./statusPage.utils";

const HOUR = 60 * 60 * 1000;

function bucket(day: Date, over: Partial<StatusData> = {}): StatusData {
  return {
    day: day.toISOString(),
    count: 100,
    ok: 100,
    degraded: 0,
    error: 0,
    monitorId: "1",
    ...over,
  };
}

function incident(from: string, to: string): Event {
  return {
    id: 1,
    name: "outage",
    type: "incident",
    status: "error",
    from: new Date(from),
    to: new Date(to),
  } as Event;
}

/** A 10-day UTC grid ending on the given UTC day. */
function utcGrid(endIso: string, n = 10): StatusData[] {
  const end = new Date(endIso).getTime();
  return Array.from({ length: n }, (_, i) =>
    bucket(new Date(end - (n - 1 - i) * 24 * HOUR)),
  );
}

const MODES = [
  { barType: "absolute", cardType: "requests" },
  { barType: "absolute", cardType: "duration" },
  { barType: "dominant", cardType: "dominant" },
  { barType: "manual", cardType: "manual" },
] as const;

describe("setDataByType — omitting timeZone is identical to passing UTC", () => {
  const data = utcGrid("2026-09-14T00:00:00Z");
  const events = [
    incident("2026-09-10T02:00:00Z", "2026-09-10T06:00:00Z"),
    incident("2026-09-12T22:00:00Z", "2026-09-13T04:00:00Z"),
  ];

  for (const mode of MODES) {
    test(`${mode.barType}/${mode.cardType}`, () => {
      const omitted = setDataByType({ data, events, ...mode });
      const explicit = setDataByType({
        data,
        events,
        ...mode,
        timeZone: "UTC",
      });
      // JSON, not toEqual: this must hold for every field including the
      // computed bar heights, to the digit.
      expect(JSON.stringify(explicit)).toBe(JSON.stringify(omitted));
    });
  }
});

describe("getUptime — omitting timeZone is identical to passing UTC", () => {
  const data = utcGrid("2026-09-14T00:00:00Z").map((b, i) =>
    i === 3 ? { ...b, ok: 90, error: 10 } : b,
  );
  const events = [incident("2026-09-10T02:00:00Z", "2026-09-10T06:00:00Z")];

  for (const mode of MODES) {
    test(`${mode.barType}/${mode.cardType}`, () => {
      expect(getUptime({ data, events, ...mode, timeZone: "UTC" })).toBe(
        getUptime({ data, events, ...mode }),
      );
    });
  }
});

describe("setDataByType — the zone decides which bar an incident paints", () => {
  // 02:00-03:00Z on Sep 14 is 21:00-22:00 on Sep 13 in Bogota.
  const tz = "America/Bogota";
  const events = [incident("2026-09-14T02:00:00Z", "2026-09-14T03:00:00Z")];

  const bogotaGrid = Array.from({ length: 5 }, (_, i) =>
    bucket(startOfDayIn(new Date(`2026-09-1${i + 1}T12:00:00Z`), tz)),
  );

  test("the incident colours the Bogota day it happened on", () => {
    const out = setDataByType({
      data: bogotaGrid,
      events,
      barType: "dominant",
      cardType: "dominant",
      timeZone: tz,
    });
    const painted = out.filter((d) => d.bar[0].status === "error");
    expect(painted.length).toBe(1);
    // Sep 13 local, i.e. the bucket starting 2026-09-13T05:00:00Z
    expect(painted[0].day).toBe("2026-09-13T05:00:00.000Z");
  });

  test("the same grid read as UTC paints a different bar", () => {
    const out = setDataByType({
      data: bogotaGrid,
      events,
      barType: "dominant",
      cardType: "dominant",
    });
    const painted = out.filter((d) => d.bar[0].status === "error");
    expect(painted.length).toBe(1);
    expect(painted[0].day).toBe("2026-09-14T05:00:00.000Z");
  });
});

describe("duration proration uses the day's real length", () => {
  const tz = "America/New_York";
  // A 1-hour outage on the 25-hour fall-back day.
  const events = [incident("2026-11-01T12:00:00Z", "2026-11-01T13:00:00Z")];
  const nov1 = startOfDayIn(new Date("2026-11-01T12:00:00Z"), tz);

  test("the success remainder is 25h minus the outage, not 24h minus it", () => {
    const [day] = setDataByType({
      data: [bucket(nov1)],
      events,
      barType: "absolute",
      cardType: "duration",
      timeZone: tz,
    });
    const success = day.card.find((c) => c.status === "success");
    // 25h - 1h = 24h
    expect(success?.value).toBe("24h");
  });

  test("under UTC the same bucket prorates against 24h", () => {
    const [day] = setDataByType({
      data: [bucket(nov1)],
      events,
      barType: "absolute",
      cardType: "duration",
    });
    const success = day.card.find((c) => c.status === "success");
    expect(success?.value).toBe("23h");
  });
});
