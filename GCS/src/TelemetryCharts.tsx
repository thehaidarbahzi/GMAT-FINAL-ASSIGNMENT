// Flight data charts: acceleration, relative altitude, roll/pitch and RSSI over time.
//
// Plain SVG, no chart library. All four charts share one time axis, one range
// filter and one crosshair, so hovering a moment in one chart shows that same
// packet in the others. A table view lists the same values without hovering.

import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { fmt, signed } from "./telemetry";

export type ChartSample = {
  // Seconds since the session started, from the payload clock (survives reboots)
  t: number;
  accelX: number;
  accelY: number;
  accelZ: number;
  accelMag: number;
  // Absolute ISA altitude; the chart subtracts the ground reference
  altitude: number;
  roll: number;
  pitch: number;
  rssi: number | null;
};

type RangeKey = "30" | "120" | "all";

const RANGES: { key: RangeKey; label: string; seconds: number | null }[] = [
  { key: "30", label: "30 s", seconds: 30 },
  { key: "120", label: "2 min", seconds: 120 },
  { key: "all", label: "All", seconds: null },
];

const TABLE_ROWS = 60;
const MARGIN = { top: 8, right: 14, bottom: 20, left: 42 };

type Series = {
  key: string;
  label: string;
  color: string;
  value: (sample: ChartSample, ground: number | null) => number;
};

type ChartDef = {
  id: string;
  title: string;
  unit: string;
  digits: number;
  minSpan: number;
  includeZero?: boolean;
  signed?: boolean;
  peak?: boolean;
  empty: string;
  series: Series[];
};

const orNaN = (value: number | null) => (value === null ? Number.NaN : value);

const CHARTS: ChartDef[] = [
  {
    id: "chart-accel",
    title: "Acceleration",
    unit: "g",
    digits: 2,
    minSpan: 0.5,
    signed: true,
    empty: "No IMU data in this range.",
    series: [
      { key: "mag", label: "|a|", color: "var(--series-1)", value: (s) => s.accelMag },
      { key: "x", label: "X", color: "var(--series-2)", value: (s) => s.accelX },
      { key: "y", label: "Y", color: "var(--series-3)", value: (s) => s.accelY },
      { key: "z", label: "Z", color: "var(--series-4)", value: (s) => s.accelZ },
    ],
  },
  {
    id: "chart-altitude",
    title: "Altitude, relative to start",
    unit: "m",
    digits: 1,
    minSpan: 5,
    includeZero: true,
    peak: true,
    empty: "Barometer not reporting.",
    series: [
      {
        key: "alt",
        label: "Altitude",
        color: "var(--series-1)",
        value: (s, ground) => (ground === null ? Number.NaN : s.altitude - ground),
      },
    ],
  },
  {
    id: "chart-attitude",
    title: "Roll and pitch",
    unit: "°",
    digits: 1,
    minSpan: 10,
    signed: true,
    empty: "No attitude data in this range.",
    series: [
      { key: "roll", label: "Roll", color: "var(--series-1)", value: (s) => s.roll },
      { key: "pitch", label: "Pitch", color: "var(--series-2)", value: (s) => s.pitch },
    ],
  },
  {
    id: "chart-rssi",
    title: "Signal strength",
    unit: "dBm",
    digits: 0,
    minSpan: 10,
    empty: "RSSI only arrives through the LoRa receiver.",
    series: [{ key: "rssi", label: "RSSI", color: "var(--series-1)", value: (s) => orNaN(s.rssi) }],
  },
];

// ---------------------------------------------------------------------------
// Scales

function niceStep(raw: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const n = raw / magnitude;
  const factor = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return factor * magnitude;
}

function decimalsOf(step: number): number {
  for (let digits = 0; digits < 4; digits += 1) {
    const scaled = step * 10 ** digits;
    if (Math.abs(Math.round(scaled) - scaled) < 1e-6) return digits;
  }
  return 3;
}

