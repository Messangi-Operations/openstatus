import {
  canonicalTimeZone,
  isValidTimeZone,
  pageConfigurationSchema,
} from "@openstatus/db/src/schema";
import { expect } from "@std/expect";
import { describe, test } from "@std/testing/bdd";

/**
 * The zone stored here is interpolated into ClickHouse's `toTimeZone(...)` on
 * every status-page read. ICU and ClickHouse disagree about what a zone name
 * is, and ICU is the more permissive of the two — so anything ICU accepts and
 * ClickHouse rejects reaches the query and empties the page.
 *
 * These pin the acceptance rule on the JS side of that seam. The ClickHouse
 * side was verified separately against a real 26.8 server.
 */

describe("canonicalTimeZone", () => {
  test("rejects the spellings ClickHouse cannot load", () => {
    // Every one of these constructs a working Intl.DateTimeFormat, which is why
    // the previous try/catch check let them all through.
    for (const bad of ["+05:00", "-08:00", "+0530", "+05", "Factory"]) {
      expect(canonicalTimeZone(bad)).toBe(null);
      expect(isValidTimeZone(bad)).toBe(false);
    }
  });

  test("repairs case spellings instead of rejecting them", () => {
    // The likely human typo. Rejecting would be safe; repairing preserves intent.
    expect(canonicalTimeZone("america/bogota")).toBe("America/Bogota");
    expect(canonicalTimeZone("AMERICA/BOGOTA")).toBe("America/Bogota");
    expect(canonicalTimeZone("aSiA/tOkYo")).toBe("Asia/Tokyo");
  });

  test("resolves legacy aliases to their modern names", () => {
    expect(canonicalTimeZone("US/Eastern")).toBe("America/New_York");
    expect(canonicalTimeZone("Navajo")).toBe("America/Denver");
  });

  test('every UTC alias collapses onto the literal "UTC"', () => {
    // Load-bearing beyond correctness: the read layer short-circuits on
    // `tz === "UTC"` by string equality, so an un-canonicalized "Etc/UTC"
    // would take the expensive per-request raw scan for identical output.
    for (const alias of ["UTC", "utc", "Etc/UTC", "GMT", "Zulu", "Universal"]) {
      expect(canonicalTimeZone(alias)).toBe("UTC");
    }
  });

  test('"UTC" is accepted even though supportedValuesOf omits it', () => {
    // The trap in the obvious implementation of this check: a bare membership
    // test against Intl.supportedValuesOf("timeZone") rejects the default zone
    // every page uses.
    expect(Intl.supportedValuesOf("timeZone").includes("UTC")).toBe(false);
    expect(isValidTimeZone("UTC")).toBe(true);
  });

  test("rejects outright nonsense", () => {
    for (const bad of ["Not/AZone", "", "localtime", "America/Bogotá"]) {
      expect(canonicalTimeZone(bad)).toBe(null);
    }
  });

  test("every canonical zone reaches a stable accepted spelling in one step", () => {
    // Guarantees a stored value always re-validates on read. The invariant is
    // a FIXED POINT, not identity: the modern-spelling repair deliberately
    // maps CLDR-legacy members of the set (Asia/Calcutta) forward to the
    // current IANA name (Asia/Kolkata) — but whatever comes out must be
    // accepted and unchanged by a second pass, or a stored row would flap.
    const zones = Intl.supportedValuesOf("timeZone");
    const broken = zones.filter((z) => {
      const once = canonicalTimeZone(z);
      return once === null || canonicalTimeZone(once) !== once;
    });
    expect(broken).toEqual([]);
  });
});

describe("pageConfigurationSchema.timezone", () => {
  const tz = (input: unknown) =>
    pageConfigurationSchema.parse({ timezone: input }).timezone;

  test("canonicalizes on READ, repairing rows written before the rule existed", () => {
    expect(tz("america/bogota")).toBe("America/Bogota");
    expect(tz("Etc/UTC")).toBe("UTC");
  });

  test("degrades an unusable stored value to UTC rather than failing the parse", () => {
    // A parse failure here does not surface as a validation message — it 404s
    // the public page. Degrading is the whole reason `.catch("UTC")` exists.
    expect(tz("+05:00")).toBe("UTC");
    expect(tz("Not/AZone")).toBe("UTC");
    expect(tz(null)).toBe("UTC");
    expect(tz(undefined)).toBe("UTC");
  });

  test("passes a good zone through untouched", () => {
    expect(tz("America/Bogota")).toBe("America/Bogota");
    expect(tz("Asia/Tokyo")).toBe("Asia/Tokyo");
  });
});

describe("modern spellings are preserved, not regressed to CLDR-legacy names", () => {
  // ICU canonicalizes the WRONG WAY for renamed zones: resolvedOptions() maps
  // Asia/Kolkata → Asia/Calcutta. Without the repair table a user who typed
  // the current IANA name got the 1993 one stored and displayed back.
  test("typing the modern name keeps the modern name", () => {
    expect(canonicalTimeZone("Asia/Kolkata")).toBe("Asia/Kolkata");
    expect(canonicalTimeZone("Europe/Kyiv")).toBe("Europe/Kyiv");
    expect(canonicalTimeZone("America/Nuuk")).toBe("America/Nuuk");
  });

  test("typing the legacy alias is repaired forward to the modern name", () => {
    expect(canonicalTimeZone("Asia/Calcutta")).toBe("Asia/Kolkata");
    expect(canonicalTimeZone("Europe/Kiev")).toBe("Europe/Kyiv");
    expect(canonicalTimeZone("asia/calcutta")).toBe("Asia/Kolkata");
  });

  test("the repair is idempotent — a stored modern name round-trips", () => {
    for (const tz of ["Asia/Kolkata", "Europe/Kyiv", "Africa/Asmara"]) {
      const once = canonicalTimeZone(tz);
      expect(once).not.toBeNull();
      expect(canonicalTimeZone(once as string)).toBe(once);
    }
  });

  test("UTC handling and rejections are untouched", () => {
    expect(canonicalTimeZone("Etc/UTC")).toBe("UTC");
    expect(canonicalTimeZone("+05:00")).toBeNull();
    // Etc/GMT+5 is real IANA and ClickHouse-valid, but stays rejected on
    // purpose: no picker offers it, and accepting a second spelling family
    // for fixed offsets widens the surface for nothing.
    expect(canonicalTimeZone("Etc/GMT+5")).toBeNull();
  });
});
