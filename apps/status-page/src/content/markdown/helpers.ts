import { isoOrNull } from "../status-vocab";

export type ComponentStatus = "success" | "degraded" | "error" | "info";

export type ReportStatus =
  | "investigating"
  | "identified"
  | "monitoring"
  | "resolved"
  | "maintenance";

const COMPONENT_STATUS_LABELS: Record<ComponentStatus, string> = {
  success: "Operational",
  degraded: "Degraded",
  error: "Outage",
  info: "Maintenance",
};

const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  investigating: "Investigating",
  identified: "Identified",
  monitoring: "Monitoring",
  resolved: "Resolved",
  maintenance: "Maintenance",
};

export function statusLabel(status: string): string {
  if (status in COMPONENT_STATUS_LABELS) {
    return COMPONENT_STATUS_LABELS[status as ComponentStatus];
  }
  if (status in REPORT_STATUS_LABELS) {
    return REPORT_STATUS_LABELS[status as ReportStatus];
  }
  return status;
}

/** Quote a value as a double-quoted YAML scalar. Every C0 control char must be
 * escaped — a literal newline/tab splits or corrupts the scalar and parsers
 * disagree on the result. */
function escapeYaml(value: string): string {
  let out = '"';
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (ch === "\\") out += "\\\\";
    else if (ch === '"') out += '\\"';
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (code < 0x20) out += `\\x${code.toString(16).padStart(2, "0")}`;
    else out += ch;
  }
  return `${out}"`;
}

/**
 * Live page state carried in frontmatter so an agent gets the answer from the
 * top ~10 lines without tokenizing the body. `fetched_at` is the snapshot's
 * generation time (truthful freshness signal); HTTP ETag/Cache-Control carry
 * the rest.
 */
export interface FrontmatterLive {
  status: string;
  fetchedAt: Date | string | number | null | undefined;
  activeReports: number;
  activeMaintenance: number;
  componentsOperational: number;
  componentsTotal: number;
  worstComponent?: string | null;
}

export function frontmatter(fields: {
  title: string;
  description: string;
  baseUrl: string;
  canonical: string;
  homepageUrl?: string | null;
  contactUrl?: string | null;
  live?: FrontmatterLive;
}): string {
  const lines = [
    "---",
    `title: ${escapeYaml(fields.title)}`,
    `description: ${escapeYaml(fields.description)}`,
    // Origin the root-relative in-body links resolve against.
    `base_url: ${escapeYaml(fields.baseUrl)}`,
    `canonical: ${escapeYaml(fields.canonical)}`,
  ];
  if (fields.homepageUrl)
    lines.push(`homepage_url: ${escapeYaml(fields.homepageUrl)}`);
  if (fields.contactUrl)
    lines.push(`contact_url: ${escapeYaml(fields.contactUrl)}`);
  if (fields.live) {
    const fetched = isoOrNull(fields.live.fetchedAt);
    lines.push(`status: ${escapeYaml(fields.live.status)}`);
    if (fetched) lines.push(`fetched_at: ${escapeYaml(fetched)}`);
    lines.push(`active_reports: ${fields.live.activeReports}`);
    lines.push(`active_maintenance: ${fields.live.activeMaintenance}`);
    lines.push(`components_operational: ${fields.live.componentsOperational}`);
    lines.push(`components_total: ${fields.live.componentsTotal}`);
    if (fields.live.worstComponent)
      lines.push(`worst_component: ${escapeYaml(fields.live.worstComponent)}`);
  }
  lines.push("---");
  return `${lines.join("\n")}\n`;
}

/** Escape a markdown table cell — pipes and newlines would break the row. */
export function escapeCell(value: string): string {
  // Escape backslash first so the pipe-escaping we add isn't re-escaped.
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

/** Escape a value used as a markdown link label — `[`/`]` would break `[text](url)`. */
export function escapeLinkLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/[[\]]/g, "\\$&");
}

