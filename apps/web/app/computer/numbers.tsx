"use client";

import { useEffect, useState } from "react";
import { Area, AreaChart, YAxis } from "recharts";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";

type Stats = {
  cpu: number;
  memory: { used: number; total: number };
  used: number | null;
  disk: number | null;
  ports: { port: number; name: string }[];
};

// One reading kept per ask, a minute's worth on screen.
type Sample = { at: number; cpu: number; memory: number };
const EVERY = 5000;
const KEEP = 60_000 / EVERY;

const gb = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`;

const cpuChart = {
  cpu: { label: "CPU", color: "var(--chart-1)" },
} satisfies ChartConfig;
const memoryChart = {
  memory: { label: "Memory", color: "var(--chart-2)" },
} satisfies ChartConfig;

// The computer's live numbers: CPU and memory over the last minute, the
// bytes used, and the ports listening inside, each a link that opens it.
export function Numbers() {
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Live
          title={`CPU ${now.cpu}%`}
          config={cpuChart}
          field="cpu"
          samples={samples}
        />
        <Live
          title={`Memory ${gb(now.memory.used)}`}
          config={memoryChart}
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
      {now.ports.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-medium">Open ports</p>
          <ul className="text-sm">
            {now.ports.map((p) => (
              <li key={p.port}>
                <a
                  className="underline underline-offset-4"
                  href={`/computer/open?to=/proxy/${p.port}/`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {p.port}
                </a>
                {p.name && (
                  <span className="text-muted-foreground"> {p.name}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Live({
  title,
  config,
  field,
  samples,
}: {
  title: string;
  config: ChartConfig;
  field: "cpu" | "memory";
  samples: Sample[];
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={config} className="h-24 w-full">
          <AreaChart
            data={samples}
            margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
          >
            <YAxis domain={[0, 100]} hide />
            <Area
              dataKey={field}
              type="monotone"
              stroke={`var(--color-${field})`}
              fill={`var(--color-${field})`}
              fillOpacity={0.2}
              isAnimationActive={false}
              dot={false}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
