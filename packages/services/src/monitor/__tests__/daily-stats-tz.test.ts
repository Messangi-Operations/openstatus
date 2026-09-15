import { expect } from "@std/expect";
import { beforeAll, describe, test } from "@std/testing/bdd";

import {
  createWorkspaceFixture,
  makeUserCtx,
  withTestTransaction,
} from "../../../test/helpers";
import type { ServiceContext } from "../../context";
import { createMonitor } from "../create";
import { fetchMonitorDailyStats } from "../get-daily-summary";

/**
 * `fetchMonitorDailyStats` picks between two families of Tinybird pipes: the
 * cached materialized views (whose day boundary already IS UTC midnight) and
 * the `*Tz` pipes, which re-group the raw datasource because a materialized
 * view has its boundary baked into the stored rows.
 *
 * Every existing test double stubs only the UTC family, so the zoned branch —
 * the one a page configured to America/Bogota takes on every render — had no
 * coverage at all: a typo in the pipe name or a dropped `since` would have been
 * caught by nothing.
 */

const TEST_PREFIX = "svc-daily-stats-tz";
let teamCtx: ServiceContext;

beforeAll(async () => {
  const team = (await createWorkspaceFixture("team")).workspace;
  teamCtx = makeUserCtx(team, { userId: 1 });
});

/** Records which pipe was called with what, and returns no rows. */
function spyTb() {
  const calls: Record<string, unknown> = {};
  const record = (name: string) => (args: unknown) => {
    calls[name] = args;
    return Promise.resolve({ data: [] });
  };
  const tb = {
    httpStatus45d: record("httpStatus45d"),
    tcpStatus45d: record("tcpStatus45d"),
    dnsStatus45d: record("dnsStatus45d"),
    icmpStatus45d: record("icmpStatus45d"),
    grpcStatus45d: record("grpcStatus45d"),
    httpStatus45dTz: record("httpStatus45dTz"),
    tcpStatus45dTz: record("tcpStatus45dTz"),
    dnsStatus45dTz: record("dnsStatus45dTz"),
    icmpStatus45dTz: record("icmpStatus45dTz"),
    grpcStatus45dTz: record("grpcStatus45dTz"),
  } as unknown as NonNullable<ServiceContext["tb"]>;
  return { tb, calls };
}

// biome-ignore lint/suspicious/noExplicitAny: the transaction type is internal
async function httpMonitor(tx: any, suffix: string) {
  return await createMonitor({
    ctx: { ...teamCtx, db: tx },
    input: {
      name: `${TEST_PREFIX}-${suffix}`,
      jobType: "http",
      url: "https://example.com",
      method: "GET",
      headers: [],
      assertions: [],
      active: false,
      regions: ["ams"],
    },
  });
}

describe("fetchMonitorDailyStats pipe selection", () => {
  test("omitting tz keeps the cached UTC materialized-view pipe", async () => {
    await withTestTransaction(async (tx) => {
      const row = await httpMonitor(tx, "utc-default");
      const { tb, calls } = spyTb();

      await fetchMonitorDailyStats({
        db: tx,
        tb,
        monitorIds: [row.id],
        workspaceId: teamCtx.workspace.id,
      });

      expect(calls.httpStatus45d).toEqual({ monitorIds: [String(row.id)] });
      expect(calls.httpStatus45dTz).toBeUndefined();
    });
  });

  test('an explicit "UTC" is treated as UTC, not as a zone', async () => {
    // Otherwise every unconfigured page silently moves onto the expensive
    // per-request raw scan for byte-identical output.
    await withTestTransaction(async (tx) => {
      const row = await httpMonitor(tx, "utc-explicit");
      const { tb, calls } = spyTb();

      await fetchMonitorDailyStats({
        db: tx,
        tb,
        monitorIds: [row.id],
        workspaceId: teamCtx.workspace.id,
        tz: "UTC",
        since: 123,
      });

      expect(calls.httpStatus45d).toBeDefined();
      expect(calls.httpStatus45dTz).toBeUndefined();
    });
  });

  test("a real zone routes to the Tz pipe and forwards tz AND since", async () => {
    await withTestTransaction(async (tx) => {
      const row = await httpMonitor(tx, "zoned");
      const { tb, calls } = spyTb();
      const since = Date.parse("2026-08-01T05:00:00.000Z");

      await fetchMonitorDailyStats({
        db: tx,
        tb,
        monitorIds: [row.id],
        workspaceId: teamCtx.workspace.id,
        tz: "America/Bogota",
        since,
      });

      // `since` bounds a scan over a datasource with no TTL — dropping it is
      // the difference between reading 46 days and reading all of history.
      expect(calls.httpStatus45dTz).toEqual({
        monitorIds: [String(row.id)],
        tz: "America/Bogota",
        since,
      });
      expect(calls.httpStatus45d).toBeUndefined();
    });
  });
});
