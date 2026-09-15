import { and, eq, inArray, isNull } from "@openstatus/db";
import { monitor } from "@openstatus/db/src/schema";
import type { OSTinybird } from "@openstatus/tinybird";

import type { DB } from "../context";
import type { StatusData } from "../status-timeline";

type SupportedJobType = "http" | "tcp" | "dns" | "icmp" | "grpc";

/**
 * Raw daily status buckets (one row per monitor per day) from the 45d Tinybird
 * pipes, grouped by jobType. Ids that are missing / soft-deleted / of an
 * unsupported jobType are skipped — callers want empty data for those, not a
 * throw. The pipe rows already match `StatusData` (day ISO, monitorId string).
 */
export async function fetchMonitorDailyStats(args: {
  db: DB;
  tb: OSTinybird;
  monitorIds: number[];
  workspaceId: number;
  /**
   * Zone to group the daily buckets in. Omitted or "UTC" keeps the
   * materialized-view pipes, whose boundary already IS UTC midnight; any other
   * zone reads the raw datasource, which is the only place the boundary can
   * still be re-cut.
   */
  tz?: string;
  /** Lower bound for the zoned raw read; ignored by the UTC pipes. */
  since?: number;
}): Promise<StatusData[]> {
  const ids = Array.from(new Set(args.monitorIds));
  if (ids.length === 0) return [];

  const rows = await args.db
    .select({ id: monitor.id, jobType: monitor.jobType })
    .from(monitor)
    .where(
      and(
        inArray(monitor.id, ids),
        eq(monitor.workspaceId, args.workspaceId),
        isNull(monitor.deletedAt),
      ),
    )
    .all();

  const idsByJobType: Record<SupportedJobType, string[]> = {
    http: [],
    tcp: [],
    dns: [],
    icmp: [],
    grpc: [],
  };
  for (const row of rows) {
    if (
      row.jobType === "http" ||
      row.jobType === "tcp" ||
      row.jobType === "dns" ||
      row.jobType === "icmp" ||
      row.jobType === "grpc"
    ) {
      idsByJobType[row.jobType].push(String(row.id));
    }
  }

  const results = await Promise.all(
    (["http", "tcp", "dns", "icmp", "grpc"] as const)
      .filter((jobType) => idsByJobType[jobType].length > 0)
      .map((jobType) => {
        const monitorIds = idsByJobType[jobType];
        if (args.tz != null && args.tz !== "UTC") {
          const pipe =
            jobType === "http"
              ? args.tb.httpStatus45dTz
              : jobType === "tcp"
                ? args.tb.tcpStatus45dTz
                : jobType === "dns"
                  ? args.tb.dnsStatus45dTz
                  : jobType === "icmp"
                    ? args.tb.icmpStatus45dTz
                    : args.tb.grpcStatus45dTz;
          return pipe({ monitorIds, tz: args.tz, since: args.since });
        }
        const pipe =
          jobType === "http"
            ? args.tb.httpStatus45d
            : jobType === "tcp"
              ? args.tb.tcpStatus45d
              : jobType === "dns"
                ? args.tb.dnsStatus45d
                : jobType === "icmp"
                  ? args.tb.icmpStatus45d
                  : args.tb.grpcStatus45d;
        return pipe({ monitorIds });
      }),
  );

  return results.flatMap((result) => result.data);
}
