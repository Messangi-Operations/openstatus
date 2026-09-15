import { expect } from "@std/expect";
import { describe, test } from "@std/testing/bdd";

import { fillStatusDataFor45Days } from "./events";
import { dayKeyIn } from "./local-day";

// The pre-change implementation, pinned verbatim as an independent oracle.
// If the zone-aware version ever diverges from this at tz="UTC", the change is
// not backwards compatible and every existing page is affected.
function legacyFill(
  data: Array<Record<string, unknown>>,
  monitorId: string,
  lookbackPeriod = 45,
) {
  const result = [];
  const dataByDay = new Map();
  data.forEach((item) => {
    const dayKey = new Date(item.day as string).toISOString().split("T")[0];
    dataByDay.set(dayKey, item);
  });
  const now = new Date();
  for (let i = 0; i < lookbackPeriod; i++) {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() - i);
    date.setUTCHours(0, 0, 0, 0);
    const dayKey = date.toISOString().split("T")[0];
    const isoString = date.toISOString();
    if (dataByDay.has(dayKey)) {
      result.push({ ...dataByDay.get(dayKey), day: isoString });
    } else {
      result.push({
        day: isoString,
        count: 0,
        ok: 0,
        degraded: 0,
        error: 0,
        monitorId,
      });
    }
  }
  return result.sort(
    (a, b) =>
      new Date(a.day as string).getTime() - new Date(b.day as string).getTime(),
  );
}

function sample() {
  // A few real-looking buckets, including one at a UTC midnight boundary.
  const now = new Date();
  const mk = (daysAgo: number, ok: number) => {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - daysAgo);
    d.setUTCHours(0, 0, 0, 0);
    return {
      day: d.toISOString(),
      count: ok + 1,
      ok,
      degraded: 0,
      error: 1,
      monitorId: "m1",
    };
  };
  return [mk(0, 10), mk(1, 20), mk(5, 30), mk(44, 40)];
}

describe("fillStatusDataFor45Days — backwards compatibility", () => {
  test("tz defaulted is byte-identical to the legacy implementation", () => {
    const data = sample();
    expect(JSON.stringify(fillStatusDataFor45Days(data, "m1"))).toBe(
      JSON.stringify(legacyFill(structuredClone(data), "m1")),
    );
  });

  test('tz="UTC" explicitly is byte-identical too', () => {
    const data = sample();
    expect(JSON.stringify(fillStatusDataFor45Days(data, "m1", 45, "UTC"))).toBe(
      JSON.stringify(legacyFill(structuredClone(data), "m1", 45)),
    );
  });
});

describe("fillStatusDataFor45Days — zoned grids", () => {
  test("produces 45 distinct consecutive local days in a western zone", () => {
    const out = fillStatusDataFor45Days([], "m1", 45, "America/Bogota");
    expect(out.length).toBe(45);
    const keys = out.map((b) => dayKeyIn(new Date(b.day), "America/Bogota"));
    expect(new Set(keys).size).toBe(45);
  });

  test("produces 45 distinct consecutive local days AHEAD of UTC", () => {
    // The direction the legacy keying got wrong: Tokyo midnight is the
    // previous UTC day, so legacy keys would collide or misfile.
    const out = fillStatusDataFor45Days([], "m1", 45, "Asia/Tokyo");
    const keys = out.map((b) => dayKeyIn(new Date(b.day), "Asia/Tokyo"));
    expect(new Set(keys).size).toBe(45);
  });

  test("bucket starts are local midnights, not UTC midnights", () => {
    const out = fillStatusDataFor45Days([], "m1", 3, "America/Bogota");
    for (const b of out) {
      // Bogota is UTC-5 year round, so every bucket starts at 05:00Z.
      expect(new Date(b.day).toISOString().slice(11, 19)).toBe("05:00:00");
    }
  });

  test("real data is matched to its local day, not dropped", () => {
    // 01:46Z is Sep 14 in Bogota — must land in the Bogota-14 bucket.
    const now = new Date();
    const start = new Date(now);
    start.setUTCHours(5, 0, 0, 0); // today's Bogota midnight, as the pipe emits
    const data = [
      {
        day: start.toISOString(),
        count: 7,
        ok: 6,
        degraded: 0,
        error: 1,
        monitorId: "m1",
      },
    ];
    const out = fillStatusDataFor45Days(data, "m1", 45, "America/Bogota");
    const matched = out.find((b) => b.count === 7);
    if (!matched) throw new Error("the day carrying the data was dropped");
    expect(dayKeyIn(new Date(matched.day), "America/Bogota")).toBe(
      dayKeyIn(start, "America/Bogota"),
    );
  });
});
