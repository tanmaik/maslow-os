"use client";

import { useEffect, useState } from "react";
import { Area, AreaChart, ReferenceLine, XAxis, YAxis } from "recharts";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { SIZES, specs, type SizeKey } from "@/lib/sizes";

import { Ports, type Sharing } from "./ports";

type Stats = {
  auth?: "managed" | "own" | "none";
  cpu: number;
  memory: { used: number; total: number };
  used: number | null;
  disk: number | null;
  ports: { port: number; name: string; ran?: string }[];
};

// One reading kept per ask, a minute's worth on screen.
type Sample = { at: number; cpu: number; memory: number };
const EVERY = 5000;
const KEEP = 60_000 / EVERY;

const gb = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`;
// "2 shared CPUs", the first half of a size's specs.
const cpusOf = (s: (typeof SIZES)[SizeKey]) => specs(s).split(",")[0];

// Both lines are the same ink: each sits alone on its own card, named by
// its title, so colour has nothing to tell apart.
const chart = {
  cpu: { label: "CPU", color: "var(--chart-1)" },
  memory: { label: "Memory", color: "var(--chart-1)" },
} satisfies ChartConfig;

// The computer's live numbers: CPU and memory over the last minute, the
// bytes used, and the ports listening inside, each named by what started it
// and opening at an address of its own.
// The cap on our key where this deployment mints one; null where it does
// not, and who each port is already given to.
export function Numbers({
  capUsd,
  sharing,
  size,
}: {
  capUsd: number | null;
  sharing: Sharing | null;
  // The rung the computer is on, or null when it is on none.
  size: SizeKey | null;
}) {
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
  if (!now)
    return (
      <p className="text-muted-foreground text-sm">
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
    <div className="space-y-4">
      {hot && (
        <Alert>
          <AlertTitle>Your computer is near its limit.</AlertTitle>
          <AlertDescription>
            It has been running near the top of its size for the last minute.
          </AlertDescription>
        </Alert>
      )}
      <div className="grid max-w-xl gap-4 sm:grid-cols-2">
        <Live
          title="CPU"
          value={`${now.cpu}%`}
          of={size ? `of ${cpusOf(SIZES[size])}` : "of its CPUs"}
          field="cpu"
          samples={samples}
        />
        <Live
          title="Memory"
          value={gb(now.memory.used)}
          of={`of ${gb(now.memory.total)}, ${memoryPct}%`}
          field="memory"
          samples={samples}
        />
      </div>
      <p className="text-sm">
        {now.used === null ? (
          <span className="text-muted-foreground">Measuring what is used…</span>
        ) : (
          <>
            <span className="font-medium">{gb(now.used)}</span>
            <span className="text-muted-foreground"> used</span>
          </>
        )}
      </p>
      <p className="text-muted-foreground text-sm">
        {now.auth === "managed"
          ? `Claude Code runs on a key of ours, capped at $${capUsd ?? "?"} a month. In its terminal, "auth own" switches it to credentials you provide.`
          : now.auth === "own"
            ? 'Claude Code runs on credentials you provided, by your choice. In its terminal, "auth managed" switches it back to our key.'
            : now.auth === "none"
              ? "Claude Code runs on credentials you provide: this computer holds no key of ours."
              : "Whose credentials Claude Code runs on will show once the computer is on the newest image."}
      </p>
      <Ports ports={now.ports} sharing={sharing} />
    </div>
  );
}

// One measure: the number now, what it is of, and the last minute of it
// drawn on a fixed scale from nothing to everything, so a flat line low
// down means idle and one along the top means full.
function Live({
  title,
  value,
  of,
  field,
  samples,
}: {
  title: string;
  value: string;
  of: string;
  field: "cpu" | "memory";
  samples: Sample[];
}) {
  const at = (ms: number) =>
    new Date(ms).toLocaleTimeString(undefined, { timeStyle: "medium" });
  return (
    <Card size="sm">
      <CardContent className="space-y-2">
        <div>
          <p className="text-muted-foreground text-sm">{title}</p>
          <p className="text-2xl font-semibold tabular-nums">{value}</p>
          <p className="text-muted-foreground text-sm">{of}</p>
        </div>
        <ChartContainer config={chart} className="h-16 w-full">
          <AreaChart
            data={samples}
            margin={{ top: 8, right: 0, bottom: 1, left: 0 }}
          >
            <XAxis
              dataKey="at"
              type="number"
              domain={["dataMin", "dataMax"]}
              hide
            />
            <YAxis domain={[0, 100]} hide />
            <ReferenceLine
              y={100}
              stroke="var(--border)"
              label={{
                value: "100%",
                position: "insideTopRight",
                fontSize: 10,
                fill: "var(--muted-foreground)",
              }}
            />
            <ReferenceLine
              y={50}
              stroke="var(--border)"
              strokeDasharray="2 3"
            />
            <ChartTooltip
              cursor={{ stroke: "var(--border)" }}
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
              fillOpacity={0.12}
              baseValue={0}
              isAnimationActive={false}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </AreaChart>
        </ChartContainer>
        <p className="text-muted-foreground text-xs">The last minute.</p>
      </CardContent>
    </Card>
  );
}
