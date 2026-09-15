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
function zoneLabel(timeZone: string, locale: string) {
  try {
    const part = new Intl.DateTimeFormat(locale, {
      timeZone,
      timeZoneName: "short",
    })
      .formatToParts(new Date())
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
  const withZone = (value: string) =>
    `${value} (${zoneLabel(timeZone, locale)})`;

  const value = useMemo<StatusBlocksLabels>(
    () => ({
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

      formatDate: (d: Date) => withZone(formatDate(d, { locale, timeZone })),
      // NOT zoned: the uptime tracker feeds this UTC day-bucket strings
      // ("2024-01-15"), which are midnight UTC. Shifting them into a western
      // zone moves every bar to the previous day. Day buckets stay UTC.
      formatDateShort: (d: Date) => formatDate(d, { month: "short", locale }),
      formatDateTime: (d: Date) =>
        withZone(formatDateTime(d, locale, timeZone)),
      formatDateRange: (from?: Date, to?: Date) => {
        const range = formatDateRange(from, to, locale, timeZone);
        return from || to ? withZone(range) : range;
      },
      formatDateRangeParts: (from: Date, to: Date) => {
        const { from: start, to: end } = formatDateRangeParts(
          from,
          to,
          locale,
          timeZone,
        );
        return { from: start, to: withZone(end) };
      },
    }),
    [t, locale, timeZone],
  );

  return (
    <StatusBlocksI18nProvider value={value}>
      {children}
    </StatusBlocksI18nProvider>
  );
}