export function table(headers: string[], rows: string[][]): string {
  const head = `| ${headers.map((cell) => escapeCell(cell)).join(" | ")} |`;
  const divider = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows
    .map((row) => `| ${row.map((cell) => escapeCell(cell)).join(" | ")} |`)
    .join("\n");
  return body ? `${head}\n${divider}\n${body}` : `${head}\n${divider}`;
}

export function formatDate(
  date: Date | string | number | null | undefined,
): string {
  if (date === null || date === undefined) return "—";
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString();
}

export function formatMs(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${Math.round(value)}ms`;
}

export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(3)}%`;
}

/** Build the public-facing canonical (HTML) URL for a path under a page. */
export function canonicalUrl(baseUrl: string, path = ""): string {
  return path ? `${baseUrl}/${path.replace(/^\//, "")}` : baseUrl;
}

/**
 * Root-relative `.md` link for a path under a page (root → `/.md`). Relative on
 * purpose: the frontmatter `canonical` carries the absolute base, so in-body
 * links need not repeat the host.
 */
export function mdUrl(path = ""): string {
  const clean = path.replace(/^\//, "");
  return clean ? `/${clean}.md` : "/.md";
}

/**
 * A breadcrumb / peer-nav line. Items with a `url` render as links; the current
 * item (no `url`) renders as plain text. Use ` › ` for hierarchy, ` · ` for peers.
 */
export function navLine(
  items: { label: string; url?: string }[],
  separator = " › ",
): string {
  return items
    .map((i) =>
      i.url
        ? `[${escapeLinkLabel(i.label)}](${i.url})`
        : escapeLinkLabel(i.label),
    )
    .join(separator);
}

export type DayStatus = "success" | "degraded" | "error" | "info" | "empty";

// ASCII status markers: 1 column, monospace-stable, markdown-inert. Markdown has
// no color, so shape carries the meaning — `x` reads as down/outage.
const STATUS_GLYPH: Record<DayStatus, string> = {
  success: "+",
  degraded: "~",
  error: "x",
  info: "=",
  empty: ".",
};

const DAY_PRIORITY: Record<DayStatus, number> = {
  error: 3,
  degraded: 2,
  info: 1,
  success: 0,
  empty: -1,
};

export function statusGlyph(status: string): string {
  return STATUS_GLYPH[status as DayStatus] ?? STATUS_GLYPH.empty;
}

const LEGEND_LABELS: Record<DayStatus, string> = {
  success: "Operational",
  degraded: "Degraded",
  error: "Outage",
  info: "Maintenance",
  empty: "No data",
};

const LEGEND_ORDER: DayStatus[] = [
  "success",
  "degraded",
  "error",
  "info",
  "empty",
];

/** Legend line covering every status, in severity order. */
export function legend(): string {
  // Glyphs in code spans so they render in the same monospace as the bar they
  // explain — a bare `.` / `~` is otherwise easy to miss or misread.
  const parts = LEGEND_ORDER.map(
    (s) => `\`${STATUS_GLYPH[s]}\` ${LEGEND_LABELS[s]}`,
  );
  return `Legend: ${parts.join(" · ")}`;
}

// Severity order mirrors `pageComponentImpact` in @openstatus/db; kept local so
// the generators stay types-only against the API and don't value-import the schema.
const IMPACT_ORDER = [
  "operational",
  "degraded_performance",
  "partial_outage",
  "major_outage",
];

const IMPACT_LABELS: Record<string, string> = {
  operational: "operational",
  degraded_performance: "degraded performance",
  partial_outage: "partial outage",
  major_outage: "major outage",
};

export function impactLabel(impact: string): string {
  return IMPACT_LABELS[impact] ?? impact;
}

/** "name (impact label)", dropping the impact when operational/absent. */
export function componentImpact(name: string, impact?: string | null): string {
  return impact && impact !== "operational"
    ? `${name} (${impactLabel(impact)})`
    : name;
}

/**
 * Like `componentImpact` but always shows the impact label, even operational —
 * for a single update's affects line, where every component has a declared
 * impact and dropping operational would read as inconsistent against siblings.
 */
export function componentImpactExplicit(
  name: string,
  impact?: string | null,
): string {
  return impact ? `${name} (${impactLabel(impact)})` : name;
}

/** Most severe impact among the given values, or null if empty. */
export function worstImpact(impacts: string[]): string | null {
  let worst: string | null = null;
  for (const i of impacts) {
    if (
      worst === null ||
      IMPACT_ORDER.indexOf(i) > IMPACT_ORDER.indexOf(worst)
    ) {
      worst = i;
    }
  }
  return worst;
}

/** Status glyph for a report/update lifecycle status (resolved → `+`, etc.). */
export function reportStatusGlyph(status: string): string {
  if (status === "resolved") return STATUS_GLYPH.success;
  if (status === "maintenance") return STATUS_GLYPH.info;
  return STATUS_GLYPH.error;
}

/** Collapse a day's stacked bar segments to the single worst (most severe) status. */
export function dominantDayStatus(
  bar: { status: string; height: number }[],
): DayStatus {
  let best: DayStatus = "empty";
  for (const seg of bar) {
    const status = seg.status as DayStatus;
    if (seg.height > 0 && (DAY_PRIORITY[status] ?? -1) > DAY_PRIORITY[best]) {
      best = status;
    }
  }
  return best;
}

/**
 * One ASCII cell per day, oldest → newest, in a code span. The code span pins
 * the bar to monospace (cells stay aligned) and keeps it markdown-inert — a run
 * of `~~` days would otherwise parse as strikethrough.
 */
export function uptimeBar(
  days: { bar: { status: string; height: number }[] }[],
): string {
  if (days.length === 0) return "";
  return `\`${days.map((d) => statusGlyph(dominantDayStatus(d.bar))).join("")}\``;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function toDate(date: Date | string | number): Date {
  return date instanceof Date ? date : new Date(date);
}

/**
 * Wall-clock parts of `d` in `tz`, via a cached per-zone formatter.
 *
 * The markdown surface is served to machines as much as humans, so its output
 * must be deterministic: month names come from the fixed MONTHS table (never a
 * locale), and only the NUMERIC fields are read from Intl. The zone matters
 * because these strings label days on a page that may have a configured
 * display zone — a Bogota page must not say "Sep 15" where its HTML says
 * "Sep 14". `tz === "UTC"` never reaches this (callers keep the original
 * arithmetic path), so unconfigured pages render byte-identical output.
 */
const ZONE_PART_FORMATTERS = new Map<string, Intl.DateTimeFormat>();
function wallClockParts(
  d: Date,
  tz: string,
): { year: number; month: number; day: number; hour: number; minute: number } {
  let dtf = ZONE_PART_FORMATTERS.get(tz);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    ZONE_PART_FORMATTERS.set(tz, dtf);
  }
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(d)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

/**
 * "Jan 25, 2026" in the page's zone (UTC when none is configured).
 *
 * Invalid input yields "—", the same placeholder `formatDayTime` already uses.
 * Guarded BEFORE the zone branch on purpose: `Intl.formatToParts` throws on an
 * invalid Date while the UTC arithmetic path silently rendered "undefined NaN,
 * NaN", so the two branches disagreed about the same bad input — one 500'd the
 * whole .md route on a zoned page, the other shipped garbage on a UTC one. The
 * UTC output this replaces was never meaningful, so nothing legible is lost.
 */
export function formatDay(date: Date | string | number, tz = "UTC"): string {
  const d = toDate(date);
  if (Number.isNaN(d.getTime())) return "—";
  if (tz === "UTC") {
    return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  }
  const w = wallClockParts(d, tz);
  return `${MONTHS[w.month - 1]} ${w.day}, ${w.year}`;
}

/** "Feb 3, 1:42 PM" in the page's zone. Null/invalid → "—". */
export function formatDayTime(
  date: Date | string | number | null | undefined,
  tz = "UTC",
): string {
  if (date === null || date === undefined) return "—";
  const d = toDate(date);
  if (Number.isNaN(d.getTime())) return "—";
  const w =
    tz === "UTC"
      ? {
          month: d.getUTCMonth() + 1,
          day: d.getUTCDate(),
          hour: d.getUTCHours(),
          minute: d.getUTCMinutes(),
        }
      : wallClockParts(d, tz);
  const period = w.hour < 12 ? "AM" : "PM";
  const hour12 = w.hour % 12 === 0 ? 12 : w.hour % 12;
  const minutes = String(w.minute).padStart(2, "0");
  return `${MONTHS[w.month - 1]} ${w.day}, ${hour12}:${minutes} ${period}`;
}

/**
 * "2026-06-18 14:50" in the page's zone. Fixed-width, 16 characters.
 *
 * NOT lexically sortable on a page whose zone observes DST: the fall-back hour
 * repeats, so two instants an hour apart render the same stamp and a later
 * instant can render an earlier one. `eventLog` emits rows in true instant
 * order and THAT order is authoritative; the stamp is a label, not a key.
 * (No effect on America/Bogota, which has no DST.)
 *
 * Invalid input yields a same-width marker rather than throwing — see
 * `formatDay`. The marker keeps the log's columns aligned and cannot be
 * mistaken for, or parsed as, a real timestamp.
 */
export function formatLogStamp(
  date: Date | string | number,
  tz = "UTC",
): string {
  const d = toDate(date);
  if (Number.isNaN(d.getTime())) return "????-??-?? ??:??";
  const w =
    tz === "UTC"
      ? {
          year: d.getUTCFullYear(),
          month: d.getUTCMonth() + 1,
          day: d.getUTCDate(),
          hour: d.getUTCHours(),
          minute: d.getUTCMinutes(),
        }
      : wallClockParts(d, tz);
  const mm = String(w.month).padStart(2, "0");
  const dd = String(w.day).padStart(2, "0");
  const hh = String(w.hour).padStart(2, "0");
  const min = String(w.minute).padStart(2, "0");
  return `${w.year}-${mm}-${dd} ${hh}:${min}`;
}

export type EventLogRow = {
  timestamp: Date | string | number;
  label: string;
  glyph: string;
  ref: string;
  title: string;
};

/**
 * Greppable event log: one update per line, stamp first, newest first.
 * Structured columns (stamp/status/ref/glyph) precede the user-authored title,
 * which trails as free text. Newlines are stripped from the title so it can't
 * inject a line that closes the fenced block.
 *
 * Rows are sorted by the underlying INSTANT, which is the authoritative order.
 * Do not re-sort downstream on the rendered stamp: on a DST page it is not a
 * total order (see `formatLogStamp`).
 */
export function eventLog(rows: EventLogRow[], tz = "UTC"): string {
  if (rows.length === 0) return "";
  const sorted = [...rows].sort(
    (a, b) => toDate(b.timestamp).getTime() - toDate(a.timestamp).getTime(),
  );
  const statusW = Math.max(6, ...sorted.map((r) => r.label.length));
  const refW = Math.max(5, ...sorted.map((r) => r.ref.length));
  const header = `# ${"timestamp".padEnd(16)}  ${"status".padEnd(statusW)}  event`;
  const lines = sorted.map(
    (r) =>
      `${formatLogStamp(r.timestamp, tz)}  ${r.label.padEnd(statusW)}  ${r.ref.padEnd(refW)}  ${r.glyph} ${r.title.replace(/[\r\n]+/g, " ")}`,
  );
  return ["```text", header, ...lines, "```"].join("\n");
}

/**
 * The zone label appended to stamps: "GMT+0" for UTC (byte-identical to the
 * historical output), otherwise the real offset at that instant — "GMT-5",
 * "GMT+5:30" — read from Intl's shortOffset name, so DST is reflected rather
 * than hardcoded. Deliberately an OFFSET, not an abbreviation like "COT":
 * offsets are unambiguous and locale-independent, which machine consumers of
 * this surface depend on.
 */
const ZONE_STAMP_FORMATTERS = new Map<string, Intl.DateTimeFormat>();
function zoneStampLabel(d: Date, tz: string): string {
  let dtf = ZONE_STAMP_FORMATTERS.get(tz);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "shortOffset",
    });
    ZONE_STAMP_FORMATTERS.set(tz, dtf);
  }
  const name = dtf
    .formatToParts(d)
    .find((p) => p.type === "timeZoneName")?.value;
  // Bare "GMT" (zero offset) keeps the explicit "+0" the surface always had.
  if (!name || name === "GMT") return "GMT+0";
  return name;
}

