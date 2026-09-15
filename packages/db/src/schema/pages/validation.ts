import { locales } from "@openstatus/locales";
import type { ThemeKey } from "@openstatus/theme-store";
import {
  hasCustomTheme,
  sanitizeCustomTheme,
  THEME_KEYS,
  validateCustomTheme,
} from "@openstatus/theme-store";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

import { pageAccessTypes } from "./constants";
import { page } from "./page";

// Exported so `@openstatus/services` can reuse the canonical rules in
// its own `NewPageInput` / `UpdatePage*Input` schemas without
// duplicating the regex. Keep these as the single source of truth for
// slug and custom-domain shape validation.
export const slugSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9-]+$/,
    "Only use digits (0-9), hyphen (-) or characters (A-Z, a-z).",
  )
  .min(3)
  .toLowerCase();

export const customDomainSchema = z
  .string()
  .regex(
    /^(?!https?:\/\/|www.)([a-zA-Z0-9]+(.[a-zA-Z0-9]+)+.*)$/,
    "Should not start with http://, https:// or www.",
  )
  .or(z.enum([""]));

const stringToArray = z.preprocess((val) => {
  if (val && String(val).length > 0) {
    return String(val).split(",");
  }
  return [];
}, z.array(z.string()));

// Loose { light, dark } var maps — write paths enforce the supported var
// names / safe values; `.catch(null)` degrades corrupt stored json to "no
// overrides" instead of tanking every page read.
const themeVarsSchema = z.record(z.string(), z.string());
export const customThemeSchema = z.object({
  light: themeVarsSchema.optional(),
  dark: themeVarsSchema.optional(),
});

// Strict write-side counterpart: only supported var names and values that
// can't break out of the inline <style> tag the status page renders them
// into. Empty / nullish input clears the column.
export const customThemeWriteSchema = customThemeSchema
  .superRefine((value, ctx) => {
    const result = validateCustomTheme(value);
    if (!result.valid) {
      for (const message of result.errors) {
        ctx.addIssue({ code: "custom", message });
      }
    }
  })
  .nullish()
  .transform((v) => {
    if (v == null || !hasCustomTheme(v)) return null;
    return sanitizeCustomTheme(v);
  });

export const insertPageSchema = createInsertSchema(page, {
  title: z.string().trim().min(1, "Title must be at least 1 character long"),
  customDomain: customDomainSchema.prefault(""),
  accessType: z.enum(pageAccessTypes).prefault("public"),
  icon: z.string().optional(),
  slug: slugSchema,
})
  .extend({
    password: z.string().nullable().optional().prefault(""),
    monitors: z
      .array(
        z.object({
          // REMINDER: has to be different from `id` in as the prop is already used by react-hook-form
          monitorId: z.number(),
          order: z.number().prefault(0).optional(),
        }),
      )
      .optional()
      .prefault([]),
    authEmailDomains: z.array(z.string()).nullish(),
    allowedIpRanges: z
      .array(
        z
          .string()
          .transform((s) => {
            const trimmed = s.trim();
            return trimmed.includes("/") ? trimmed : `${trimmed}/32`;
          })
          .pipe(z.cidrv4()),
      )
      .nullish(),
    defaultLocale: z.enum(locales).optional().prefault("en"),
    locales: z.array(z.enum(locales)).nullable().optional(),
    customTheme: customThemeWriteSchema,
  })
  .refine(
    (data) => {
      if (data.locales && data.defaultLocale) {
        return data.locales.includes(data.defaultLocale);
      }
      return true;
    },
    {
      message: "Default locale must be included in the locales list",
      path: ["defaultLocale"],
    },
  );

