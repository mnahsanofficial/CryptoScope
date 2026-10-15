"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatNumber, formatPercent } from "@/lib/format";
import type { KeyAlgorithmCounts, WeakPerInterval } from "@/lib/types";

/*
 * Chart styling follows one set of rules: one hue per single-series chart (no legend needed, the title
 * names it), thin marks, 4px rounded bar ends, a 2px line with a light area wash, hairline grid, and
 * text in ink colors (never the series color). Every value is also reachable through the tooltip.
 */

const axisProps = {
  stroke: "var(--axis)",
  tick: { fill: "var(--ink-muted)", fontSize: 12 },
  tickLine: false,
} as const;

function TooltipBox({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <div className="rounded-lg border border-hairline bg-surface px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-ink">{title}</p>
      {rows.map(([label, value]) => (
        <p key={label} className="flex justify-between gap-4 text-ink-2">
          <span>{label}</span>
          <span className="tabular font-medium text-ink">{value}</span>
        </p>
      ))}
    </div>
  );
}

/** Horizontal bars: how many handshakes used each certificate key algorithm. */
export function KeyAlgorithmChart({ data }: { data: KeyAlgorithmCounts }) {
  const rows = data.algorithms.map((a) => ({
    ...a,
    name: a.keyAlgorithm.startsWith("ML-DSA") ? `${a.keyAlgorithm} (PQ)` : a.keyAlgorithm,
  }));
  return (
    <ResponsiveContainer width="100%" height={Math.max(140, rows.length * 48)}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 8 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="name" width={120} axisLine={false} {...axisProps} />
        <Tooltip
          cursor={{ fill: "var(--surface-2)" }}
          content={({ active, payload }) => {
            const row = payload?.[0]?.payload as (typeof rows)[number] | undefined;
            if (!active || !row) return null;
            return <TooltipBox title={row.name} rows={[["Handshakes", formatNumber(row.count)], ["Share", formatPercent(row.percentage)]]} />;
          }}
        />
        <Bar dataKey="count" fill="var(--series-1)" barSize={20} radius={[0, 4, 4, 0]} isAnimationActive={false}>
          <LabelList
            dataKey="percentage"
            position="right"
            formatter={(v: unknown) => formatPercent(Number(v))}
            style={{ fill: "var(--ink-2)", fontSize: 12 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

const hourLabel = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", hour12: false });
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Line + wash: weak handshakes per time bucket. Hover shows the bucket's weak count, total and share. */
export function WeakHandshakesChart({ data }: { data: WeakPerInterval }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data.buckets} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey="timestamp" tickFormatter={dayLabel} minTickGap={48} {...axisProps} />
        <YAxis width={44} axisLine={false} tickFormatter={(v: number) => (v >= 1000 ? `${v / 1000}K` : String(v))} {...axisProps} />
        <Tooltip
          cursor={{ stroke: "var(--axis)", strokeWidth: 1 }}
          content={({ active, payload }) => {
            const b = payload?.[0]?.payload as WeakPerInterval["buckets"][number] | undefined;
            if (!active || !b) return null;
            return (
              <TooltipBox
                title={hourLabel(b.timestamp)}
                rows={[["Weak", formatNumber(b.weak)], ["All handshakes", formatNumber(b.total)], ["Weak share", formatPercent(b.weakPercentage)]]}
              />
            );
          }}
        />
        <Area
          type="monotone"
          dataKey="weak"
          stroke="var(--series-2)"
          strokeWidth={2}
          fill="var(--series-2)"
          fillOpacity={0.1}
          activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
