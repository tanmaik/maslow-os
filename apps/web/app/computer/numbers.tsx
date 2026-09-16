"use client";

import { RiCpuLine, RiHardDrive3Line, RiRamLine } from "@remixicon/react";
import { useEffect, useState, type ComponentType } from "react";
import { Area, AreaChart, ReferenceLine, XAxis, YAxis } from "recharts";

import { Notification } from "@/components/base/notification/notification";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { useCountUp } from "@/hooks/use-count-up";
import type { Stats } from "@/lib/fly";
import { SIZES, specs, type SizeKey } from "@/lib/sizes";
import { cx } from "@/utils/cx";

export type { Stats };

// One reading kept per ask, a minute's worth on screen.
export type Sample = { at: number; cpu: number; memory: number };
const EVERY = 5000;
const KEEP = 60_000 / EVERY;

const gb = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`;
// "2 shared CPUs", the first half of a size's specs.
const cpusOf = (s: (typeof SIZES)[SizeKey]) => specs(s).split(",")[0];

// Both lines are the same ink: each sits alone on its own card, named by
// its title, so colour has nothing to tell apart.
const chart = {
  cpu: { label: "CPU", color: "var(--color-accent-500)" },
  memory: { label: "Memory", color: "var(--color-accent-500)" },
} satisfies ChartConfig;

type IconComponent = ComponentType<{
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}>;

// The computer's live numbers, asked for every few seconds: the last
// minute of them on screen, and what the last ask said when it failed.
// One ask feeds the cards, the ports and Claude Code alike.
export function useStats(): {
  now: Stats | null;
  samples: Sample[];
  failed: string | null;
} {
  const [now, setNow] = useState<Stats | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let stopped = false;
    const ask = async () => {
      try {
        const res = await fetch("/computer/stats");
        if (!res.ok) throw new Error(await res.text());
        const s = (await res.json()) as Stats;
        if (stopped) return;
        setNow(s);
        setSamples((was) =>
          [
            ...was,
            {
              at: Date.now(),
              cpu: s.cpu,
              memory: Math.round((s.memory.used / s.memory.total) * 100),
            },
          ].slice(-KEEP),
        );
        setFailed(null);
      } catch (err) {
        // Numbers that could not be read are not shown as if they were.
        if (!stopped) {
          setNow(null);
          setFailed((err as Error).message);
        }
      }
      if (!stopped) setTimeout(ask, EVERY);
    };
    void ask();
    return () => {
      stopped = true;
    };
  }, []);
  return { now, samples, failed };
}

// What the computer is using: CPU and memory over the last minute, and the
// bytes its disk holds.
export function Numbers({
  now,
  samples,
  failed,
  size,
}: {
  now: Stats | null;
  samples: Sample[];
  failed: string | null;
  // The rung the computer is on, or null when it is on none.
  size: SizeKey | null;
}) {
  if (!now)
    return (
      <p className="px-3 text-body-2-regular text-text-secondary">
        {failed
          ? `Could not read the numbers: ${failed}. Trying again.`
          : "Reading the numbers…"}
      </p>
    );
  // Near the limit means a whole minute of it, not a moment.
  const minute = samples.slice(-KEEP);
  const hot =
    minute.length >= KEEP &&
    (minute.every((s) => s.cpu > 85) || minute.every((s) => s.memory > 90));
  const memoryPct = Math.round((now.memory.used / now.memory.total) * 100);
  return (
    <div className="flex flex-col gap-4">
      {hot && (
        <Notification
          status="error"
          dismissible={false}
          title="Your computer is near its limit"
          description="It has been running near the top of its size for the last minute."
        />
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Live
          icon={RiCpuLine}
          title="CPU"
          value={now.cpu}
          unit="%"
          of={size ? `of ${cpusOf(SIZES[size])}` : "of its CPUs"}
          field="cpu"
          samples={samples}
        />
        <Live
          icon={RiRamLine}
          title="Memory"
          value={now.memory.used / 1e8}
          scale={0.1}
          unit=" GB"
          of={`of ${gb(now.memory.total)}, ${memoryPct}%`}
          field="memory"
          samples={samples}
        />
        <Stat
          icon={RiHardDrive3Line}
          title="Disk"
          value={now.used === null ? null : now.used / 1e8}
          scale={0.1}
          unit=" GB"
          of={now.used === null ? "measuring what is used…" : "used"}
        />
      </div>
    </div>
  );
}

// A number that rolls to where it is going, as BoardUI's headline figures
// do, drawn at the scale it is kept in.
function Rolling({
  value,
  scale = 1,
  unit,
}: {
  value: number;
  scale?: number;
  unit: string;
}) {
  const shown = useCountUp(Math.round(value));
  const digits = scale < 1 ? 1 : 0;
  return (
    <>
      {(shown * scale).toFixed(digits)}
      <span className="text-headline-medium text-text-secondary">{unit}</span>
    </>
  );
}

// One measure on BoardUI's stat card: its mark on a tile, its name, the
// number now, and what it is of.
function Stat({
  icon: Icon,
  title,
  value,
  scale,
  unit,
  of,
  children,
}: {
  icon: IconComponent;
  title: string;
  value: number | null;
  scale?: number;
  unit: string;
  of: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col items-start justify-between gap-3 rounded-2xl bg-background-secondary-default p-4">
      <span className="flex items-center rounded-md bg-stat-card-icon-background p-1.5 shadow-card">
        <Icon
          className="size-5 shrink-0 text-foreground-icon-primary"
          aria-hidden
        />
      </span>
      <div className="flex w-full flex-col gap-0.5">
        <p className="w-full text-body-medium text-text-secondary">{title}</p>
        <p className="text-title-1-medium whitespace-nowrap text-text-primary tabular-nums">
          {value === null ? (
            "—"
          ) : (
            <Rolling value={value} scale={scale} unit={unit} />
          )}
        </p>
        <p className="truncate text-caption-1-regular text-text-secondary">
          {of}
        </p>
      </div>
      {/* The chart's place is kept whether or not there is one, so the
          three cards' titles and numbers sit on the same lines. */}
      {children ?? <div aria-hidden className="h-10 w-full" />}
    </section>
  );
}

// A measure with the last minute of it drawn underneath on a fixed scale
// from nothing to everything, so a flat line low down means idle and one
// along the top means full.
function Live({
  field,
  samples,
  ...stat
}: {
  icon: IconComponent;
  title: string;
  value: number;
  scale?: number;
  unit: string;
  of: string;
  field: "cpu" | "memory";
  samples: Sample[];
}) {
  const at = (ms: number) =>
    new Date(ms).toLocaleTimeString(undefined, { timeStyle: "medium" });
  return (
    <Stat {...stat}>
      <ChartContainer
        config={chart}
        className={cx("h-10 w-full", samples.length < 2 && "opacity-0")}
      >
        <AreaChart
          data={samples}
          margin={{ top: 2, right: 0, bottom: 0, left: 0 }}
        >
          <XAxis
            dataKey="at"
            type="number"
            domain={["dataMin", "dataMax"]}
            hide
          />
          <YAxis domain={[0, 100]} hide />
          <ReferenceLine
            y={50}
            stroke="var(--color-chart-cursor)"
            strokeDasharray="2 3"
          />
          <ChartTooltip
            cursor={{ stroke: "var(--color-chart-cursor)" }}
            content={
              <ChartTooltipContent
                hideIndicator
                labelFormatter={(_, payload) =>
                  at((payload[0]?.payload as Sample).at)
                }
                formatter={(v) => `${v}%`}
              />
            }
          />
          <Area
            dataKey={field}
            type="monotone"
            stroke={`var(--color-${field})`}
            strokeWidth={2}
            fill={`var(--color-${field})`}
            fillOpacity={0.14}
            baseValue={0}
            isAnimationActive={false}
            dot={false}
            activeDot={{ r: 3 }}
          />
        </AreaChart>
      </ChartContainer>
    </Stat>
  );
}
