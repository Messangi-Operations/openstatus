"use client";

import type {
  StatusReportImpact,
  StatusReportUpdateType,
  StatusType,
  ThemeValue,
} from "@openstatus/ui/components/blocks/status.types";
import { defaultStatusBlocksLabels } from "@openstatus/ui/components/blocks/status.utils";
import { createContext, useContext } from "react";

/**
 * Labels and locale-aware formatters consumed by block components.
 *
 * Blocks read this via `useStatusBlocksLabels()`. When no provider is mounted,
 * the hook returns `defaultStatusBlocksLabels` (English, "en-US" formatting).
 * Apps wanting localized copy should mount `StatusBlocksI18nProvider` and
 * supply translated strings + locale-aware formatters.
 */
export type StatusBlocksLabels = {
  systemStatus: Record<StatusType, { long: string; short: string }>;
  incidentStatus: Record<StatusReportUpdateType, string>;
  requestStatus: Record<StatusType, string>;
  componentImpact: Record<StatusReportImpact, string>;

  today: string;
  ongoing: string;
  reportResolved: string;
  noRecentNotifications: string;
  noRecentNotificationsDescription: string;
  noReports: string;
  noReportsDescription: string;
  noPublicMonitors: string;
  noPublicMonitorsDescription: string;

  themeNames: Record<ThemeValue, string>;
  ariaToggleTheme: string;

  subscribe: string;
  subscribeRssDescription: string;
  subscribeAtomDescription: string;
  subscribeJsonDescription: string;
  subscribeSlackDescription: string;
  subscribeSshDescription: string;
  linkCopiedToClipboard: string;
  ariaCopyLink: string;

  poweredBy: string;
  getInTouch: string;

  ariaStatusTracker: string;
  ariaDayStatus: (n: number) => string;
  clickAgainToUnpin: string;

  /** Heading shown on the status-calendar block. */
  calendarTitle: string;

  durationIn: (s: string) => string;
  durationEarlier: (s: string) => string;
  durationFor: (s: string) => string;
  durationAcross: (s: string) => string;

  formatDate: (d: Date) => string;
  /** Short date of a real timestamp, in the page's display zone. */
  formatDateShort: (d: Date) => string;
  /**
   * Short date of a DAY BUCKET from the uptime tracker.
   *
   * A bucket's value is the instant its day BEGINS in the zone the buckets
   * were computed in — the page's configured zone (UTC when none is set), in
   * which case the value is plain UTC midnight. Implementations must format
   * it in that SAME zone: for a zoned page that is the page zone (see
   * status-blocks-provider), and for the no-provider default that is UTC,
   * matching its UTC-day data. Formatting in any other zone names the wrong
   * day — a Tokyo page's "Sep 15" bucket starts at Sep 14 15:00Z, and reading
   * that instant as UTC labels the bar a full day early.
   *
   * Deliberately separate from formatDateShort, which takes a real timestamp:
   * only one of the two may ever be re-zoned independently of its data.
   */
  formatDayBucket: (d: Date) => string;
  formatDateTime: (d: Date) => string;
  formatDateRange: (from?: Date, to?: Date) => string;
  /**
   * Returns the start/end of a closed range as separate strings, so callers
   * can render each side independently (e.g. wrap each in a hovercard)
   * without re-parsing the joined output of `formatDateRange`.
   *
   * Implementations should collapse same-day ranges (date on `from`, time
   * only on `to`) the same way `formatDateRange` does.
   *
   * Closed ranges only — both `from` and `to` are required. For open-ended
   * cases (`Since …` / `Until …` / `All time`) use `formatDateRange`.
   */
  formatDateRangeParts: (from: Date, to: Date) => { from: string; to: string };
};

const StatusBlocksLabelsContext = createContext<StatusBlocksLabels | null>(
  null,
);

export function StatusBlocksI18nProvider({
  value,
  children,
}: {
  value: StatusBlocksLabels;
  children: React.ReactNode;
}) {
  return (
    <StatusBlocksLabelsContext.Provider value={value}>
      {children}
    </StatusBlocksLabelsContext.Provider>
  );
}

export function useStatusBlocksLabels(): StatusBlocksLabels {
  return useContext(StatusBlocksLabelsContext) ?? defaultStatusBlocksLabels;
}