/** "Jun 18, 2026 14:50 (GMT+0)" — page zone, offset shown explicitly. */
export function formatStamp(date: Date | string | number, tz = "UTC"): string {
  const d = toDate(date);
  // Same branch-asymmetry guard as `formatDay`: the zoned path would throw
  // where the UTC path rendered "undefined NaN, NaN (GMT+0)".
  if (Number.isNaN(d.getTime())) return "—";
  if (tz === "UTC") {
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mm = String(d.getUTCMinutes()).padStart(2, "0");
    return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} ${hh}:${mm} (GMT+0)`;
  }
  const w = wallClockParts(d, tz);
  const hh = String(w.hour).padStart(2, "0");
  const mm = String(w.minute).padStart(2, "0");
  return `${MONTHS[w.month - 1]} ${w.day}, ${w.year} ${hh}:${mm} (${zoneStampLabel(d, tz)})`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

function coarseSpan(ms: number): string {
  if (ms < HOUR) {
    const m = Math.max(1, Math.round(ms / MINUTE));
    return `${m} ${m === 1 ? "minute" : "minutes"}`;
  }
  if (ms < DAY) {
    const h = Math.round(ms / HOUR);
    return `${h} ${h === 1 ? "hour" : "hours"}`;
  }
  if (ms < MONTH) {
    const d = Math.round(ms / DAY);
    return `${d} ${d === 1 ? "day" : "days"}`;
  }
  if (ms < YEAR) {
    const m = Math.round(ms / MONTH);
    return `${m} ${m === 1 ? "month" : "months"}`;
  }
  const y = Math.round(ms / YEAR);
  return `${y} ${y === 1 ? "year" : "years"}`;
}

/** "4 months ago" relative to `now`. */
export function relativeTime(
  date: Date | string | number,
  now: number,
): string {
  const ms = now - toDate(date).getTime();
  if (ms < MINUTE) return "just now";
  return `${coarseSpan(ms)} ago`;
}

/** Human duration between two instants: "9 days", "23 hours". */
export function humanDuration(
  from: Date | string | number,
  to: Date | string | number,
): string {
  return coarseSpan(Math.max(0, toDate(to).getTime() - toDate(from).getTime()));
}

/**
 * Pointer to machine-readable formats, for agents that enter via a `.md` link
 * and never see `llms.txt`. Public pages only — a gated page must not advertise
 * JSON endpoints that may not honor its access gate.
 */
export function machineReadable(): string {
  return "Machine-readable: [current.json](/api/status/current.json) · [summary.json](/api/status/summary.json) · [more](/llms.txt)";
}

/** Attribution footer appended to every doc unless the page is white-labeled. */
export function poweredByFooter(): string {
  return "---\n\n_Powered by [openstatus.dev](https://openstatus.dev)_\n";
}

/** Append the attribution footer to rendered markdown unless white-labeled. */
export function withPoweredBy(markdown: string, whiteLabel: boolean): string {
  if (whiteLabel) return markdown;
  return `${markdown}\n${poweredByFooter()}`;
}