// NOTE: every field uses `.nullish().transform(v => v ?? <default>)` so the
// OUTPUT is always a concrete enum value — never `null`/`undefined`. `.prefault`
// alone only handles `undefined`; without the transform a stored `null` (which
// the write path permits) leaks through and tanks downstream consumers that
// expect a strict enum (e.g. the status-page layout falling back to "absolute"
// barType and rendering manual-mode bars as empty).
/**
 * The set of zone names this runtime's ICU considers canonical. Deliberately
 * computed once: it is stable for the life of the process and the list is ~418
 * entries.
 *
 * NOTE `Intl.supportedValuesOf("timeZone")` does NOT contain "UTC" — verified,
 * not assumed. Treating membership in this set as the whole rule would reject
 * the default zone every page uses. "UTC" is therefore accepted explicitly
 * below; do not "simplify" that away.
 */
const CANONICAL_ZONES = new Set(Intl.supportedValuesOf("timeZone"));

/**
 * The canonical IANA name for `tz`, or null if it is not a zone we will accept.
 *
 * Canonicalizing is not cosmetic — it is the whole point. `Intl.DateTimeFormat`
 * accepts spellings that ClickHouse rejects outright, and the two systems sit on
 * opposite sides of this value: the zone is validated here in JS and then
 * interpolated into `toTimeZone(...)` in the Tinybird pipes. `america/bogota`,
 * `AMERICA/BOGOTA`, `utc` and `+05:00` all construct a working `DateTimeFormat`
 * and all fail ClickHouse with "Cannot load time zone". The status page then
 * degrades to manual mode with 45 empty bars and no visible error, and the gRPC
 * path — which has no such fallback — errors outright.
 *
 * So acceptance means: ICU can resolve it AND the resolved name is one ICU
 * itself calls canonical (or "UTC"). That maps `america/bogota` to
 * `America/Bogota` and `US/Eastern` to `America/New_York`, preserving intent,
 * while rejecting the offset forms (`+05:00`, `+0530`) and oddities like
 * `Factory` that no dropdown offers and ClickHouse would choke on.
 *
 * Mapping every UTC alias (`Etc/UTC`, `GMT`, `Zulu`, `Universal`) onto the
 * literal "UTC" also keeps them on the cheap path: the read layer short-circuits
 * on `tz === "UTC"` by string equality, so an un-canonicalized `Etc/UTC` would
 * have taken the expensive per-request raw scan for byte-identical output.
 *
 * Residual gap, accepted knowingly: ICU's canonical list and ClickHouse's
 * `system.time_zones` version independently, so a very new zone (e.g.
 * `America/Coyhaique`) can be canonical here and unknown there. This check
 * cannot close that without querying ClickHouse; it closes the spelling class,
 * which is the one a human actually hits.
 */
/**
 * CLDR-legacy → current IANA spellings, applied AFTER the canonical-set
 * membership check so every guarantee above still holds.
 *
 * Needed because ICU canonicalizes in the WRONG DIRECTION for renamed zones:
 * on this runtime `resolvedOptions()` maps `Asia/Kolkata` → `Asia/Calcutta`
 * and `Europe/Kyiv` → `Europe/Kiev`, so a user who typed the modern, correct
 * name would get the 1993 spelling stored and displayed back. Both spellings
 * of every pair here are verified to load in ClickHouse 26.8, and each
 * modern name is validated against THIS runtime's ICU at module init (a
 * runtime whose ICU predates a rename simply keeps the legacy spelling
 * rather than storing a name it cannot format with). On a runtime whose ICU
 * already resolves to the modern names, the map keys never match — a no-op.
 *
 * Deliberately only the human-visible city RENAMES. The Argentina hierarchy
 * (`America/Buenos_Aires` vs `America/Argentina/Buenos_Aires`) is left as
 * ICU resolves it: both spellings are equally recognizable and equally
 * valid, so rewriting them buys nothing.
 */
const MODERN_SPELLINGS: ReadonlyMap<string, string> = new Map(
  Object.entries({
    "Asia/Calcutta": "Asia/Kolkata",
    "Asia/Katmandu": "Asia/Kathmandu",
    "Asia/Rangoon": "Asia/Yangon",
    "Asia/Saigon": "Asia/Ho_Chi_Minh",
    "Europe/Kiev": "Europe/Kyiv",
    "Africa/Asmera": "Africa/Asmara",
    "America/Godthab": "America/Nuuk",
    "Atlantic/Faeroe": "Atlantic/Faroe",
    "Pacific/Truk": "Pacific/Chuuk",
    "Pacific/Ponape": "Pacific/Pohnpei",
    "Pacific/Enderbury": "Pacific/Kanton",
  }).filter(([, modern]) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: modern });
      return true;
    } catch {
      return false;
    }
  }),
);

