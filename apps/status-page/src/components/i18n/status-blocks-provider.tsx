"use client";

import {
  StatusBlocksI18nProvider,
  type StatusBlocksLabels,
} from "@openstatus/ui/components/blocks/status-i18n";
import { useExtracted, useLocale } from "next-intl";
import { useMemo } from "react";

import {
  formatDate,
  formatDateRange,
  formatDateRangeParts,
  formatDateTime,
} from "../../lib/formatter";

/**
 * Short label for the zone actually being rendered ("UTC", "GMT-5", "CST"),
 * appended so a viewer knows which clock they are reading. Derived from Intl
 * rather than stored, so it stays correct across DST for zones that observe it.
 *
 * Falls back to the raw zone id if Intl gives nothing useful.
 */
function zoneLabel(timeZone: string, locale: string, at: Date) {
  try {
    const part = new Intl.DateTimeFormat(locale, {
      timeZone,
      timeZoneName: "short",
    })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName");
    return part?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

/**
 * StatusBlocksProvider
 *
 * Bridges next-intl translations + locale-aware date formatters into the
 * `@openstatus/ui` blocks. Mounted once at the locale layout — every block
 * rendered below it (banner, bar, component, events, feed, blank) reads
 * translated labels via `useStatusBlocksLabels()`.
 *
 * Extractor note: the t("…") keys below must remain literal strings so the
 * next-intl extractor can pick them up from `apps/status-page/src/...`.
 */
export function StatusBlocksProvider({
  children,
  timeZone = "UTC",
}: {
  children: React.ReactNode;
  /**
   * IANA zone for this page, resolved on the SERVER and passed in. Never read
   * from config inside this component: it is a client component, so a value
   * computed here would differ between SSR and hydration.
   */
  timeZone?: string;
}) {
  const t = useExtracted();
  const locale = useLocale();

  const value = useMemo<StatusBlocksLabels>(() => {
    // Defined inside the memo so it is not a missing dependency, and takes the
    // instant being labelled: a zone's short name depends on whether THAT date
    // was in DST, not on whether today is. A January incident on a Santiago
    // page must read GMT-3, even when rendered in July.
    const withZone = (value: string, at: Date) =>
      `${value} (${zoneLabel(timeZone, locale, at)})`;
    return {
      systemStatus: {
        success: {
          long: t("All Systems Operational"),
          short: t("Operational"),
        },
        degraded: { long: t("Degraded Performance"), short: t("Degraded") },
        error: { long: t("Downtime Performance"), short: t("Downtime") },
        info: { long: t("Maintenance"), short: t("Maintenance") },
        empty: { long: t("No Data"), short: t("No Data") },
      },
      incidentStatus: {
        resolved: t("Resolved"),
        monitoring: t("Monitoring"),
        identified: t("Identified"),
        investigating: t("Investigating"),
      },
      requestStatus: {
        success: t("Normal"),
        degraded: t("Degraded"),
        error: t("Error"),
        info: t("Maintenance"),
        empty: t("No Data"),
      },
      componentImpact: {
        operational: t("Operational"),
        degraded_performance: t("Degraded performance"),
        partial_outage: t("Partial outage"),
        major_outage: t("Major outage"),
      },

      today: t("today"),
      ongoing: t("ongoing"),
      reportResolved: t("Report resolved"),
      noRecentNotifications: t("No recent notifications"),
      noRecentNotificationsDescription: t(
        "There have been no reports within the last 7 days.",
      ),
      noReports: t("No reports found"),
      noReportsDescription: t("No reports found for this status page."),
      noPublicMonitors: t("No public monitors"),
      noPublicMonitorsDescription: t(
        "No public monitors have been added to this page.",
      ),

      themeNames: {
        light: t("Light"),
        dark: t("Dark"),
        system: t("System"),
      },
      ariaToggleTheme: t("Toggle theme"),

      subscribe: t("Get updates"),
      subscribeRssDescription: t("Get the RSS feed"),
      subscribeAtomDescription: t("Get the Atom feed"),
      subscribeJsonDescription: t("Get the JSON updates"),
      subscribeSlackDescription: t(
        "For status updates in Slack, paste the text below into any channel.",
      ),
      subscribeSshDescription: t("Get status via SSH"),
      linkCopiedToClipboard: t("Link copied to clipboard"),
      ariaCopyLink: t("Copy Link"),

      poweredBy: t("powered by"),
      getInTouch: t("Get in touch"),

      ariaStatusTracker: t("Status tracker"),
      ariaDayStatus: (n: number) => t("Day {n} status", { n: String(n) }),
      clickAgainToUnpin: t("Click again to unpin"),

      calendarTitle: t("Calendar"),

      durationIn: (duration: string) => t("(in {duration})", { duration }),
      durationEarlier: (timeFromLast: string) =>
        t("({timeFromLast} earlier)", { timeFromLast }),
      durationFor: (duration: string) => t("(for {duration})", { duration }),
      durationAcross: (duration: string) =>
        t("across {duration}", { duration }),

      formatDate: (d: Date) => withZone(formatDate(d, { locale, timeZone }), d),
      // A real timestamp: render it in the page's zone like every other one.
      formatDateShort: (d: Date) =>
        formatDate(d, { month: "short", locale, timeZone }),
      // A UTC day bucket from the uptime tracker: must NOT be re-zoned, or all
      // 45 bars shift to the previous day on any western page.
      formatDayBucket: (d: Date) => formatDate(d, { month: "short", locale }),
      formatDateTime: (d: Date) =>
        withZone(formatDateTime(d, locale, timeZone), d),
      formatDateRange: (from?: Date, to?: Date) => {
        const range = formatDateRange(from, to, locale, timeZone);
        // label the instant the reader ends on; both sides share a zone
        const at = to ?? from;
        return at ? withZone(range, at) : range;
      },
      formatDateRangeParts: (from: Date, to: Date) => {
        const { from: start, to: end } = formatDateRangeParts(
          from,
          to,
          locale,
          timeZone,
        );
        return { from: start, to: withZone(end, to) };
      },
    };
  }, [t, locale, timeZone]);

  return (
    <StatusBlocksI18nProvider value={value}>
      {children}
    </StatusBlocksI18nProvider>
  );
}