type YScale = { lo: number; hi: number; ticks: number[]; digits: number };

function yScale(dataLo: number, dataHi: number, def: ChartDef): YScale {
  let lo = dataLo;
  let hi = dataHi;
  if (def.includeZero) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  if (hi - lo < def.minSpan) {
    if (def.includeZero && lo >= 0) {
      hi = lo + def.minSpan;
    } else {
      const middle = (lo + hi) / 2;
      lo = middle - def.minSpan / 2;
      hi = middle + def.minSpan / 2;
    }
  }
  const step = niceStep((hi - lo) / 3);
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= end + step / 2; value += step) {
    ticks.push(Number(value.toFixed(10)));
  }
  return { lo: start, hi: end, ticks, digits: decimalsOf(step) };
}

const TIME_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

function timeTicks([start, end]: [number, number], target: number): number[] {
  const span = end - start;
  const step = TIME_STEPS.find((candidate) => span / candidate <= target) ?? 3600;
  const ticks: number[] = [];
  for (let value = Math.ceil(start / step) * step; value <= end; value += step) {
    ticks.push(value);
  }
  return ticks;
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

// First index whose t is >= value
function lowerBound(samples: ChartSample[], value: number): number {
  let low = 0;
  let high = samples.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (samples[middle].t < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function nearestIndex(samples: ChartSample[], t: number): number {
  if (samples.length === 0) return -1;
  const index = lowerBound(samples, t);
  if (index <= 0) return 0;
  if (index >= samples.length) return samples.length - 1;
  return t - samples[index - 1].t <= samples[index].t - t ? index - 1 : index;
}

// Line path with min/max decimation per bucket, so spikes survive long ranges.
// Non-finite values break the line instead of drawing to zero.
function buildPath(
  samples: ChartSample[],
  get: (sample: ChartSample) => number,
  sx: (t: number) => number,
  sy: (v: number) => number,
  maxBuckets: number,
): string {
  const parts: string[] = [];
  let pen = false;
  const emit = (sample: ChartSample, value: number) => {
    parts.push(`${pen ? "L" : "M"}${sx(sample.t).toFixed(1)},${sy(value).toFixed(1)}`);
    pen = true;
  };

  const chunk = Math.max(1, Math.ceil(samples.length / Math.max(1, maxBuckets)));
  for (let start = 0; start < samples.length; start += chunk) {
    const stop = Math.min(start + chunk, samples.length);
    let minIndex = -1;
    let maxIndex = -1;
    let minValue = Infinity;
    let maxValue = -Infinity;
    let gap = false;
    for (let index = start; index < stop; index += 1) {
      const value = get(samples[index]);
      if (!Number.isFinite(value)) {
        gap = true;
        continue;
      }
      if (value < minValue) {
        minValue = value;
        minIndex = index;
      }
      if (value > maxValue) {
        maxValue = value;
        maxIndex = index;
      }
    }
    if (minIndex < 0) {
      pen = false;
      continue;
    }
    const first = Math.min(minIndex, maxIndex);
    const second = Math.max(minIndex, maxIndex);
    emit(samples[first], get(samples[first]));
    if (second !== first) emit(samples[second], get(samples[second]));
    if (gap) pen = false;
  }
  return parts.join("");
}

// Highest point of a series; only worth marking once the vehicle has actually climbed
function findPeak(
  samples: ChartSample[],
  get: (sample: ChartSample) => number,
): { t: number; value: number } | null {
  let best: { t: number; value: number } | null = null;
  for (const sample of samples) {
    const value = get(sample);
    if (Number.isFinite(value) && (best === null || value > best.value)) {
      best = { t: sample.t, value };
    }
  }
  return best !== null && best.value >= 1 ? best : null;
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      setSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

function formatValue(def: ChartDef, value: number): string {
  return def.signed ? signed(value, def.digits) : fmt(value, def.digits);
}

// ---------------------------------------------------------------------------
// One chart

type ChartProps = {
  def: ChartDef;
  visible: ChartSample[];
  domain: [number, number];
  ground: number | null;
  hoverT: number | null;
  onHover: (t: number | null) => void;
};

function Chart({ def, visible, domain, ground, hoverT, onHover }: ChartProps) {
  const [plotRef, { width, height }] = useSize<HTMLDivElement>();
  const innerW = Math.max(1, width - MARGIN.left - MARGIN.right);
  const innerH = Math.max(1, height - MARGIN.top - MARGIN.bottom);
  const single = def.series.length === 1;

  const geometry = useMemo(() => {
    if (!width || !height) return null;

    let lo = Infinity;
    let hi = -Infinity;
    for (const sample of visible) {
      for (const series of def.series) {
        const value = series.value(sample, ground);
        if (Number.isFinite(value)) {
          if (value < lo) lo = value;
          if (value > hi) hi = value;
        }
      }
    }
    if (lo > hi) return null;

    const scale = yScale(lo, hi, def);
    const span = Math.max(domain[1] - domain[0], 1e-6);
    const sx = (t: number) => MARGIN.left + ((t - domain[0]) / span) * innerW;
    const sy = (v: number) => MARGIN.top + (1 - (v - scale.lo) / (scale.hi - scale.lo)) * innerH;

    const lines = def.series.map((series) => {
      const get = (sample: ChartSample) => series.value(sample, ground);
      let end: { x: number; y: number } | null = null;
      for (let index = visible.length - 1; index >= 0; index -= 1) {
        const value = get(visible[index]);
        if (Number.isFinite(value)) {
          end = { x: sx(visible[index].t), y: sy(value) };
          break;
        }
      }
      return {
        series,
        d: buildPath(visible, get, sx, sy, innerW),
        end,
      };
    });

    const peak = def.peak ? findPeak(visible, (sample) => def.series[0].value(sample, ground)) : null;

    return {
      scale,
      sx,
      sy,
      lines,
      peak: peak ? { x: sx(peak.t), y: sy(peak.value), value: peak.value } : null,
      xTicks: timeTicks(domain, Math.max(2, Math.floor(innerW / 80))),
    };
  }, [width, height, innerW, innerH, visible, domain, ground, def]);

  const hoverIndex = hoverT === null ? -1 : nearestIndex(visible, hoverT);
  const hovered = hoverIndex >= 0 ? visible[hoverIndex] : null;

  // Latest finite value, shown in the header of single-series charts
  let latest = Number.NaN;
  for (let index = visible.length - 1; index >= 0; index -= 1) {
    const value = def.series[0].value(visible[index], ground);
    if (Number.isFinite(value)) {
      latest = value;
      break;
    }
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (visible.length === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left - MARGIN.left) / innerW;
    const clamped = Math.min(1, Math.max(0, ratio));
    onHover(domain[0] + clamped * (domain[1] - domain[0]));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (visible.length === 0) return;
    const current = hoverIndex >= 0 ? hoverIndex : visible.length - 1;
    let next: number | null = null;
    if (event.key === "ArrowLeft") next = Math.max(0, current - 1);
    else if (event.key === "ArrowRight") next = Math.min(visible.length - 1, current + 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = visible.length - 1;
    else if (event.key === "Escape") {
      onHover(null);
      return;
    }
    if (next !== null) {
      event.preventDefault();
      onHover(visible[next].t);
    }
  };

  const crossX = hovered && geometry ? geometry.sx(hovered.t) : null;
  const tooltipLeft = crossX !== null && crossX > width / 2;

  return (
    <figure className="chart" aria-labelledby={`${def.id}-title`}>
      <figcaption className="chart-head">
        <span className="chart-title" id={`${def.id}-title`}>
          {def.title}
        </span>
        {single ? (
          <span className="chart-now">
            {formatValue(def, latest)}
            <span>{def.unit}</span>
          </span>
        ) : (
          <span className="chart-legend">
            {def.series.map((series) => (
              <span className="chart-legend-item" key={series.key}>
                <i style={{ background: series.color }} aria-hidden="true" />
                {series.label}
              </span>
            ))}
            <span className="chart-legend-unit">{def.unit}</span>
          </span>
        )}
      </figcaption>

      <div
        ref={plotRef}
        className="chart-plot"
        tabIndex={visible.length ? 0 : -1}
        aria-label={`${def.title} over time. Arrow keys step through packets; the table view lists the same values.`}
        onPointerMove={onPointerMove}
        onPointerLeave={() => onHover(null)}
        onFocus={() => {
          if (hoverT === null && visible.length) onHover(visible[visible.length - 1].t);
        }}
        onBlur={() => onHover(null)}
        onKeyDown={onKeyDown}
      >
        {geometry ? (
          <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
            {geometry.scale.ticks.map((tick) => (
              <g key={`y${tick}`}>
                <line
                  className={tick === 0 && geometry.scale.lo < 0 ? "chart-zero" : "chart-grid"}
                  x1={MARGIN.left}
                  x2={width - MARGIN.right}
                  y1={geometry.sy(tick)}
                  y2={geometry.sy(tick)}
                />
                <text
                  className="chart-tick"
                  x={MARGIN.left - 6}
                  y={geometry.sy(tick)}
                  textAnchor="end"
                  dominantBaseline="middle"
                >
                  {tick.toFixed(geometry.scale.digits)}
                </text>
              </g>
            ))}
            {geometry.xTicks.map((tick) => (
              <text
                key={`x${tick}`}
                className="chart-tick"
                x={geometry.sx(tick)}
                y={height - 5}
                textAnchor="middle"
              >
                {formatTime(tick)}
              </text>
            ))}

            {geometry.lines.map(({ series, d }) => (
              <path key={series.key} className="chart-line" d={d} style={{ stroke: series.color }} />
            ))}

            {geometry.peak ? (
              <g>
                <circle
                  className="chart-dot"
                  cx={geometry.peak.x}
                  cy={geometry.peak.y}
                  r={4}
                  style={{ fill: def.series[0].color }}
                />
                <text
                  className="chart-annot"
                  x={geometry.peak.x + (geometry.peak.x > width - 110 ? -8 : 8)}
                  y={Math.max(geometry.peak.y, MARGIN.top + 10)}
                  textAnchor={geometry.peak.x > width - 110 ? "end" : "start"}
                  dominantBaseline="middle"
                >
                  peak {fmt(geometry.peak.value, def.digits)} {def.unit}
                </text>
              </g>
            ) : null}

            {crossX === null
              ? geometry.lines.map(({ series, end }) =>
                  end ? (
                    <circle
                      key={`end-${series.key}`}
                      className="chart-dot"
                      cx={end.x}
                      cy={end.y}
                      r={4}
                      style={{ fill: series.color }}
                    />
                  ) : null,
                )
              : null}

            {crossX !== null && hovered ? (
              <g>
                <line
                  className="chart-cross"
                  x1={crossX}
                  x2={crossX}
                  y1={MARGIN.top}
                  y2={height - MARGIN.bottom}
                />
                {def.series.map((series) => {
                  const value = series.value(hovered, ground);
                  return Number.isFinite(value) ? (
                    <circle
                      key={`hover-${series.key}`}
                      className="chart-dot"
                      cx={crossX}
                      cy={geometry.sy(value)}
                      r={4}
                      style={{ fill: series.color }}
                    />
                  ) : null;
                })}
              </g>
            ) : null}
          </svg>
        ) : (
          <p className="chart-empty">{visible.length ? def.empty : "Waiting for data."}</p>
        )}

        {crossX !== null && hovered ? (
          <div
            className="chart-tooltip"
            data-side={tooltipLeft ? "left" : "right"}
            style={{ left: tooltipLeft ? crossX - 10 : crossX + 10 }}
          >
            <div className="chart-tooltip-time">T+{hovered.t.toFixed(1)} s</div>
            {def.series.map((series) => (
              <div className="chart-tooltip-row" key={series.key}>
                <i style={{ background: series.color }} aria-hidden="true" />
                <strong>{formatValue(def, series.value(hovered, ground))}</strong>
                <span>
                  {series.label} · {def.unit}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Table view: the same values, readable without hovering

function ChartTable({ visible, ground }: { visible: ChartSample[]; ground: number | null }) {
  const rows = visible.slice(-TABLE_ROWS).reverse();
  return (
    <div className="chart-table-wrap">
      <table className="chart-table">
        <caption>
          Latest {rows.length} of {visible.length} packets in this range. Download CSV for the full
          log.
        </caption>
        <thead>
          <tr>
            <th scope="col">Time s</th>
            <th scope="col">|a| g</th>
            <th scope="col">X g</th>
            <th scope="col">Y g</th>
            <th scope="col">Z g</th>
            <th scope="col">Alt m</th>
            <th scope="col">Roll °</th>
            <th scope="col">Pitch °</th>
            <th scope="col">RSSI dBm</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((sample) => (
            <tr key={sample.t}>
              <td>{sample.t.toFixed(1)}</td>
              <td>{fmt(sample.accelMag, 2)}</td>
              <td>{signed(sample.accelX, 2)}</td>
              <td>{signed(sample.accelY, 2)}</td>
              <td>{signed(sample.accelZ, 2)}</td>
              <td>{fmt(ground === null ? Number.NaN : sample.altitude - ground, 1)}</td>
              <td>{signed(sample.roll, 1)}</td>
              <td>{signed(sample.pitch, 1)}</td>
              <td>{sample.rssi === null ? "—" : sample.rssi}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Charts section

type TelemetryChartsProps = {
  // Mutated in place by the app; `version` changes whenever it does
  samples: ChartSample[];
  version: number;
  ground: number | null;
};

export const TelemetryCharts = memo(function TelemetryCharts({
  samples,
  version,
  ground,
}: TelemetryChartsProps) {
  const [range, setRange] = useState<RangeKey>("30");
  const [view, setView] = useState<"chart" | "table">("chart");
  const [hoverT, setHoverT] = useState<number | null>(null);

  const { visible, domain } = useMemo(() => {
    void version; // samples is mutated in place, version marks each change
    if (samples.length === 0) {
      return { visible: [] as ChartSample[], domain: [0, 30] as [number, number] };
    }
    const first = samples[0].t;
    const last = samples[samples.length - 1].t;
    const seconds = RANGES.find((entry) => entry.key === range)?.seconds ?? null;
    const start = seconds === null ? first : Math.max(first, last - seconds);
    const end = Math.max(last, start + 1);
    return {
      visible: samples.slice(lowerBound(samples, start)),
      domain: [start, end] as [number, number],
    };
  }, [samples, version, range]);

  return (
    <section className="telemetry-charts" aria-labelledby="charts-title">
      <div className="charts-toolbar">
        <h3 id="charts-title">Flight data</h3>
        <div className="segmented" role="group" aria-label="Time range">
          {RANGES.map((entry) => (
            <button
              key={entry.key}
              type="button"
              aria-pressed={range === entry.key}
              onClick={() => setRange(entry.key)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label="View">
          <button type="button" aria-pressed={view === "chart"} onClick={() => setView("chart")}>
            Charts
          </button>
          <button type="button" aria-pressed={view === "table"} onClick={() => setView("table")}>
            Table
          </button>
        </div>
        <span className="group-note charts-count">{visible.length} packets</span>
      </div>

      {view === "chart" ? (
        <div className="charts-grid">
          {CHARTS.map((def) => (
            <Chart
              key={def.id}
              def={def}
              visible={visible}
              domain={domain}
              ground={ground}
              hoverT={hoverT}
              onHover={setHoverT}
            />
          ))}
        </div>
      ) : (
        <ChartTable visible={visible} ground={ground} />
      )}
    </section>
  );
});