export function canonicalTimeZone(tz: string): string | null {
  let resolved: string;
  try {
    resolved = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
    }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
  if (resolved === "UTC") return "UTC";
  if (!CANONICAL_ZONES.has(resolved)) return null;
  return MODERN_SPELLINGS.get(resolved) ?? resolved;
}

/** True when `tz` is a zone we accept — see `canonicalTimeZone`. */
export function isValidTimeZone(tz: string): boolean {
  return canonicalTimeZone(tz) !== null;
}

export const pageConfigurationSchema = z.object({
  value: z
    .enum(["duration", "requests", "manual"])
    .nullish()
    .transform((v) => v ?? "requests"),
  type: z
    .enum(["absolute", "manual"])
    .nullish()
    .transform((v) => v ?? "absolute"),
  uptime: z.coerce
    .boolean()
    .nullish()
    .transform((v) => v ?? true),
  theme: z
    .enum(THEME_KEYS as [ThemeKey, ...ThemeKey[]])
    .nullish()
    .transform((v) => v ?? "default"),
  // number of uptime bars rendered on the status page; only 30 or 45 supported
  days: z
    .union([z.literal(30), z.literal(45)])
    .nullish()
    .transform((v) => v ?? 45),
  /**
   * IANA zone used to render this page's timestamps and the timestamps in its
   * subscriber notification emails. Defaults to UTC, which is the historical
   * behaviour — a page that never sets this renders exactly as before.
   *
   * Per page rather than per viewer: one instance serves pages for different
   * markets, an email is rendered once server-side and cannot adapt to its
   * reader, and a fixed zone renders identically during SSR and hydration.
   *
   * `.refine` rejects an unknown zone so the settings form can surface the
   * error, but `.catch("UTC")` makes a bad value already in the column DEGRADE
   * rather than fail the parse — same shape as `customTheme` below.
   *
   * The transform canonicalizes rather than passing the stored string through.
   * Rows written before that rule existed may hold a spelling ICU accepts and
   * ClickHouse does not; canonicalizing on READ repairs those in place instead
   * of leaving them to empty the page.
   *
   * That `.catch` is load-bearing, not defensive dressing. `pageConfigurationSchema`
   * is parsed on the READ path, and a parse failure there is not a validation
   * message — it 404s the page: `proxy.ts` treats a failed `selectPageSchema` as
   * an unresolved host (taking down `/unsubscribe` and `/manage` with it), and
   * `statusPage.ts` returns null into a `notFound()`. Until a validated write
   * path exists, `timezone` is set by hand in SQL, so a typo like `America/Bogotá`
   * would take the public page down while the emails quietly fell back to UTC —
   * nothing would connect the outage to the typo.
   */
  timezone: z
    .string()
    .refine(isValidTimeZone, { message: "Unknown IANA time zone" })
    .nullish()
    .transform((v) => (v == null ? "UTC" : (canonicalTimeZone(v) ?? "UTC")))
    .catch("UTC"),
});
export type PageConfiguration = z.infer<typeof pageConfigurationSchema>;

export const selectPageSchema = createSelectSchema(page).extend({
  password: z.string().optional().nullable().prefault(""),
  customTheme: customThemeSchema.nullish().catch(null),
  configuration: pageConfigurationSchema.nullish().prefault({}),
  accessType: z.enum(pageAccessTypes).prefault("public"),
  authEmailDomains: stringToArray.prefault([]),
  allowedIpRanges: stringToArray.prefault([]),
  defaultLocale: z.enum(locales).prefault("en"),
  locales: z.array(z.enum(locales)).nullable().prefault(null),
});

export type InsertPage = z.infer<typeof insertPageSchema>;
export type Page = z.infer<typeof selectPageSchema>;
