"use client";

import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@openstatus/ui/components/ui/chart";
import { cn } from "@openstatus/ui/lib/utils";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { ChartTooltipNumber } from "./chart-tooltip-number";

const chartConfig = {
  latency: {
    label: "Latency",
    color: "var(--success)",
  },
} satisfies ChartConfig;

export type TrendPoint = {
  timestamp: number; // unix millis
  latency: number; // milliseconds
};

export function ChartLineRegion({
  className,
  data,
  // The page's display zone. Defaults to UTC rather than the viewer's zone:
  // this renders inside a status page whose every other date is cut in the
  // configured zone, and "default" (viewer) formatting also differs between
  // the SSR pass and the hydrated client. NOTE: currently unmounted in this
  // app (the dashboard has its own copy) — the prop is here so the next
  // consumer cannot reintroduce the viewer-zone bug by omission.
  timeZone = "UTC",
  locale,
}: {
  className?: string;
  data: TrendPoint[];
  timeZone?: string;
  locale?: string;
}) {
  const trendData = data ?? [];

  const chartData = trendData.map((d) => ({
    timestamp: new Date(d.timestamp).toLocaleString(locale, {
      hour: "numeric",
      minute: "numeric",
      day: "numeric",
      month: "short",
      timeZone,
    }),
    latency: d.latency,
  }));

  return (
    <ChartContainer
      config={chartConfig}
      className={cn("h-[100px] w-full", className)}
    >
      <LineChart
        accessibilityLayer
        data={chartData}
        margin={{
          left: 12,
          right: 12,
        }}
      >
        <CartesianGrid vertical={false} />
        <XAxis dataKey="timestamp" hide />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              className="w-[180px]"
              formatter={(value, name) => (
                <ChartTooltipNumber
                  chartConfig={chartConfig}
                  value={value}
                  name={name}
                />
              )}
            />
          }
        />
        <Line
          dataKey="latency"
          type="monotone"
          stroke="var(--color-latency)"
          strokeWidth={2}
          dot={false}
        />
        <YAxis
          domain={["dataMin", "dataMax"]}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          orientation="right"
          tickFormatter={(value) => `${value}ms`}
        />
      </LineChart>
    </ChartContainer>
  );
}
