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

  test("every canonical zone round-trips unchanged", () => {
    // Guarantees a stored canonical value always re-validates on read.
    const zones = Intl.supportedValuesOf("timeZone");
    const broken = zones.filter((z) => canonicalTimeZone(z) !== z);
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
