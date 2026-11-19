import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { RocketScene, type Attitude } from "./RocketScene";
import { TelemetryCharts, type ChartSample } from "./TelemetryCharts";
import {
  DEMO_INTERVAL_MS,
  buildCommand,
  createDemoFeed,
  fmt,
  formatClock,
  hectopascal,
  parseEjectLine,
  parseLine,
  rssiQuality,
  signed,
  toCsv,
  wrapDegrees,
  type EjectCommand,
  type EjectState,
  type LoggedRow,
  type Reading,
} from "./telemetry";
import "./App.css";

const BAUD_RATE = 115200;
const DEMO_PORT = "__demo__";
const TAPE_SPAN = 50;
const TAPE_STEP = 10;
const LOG_LINES = 200;
const HISTORY_LIMIT = 20000;
const STALE_MS = 3500;
const PROBLEM_MS = 6000;
const RAD_TO_DEG = 180 / Math.PI;
// The eject board reports its state every second; older than this means it is gone
const EJECT_STALE_MS = 3000;

const TAURI = isTauri();

type EjectStatus = { state: EjectState; remainingMs: number; at: number };

type PortInfo = { name: string; description: string };

type SerialStatusEvent = {
  state: "connected" | "disconnected" | "error";
  port: string;
  message: string;
};

type Link =
  | { state: "idle"; port: null; message: string }
  | { state: "connecting" | "live" | "error"; port: string; message: string }
  | { state: "demo"; port: null; message: string };

type Derived = {
  relAltitude: number | null;
  maxRelAltitude: number | null;
  yaw: number;
  // ISA altitude treated as 0 m (first reading, or "Set zero")
  ground: number | null;
};

// Counted by the GCS itself (used when the payload is plugged in directly)
type LocalStats = {
  received: number;
  lost: number;
  bad: number;
  lastAt: number | null;
  rateHz: number | null;
};

const IDLE_LINK: Link = { state: "idle", port: null, message: "" };
const EMPTY_STATS: LocalStats = { received: 0, lost: 0, bad: 0, lastAt: null, rateHz: null };
const EMPTY_DERIVED: Derived = { relAltitude: null, maxRelAltitude: null, yaw: 0, ground: null };
// Fallback step for the chart clock when the payload clock jumps back (reboot)
const CHART_FALLBACK_DT = DEMO_INTERVAL_MS / 1000;

function pickPort(ports: PortInfo[]): string {
  const preferred = ports.find((port) =>
    /cp210|ch34|ch910|usb.*uart|silicon labs|usb serial|esp32/i.test(port.description),
  );
  return (preferred ?? ports[0])?.name ?? DEMO_PORT;
}

function AltitudeTape({ altitude }: { altitude: number }) {
  const base = Math.floor((altitude - TAPE_SPAN / 2) / TAPE_STEP) * TAPE_STEP;
  const ticks: { value: number; position: number }[] = [];

  for (let value = base; value <= base + TAPE_SPAN + TAPE_STEP; value += TAPE_STEP) {
    const position = 50 - ((value - altitude) / TAPE_SPAN) * 100;
    if (position >= -6 && position <= 106) {
      ticks.push({ value, position });
    }
  }

  return (
    <div className="altitude-tape" aria-hidden="true">
      {ticks.map((tick) => (
        <div className="tape-tick" key={tick.value} style={{ top: `${tick.position}%` }}>
          <span>{tick.value}</span>
          <i />
        </div>
      ))}
      <div className="tape-cursor" />
    </div>
  );
}

function Stat({ title, value, unit }: { title: string; value: string; unit: string }) {
  return (
    <div className="stat">
      <div className="stat-title">{title}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-desc">{unit}</div>
    </div>
  );
}

function Group({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <section className="readout-group" aria-labelledby={id}>
      <div className="group-head">
        <h3 id={id}>{title}</h3>
        <span className="group-note">{note}</span>
      </div>
      <div className="stats telemetry-stats">{children}</div>
    </section>
  );
}

function App() {
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [selectedPort, setSelectedPort] = useState<string>(DEMO_PORT);
  const [link, setLink] = useState<Link>(
    TAURI ? IDLE_LINK : { state: "demo", port: null, message: "Simulated receiver output" },
  );
  const [reading, setReading] = useState<Reading | null>(null);
  const [derived, setDerived] = useState<Derived>(EMPTY_DERIVED);
  const [stats, setStats] = useState<LocalStats>(EMPTY_STATS);
  const [problem, setProblem] = useState<{ text: string; at: number } | null>(null);
  const [chartVersion, setChartVersion] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [rowCount, setRowCount] = useState(0);
  const [downloadNote, setDownloadNote] = useState<string | null>(null);
  const [now, setNow] = useState(() => performance.now());
  const [eject, setEject] = useState<EjectStatus | null>(null);
  const [ejectNote, setEjectNote] = useState<{ text: string; tone: "ok" | "bad" } | null>(null);
  const [noseconeFired, setNoseconeFired] = useState(false);

  const lastReadingRef = useRef<Reading | null>(null);
  const groundAltitudeRef = useRef<number | null>(null);
  const maxAltitudeRef = useRef<number | null>(null);
  const yawRef = useRef(0);
  // Gyro offset measured by "Set zero" while the board is still (rad/s)
  const gyroBiasRef = useRef({ x: 0, y: 0, z: 0 });
  const arrivalsRef = useRef<number[]>([]);
  const historyRef = useRef<LoggedRow[]>([]);
  // Chart time series for this session, t in seconds from the payload clock
  const samplesRef = useRef<ChartSample[]>([]);
  const chartClockRef = useRef<{ t: number; millis: number } | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  const resetSession = useCallback(() => {
    lastReadingRef.current = null;
    groundAltitudeRef.current = null;
    maxAltitudeRef.current = null;
    yawRef.current = 0;
    gyroBiasRef.current = { x: 0, y: 0, z: 0 };
    arrivalsRef.current = [];
    samplesRef.current = [];
    chartClockRef.current = null;
    setChartVersion((current) => current + 1);
    setReading(null);
    setDerived(EMPTY_DERIVED);
    setStats(EMPTY_STATS);
    setProblem(null);
    setEject(null);
    setEjectNote(null);
    setNoseconeFired(false);
  }, []);

  const ingest = useCallback((next: Reading) => {
    const arrival = performance.now();
    const previous = lastReadingRef.current;
    let lostNow = 0;

    if (previous) {
      if (next.packetID > previous.packetID + 1) {
        lostNow = next.packetID - previous.packetID - 1;
      }

      if (next.millis > previous.millis) {
        // Yaw is not sent by the firmware: integrate the averaged gyroZ over the batch interval
        const dt = Math.min((next.millis - previous.millis) / 1000, 5);
        if (Number.isFinite(next.gyroZ)) {
          const rate = next.gyroZ - gyroBiasRef.current.z;
          yawRef.current = wrapDegrees(yawRef.current + rate * RAD_TO_DEG * dt);
        }
      } else {
        // Payload rebooted
        yawRef.current = 0;
      }
    }
    lastReadingRef.current = next;

    if (groundAltitudeRef.current === null && Number.isFinite(next.altitude)) {
      groundAltitudeRef.current = next.altitude;
    }
    const relAltitude =
      groundAltitudeRef.current !== null && Number.isFinite(next.altitude)
        ? next.altitude - groundAltitudeRef.current
        : null;
    if (relAltitude !== null) {
      maxAltitudeRef.current = Math.max(maxAltitudeRef.current ?? relAltitude, relAltitude);
    }

    const arrivals = [...arrivalsRef.current, arrival].slice(-10);
    arrivalsRef.current = arrivals;
    const span = (arrivals[arrivals.length - 1] - arrivals[0]) / 1000;
    const rateHz = arrivals.length > 1 && span > 0 ? (arrivals.length - 1) / span : null;

    setReading(next);
    setDerived({
      relAltitude,
      maxRelAltitude: maxAltitudeRef.current,
      yaw: yawRef.current,
      ground: groundAltitudeRef.current,
    });
    setStats((current) => ({
      ...current,
      received: current.received + 1,
      lost: current.lost + lostNow,
      lastAt: arrival,
      rateHz,
    }));

    // Chart clock: follow the payload millis, keep moving forward if it reboots
    const clock = chartClockRef.current;
    const t =
      clock === null
        ? 0
        : clock.t + (next.millis > clock.millis ? (next.millis - clock.millis) / 1000 : CHART_FALLBACK_DT);
    chartClockRef.current = { t, millis: next.millis };
    samplesRef.current.push({
      t,
      accelX: next.accelX,
      accelY: next.accelY,
      accelZ: next.accelZ,
      accelMag: Math.hypot(next.accelX, next.accelY, next.accelZ),
      altitude: next.altitude,
      roll: next.roll,
      pitch: next.pitch,
      rssi: next.rssi,
    });
    if (samplesRef.current.length > HISTORY_LIMIT) {
      samplesRef.current.splice(0, samplesRef.current.length - HISTORY_LIMIT);
    }
    setChartVersion((current) => current + 1);

    historyRef.current.push({
      receivedAt: new Date().toISOString(),
      reading: next,
      relAltitude,
      yaw: yawRef.current,
    });
    if (historyRef.current.length > HISTORY_LIMIT) {
      historyRef.current.splice(0, historyRef.current.length - HISTORY_LIMIT);
    }
    setRowCount(historyRef.current.length);
  }, []);

  const handleLine = useCallback(
    (line: string) => {
      const ejectLine = parseEjectLine(line);
      if (ejectLine) {
        const at = performance.now();
        if (ejectLine.kind === "state") {
          setEject({ state: ejectLine.state, remainingMs: ejectLine.remainingMs, at });
          // Periodic heartbeat, keep it out of the log
          return;
        }
        if (ejectLine.kind === "fired") {
          setNoseconeFired(true);
          setEjectNote({ text: `Nosecone fired (${ejectLine.pulseMs} ms pulse).`, tone: "ok" });
        } else {
          setEjectNote({ text: `Eject board refused: ${ejectLine.reason}.`, tone: "bad" });
        }
        setLog((current) => [...current.slice(-(LOG_LINES - 1)), line]);
        return;
      }

      setLog((current) => [...current.slice(-(LOG_LINES - 1)), line]);
      const parsed = parseLine(line);
      if (parsed.kind === "reading") {
        ingest(parsed.reading);
      } else if (parsed.kind === "bad") {
        setStats((current) => ({ ...current, bad: current.bad + 1 }));
        setProblem({ text: parsed.reason, at: performance.now() });
      }
    },
    [ingest],
  );

  const handleLineRef = useRef(handleLine);
  useEffect(() => {
    handleLineRef.current = handleLine;
  }, [handleLine]);

  // Serial events from the Rust backend
  useEffect(() => {
    if (!TAURI) return;
    let disposed = false;
    const unlisteners: UnlistenFn[] = [];

    Promise.all([
      listen<string>("serial-line", (event) => handleLineRef.current(event.payload)),
      listen<SerialStatusEvent>("serial-status", ({ payload }) => {
        setLink((current) => {
          if (current.port !== payload.port) return current;
          if (payload.state === "connected") {
            return { state: "live", port: payload.port, message: payload.message };
          }
          if (payload.state === "error") {
            return { state: "error", port: payload.port, message: payload.message };
          }
          return IDLE_LINK;
        });
      }),
    ]).then((fns) => {
      if (disposed) fns.forEach((fn) => fn());
      else unlisteners.push(...fns);
    });

    return () => {
      disposed = true;
      unlisteners.forEach((fn) => fn());
    };
  }, []);

  // Demo feed, same line format as the receiver
  useEffect(() => {
    if (link.state !== "demo") return;
    const feed = createDemoFeed();
    const id = window.setInterval(() => {
      feed().forEach((line) => handleLineRef.current(line));
    }, DEMO_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [link.state]);

  // Clock for "last packet" age
  useEffect(() => {
    const id = window.setInterval(() => setNow(performance.now()), 500);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!downloadNote) return;
    const id = window.setTimeout(() => setDownloadNote(null), 4000);
    return () => window.clearTimeout(id);
  }, [downloadNote]);

  useEffect(() => {
    const element = logRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [log]);

  const refreshPorts = useCallback(async () => {
    if (!TAURI) return;
    try {
      const found = await invoke<PortInfo[]>("list_serial_ports");
      setPorts(found);
      setSelectedPort((current) =>
        current !== DEMO_PORT && found.some((port) => port.name === current)
          ? current
          : pickPort(found),
      );
    } catch (error) {
      setProblem({ text: `Could not list ports: ${String(error)}`, at: performance.now() });
    }
  }, []);

  useEffect(() => {
    void refreshPorts();
  }, [refreshPorts]);

  const connect = async () => {
    resetSession();
    if (selectedPort === DEMO_PORT) {
      setLink({ state: "demo", port: null, message: "Simulated receiver output" });
      return;
    }
    setLink({ state: "connecting", port: selectedPort, message: `Opening ${selectedPort}…` });
    try {
      await invoke("connect_serial", { port: selectedPort, baud: BAUD_RATE });
    } catch (error) {
      setLink({ state: "error", port: selectedPort, message: String(error) });
    }
  };

  const disconnect = async () => {
    if (TAURI && link.state !== "demo") {
      await invoke("disconnect_serial").catch(() => undefined);
    }
    setLink(IDLE_LINK);
  };

  const sendEject = async (command: EjectCommand) => {
    if (!TAURI || link.state !== "live") return;
    const packet = buildCommand(command);
    setLog((current) => [...current.slice(-(LOG_LINES - 1)), `> ${packet}`]);
    try {
      await invoke("send_serial", { line: packet });
      if (command !== "STATUS") setEjectNote(null);
    } catch (error) {
      setEjectNote({ text: String(error), tone: "bad" });
    }
  };

  const setZero = () => {
    const latest = lastReadingRef.current;
    groundAltitudeRef.current =
      latest && Number.isFinite(latest.altitude) ? latest.altitude : null;
    maxAltitudeRef.current = groundAltitudeRef.current === null ? null : 0;
    yawRef.current = 0;
    if (latest && [latest.gyroX, latest.gyroY, latest.gyroZ].every(Number.isFinite)) {
      gyroBiasRef.current = { x: latest.gyroX, y: latest.gyroY, z: latest.gyroZ };
    }
    setDerived({
      relAltitude: groundAltitudeRef.current === null ? null : 0,
      maxRelAltitude: maxAltitudeRef.current,
      yaw: 0,
      ground: groundAltitudeRef.current,
    });
  };

  const downloadCsv = async () => {
    const rows = historyRef.current;
    if (rows.length === 0) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `gcs-telemetry-${stamp}.csv`;

    // Desktop app: native "Save as" dialog, the file is written by Rust (save_csv)
    if (TAURI) {
      try {
        const saved = await invoke<string | null>("save_csv", {
          fileName,
          contents: `﻿${toCsv(rows)}`,
        });
        if (saved) setDownloadNote(`CSV saved, ${rows.length} rows: ${saved}`);
      } catch (error) {
        setProblem({ text: `Could not save CSV: ${String(error)}`, at: performance.now() });
      }
      return;
    }

    // Browser (pnpm dev): regular download

    const blob = new Blob(["﻿", toCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setDownloadNote(`CSV saved, ${rows.length} rows.`);
  };

  const active = link.state === "live" || link.state === "demo" || link.state === "connecting";
  const ageMs = stats.lastAt === null ? null : now - stats.lastAt;
  const stale = active && ageMs !== null && ageMs > STALE_MS;
  const recentProblem = problem && now - problem.at < PROBLEM_MS ? problem.text : null;
  const fromReceiver = reading?.source === "receiver";
  const sourceLabel = reading ? reading.layout : "";

  let statusText: string;
  let statusTone: "muted" | "ok" | "warn" | "bad" = "muted";
  if (downloadNote) {
    statusText = downloadNote;
  } else if (link.state === "error") {
    statusText = link.message;
    statusTone = "bad";
  } else if (link.state === "idle") {
    statusText = "Pick the ESP32's COM port, then connect.";
  } else if (link.state === "connecting") {
    statusText = link.message;
  } else if (stats.lastAt === null) {
    statusText = recentProblem ?? "Connected. Waiting for the first packet.";
    statusTone = recentProblem ? "warn" : "muted";
  } else if (stale) {
    statusText = `No packet for ${((ageMs ?? 0) / 1000).toFixed(0)} s.`;
    statusTone = "warn";
  } else if (recentProblem) {
    statusText = recentProblem;
    statusTone = "warn";
  } else {
    statusText = `Receiving: ${sourceLabel}.`;
    statusTone = "ok";
  }

  const badge =
    link.state === "demo"
      ? { text: "Demo feed", tone: "cool" }
      : link.state === "live"
        ? { text: `Live · ${link.port}`, tone: stale ? "warn" : "ok" }
        : link.state === "connecting"
          ? { text: "Connecting", tone: "cool" }
          : link.state === "error"
            ? { text: "Error", tone: "bad" }
            : { text: "Disconnected", tone: "muted" };

  const attitude: Attitude | null = reading
    ? { roll: reading.roll, pitch: reading.pitch, yaw: derived.yaw }
    : null;
  const altitude = derived.relAltitude ?? 0;
  const hPa = reading ? hectopascal(reading.pressure) : null;
  const rssi = reading?.rssi ?? null;

  // Packet counters: the receiver's own numbers when available, otherwise counted here
  const counters =
    reading && fromReceiver && reading.receivedCount !== null
      ? {
          received: reading.receivedCount,
          lost: reading.lostCount ?? 0,
          bad: reading.badCount ?? 0,
          total: reading.totalPacket ?? reading.receivedCount + (reading.lostCount ?? 0),
        }
      : {
          received: stats.received,
          lost: stats.lost,
          bad: stats.bad,
          total: stats.received + stats.lost,
        };
  const { received, lost, bad, total } = counters;
  const successPct = total > 0 ? (100 * received) / total : null;

  // Nosecone eject panel
  const ejectOnline = link.state === "live" && eject !== null && now - eject.at < EJECT_STALE_MS;
  const ejectState = ejectOnline ? eject.state : null;
  const ejectLeftS = eject ? Math.max(0, (eject.remainingMs - (now - eject.at)) / 1000) : 0;
  const ejectLabel =
    link.state !== "live"
      ? "connect to the eject board"
      : !ejectOnline
        ? "eject board not responding"
        : ejectState === "ARMED"
          ? `ARMED · auto-disarm in ${ejectLeftS.toFixed(0)} s`
          : ejectState === "COUNTDOWN"
            ? `COUNTDOWN · T-${ejectLeftS.toFixed(1)} s`
            : ejectState === "FIRING"
              ? "FIRING · GPIO25 on"
              : "SAFE";

  return (
    <div className="gcs-app">
      <header className="app-header">
        <div className="brand">
          <h1>Ground control</h1>
          <span className="vehicle">Vehicle 01</span>
        </div>
        <div className="header-meta">
          <span className="clock" title="Payload uptime (millis)">
            <span className="clock-prefix">UP</span>
            {formatClock((reading?.millis ?? 0) / 1000)}
          </span>
        </div>
      </header>

      <main className="app-main">
        <div className="vehicle-column">
          <section className="scene-shell" aria-label="Vehicle view">
            <RocketScene deployed={noseconeFired} altitude={Math.max(0, altitude)} attitude={attitude} />

            <div className="scene-reading">
              <p className="scene-label">Altitude, relative to start</p>
              <p className="scene-value">
                {fmt(derived.relAltitude, 1)}
                <span>m</span>
              </p>
              <p className="scene-phase">
                {!reading
                  ? "No data yet"
                  : Number.isFinite(reading.pressure)
                    ? `${fmt(reading.pressure, 0)} Pa · ISA ${fmt(reading.altitude, 1)} m`
                    : "Barometer not reporting"}
              </p>
            </div>

            <AltitudeTape altitude={altitude} />

            <p className="scene-hint">
              Rocket tilts with roll, pitch and yaw. Drag sideways to rotate the view.
            </p>
          </section>

          <TelemetryCharts samples={samplesRef.current} version={chartVersion} ground={derived.ground} />
        </div>

        <aside className="control-panel" aria-label="Telemetry and connection">
          <div className="panel-inner">
            <header className="panel-head">
              <div>
                <h2>Telemetry</h2>
                <p className="panel-sub">
                  {reading
                    ? `Packet #${reading.packetID} · ${fmt(stats.rateHz, 1)} Hz`
                    : "No packets yet"}
                </p>
              </div>
              <span className="badge badge-link" data-tone={badge.tone}>
                {badge.text}
              </span>
            </header>

            <section className="connection" aria-label="Connection">
              <label className="field-label" htmlFor="port-select">
                Source · {BAUD_RATE} baud
              </label>
              <div className="connection-row">
                <select
                  id="port-select"
                  className="port-select"
                  value={selectedPort}
                  onChange={(event) => setSelectedPort(event.target.value)}
                  disabled={active}
                >
                  {ports.map((port) => (
                    <option key={port.name} value={port.name}>
                      {port.name} · {port.description}
                    </option>
                  ))}
                  <option value={DEMO_PORT}>Demo feed (simulated)</option>
                </select>
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={() => void refreshPorts()}
                  disabled={!TAURI || active}
                  title={TAURI ? "Rescan COM ports" : "Serial ports need the desktop app"}
                >
                  Rescan
                </button>
              </div>
              {active ? (
                <button type="button" className="btn btn-download" onClick={() => void disconnect()}>
                  Disconnect
                </button>
              ) : (
                <button type="button" className="btn btn-eject" onClick={() => void connect()}>
                  Connect
                </button>
              )}
              {!TAURI ? (
                <p className="connection-note">
                  Running in a browser. Serial ports work in the desktop app (pnpm tauri dev).
                </p>
              ) : null}
            </section>

            <Group
              id="link-title"
              title="Signal"
              note={
                ageMs === null
                  ? "waiting"
                  : `last packet ${(ageMs / 1000).toFixed(1)} s ago`
              }
            >
              <Stat
                title="RSSI"
                value={rssi === null ? "—" : String(rssi)}
                unit={
                  rssi === null
                    ? reading && !fromReceiver
                      ? "USB direct"
                      : "dBm"
                    : `dBm · ${rssiQuality(rssi)}`
                }
              />
              <Stat
                title="Received"
                value={`${received} / ${total}`}
                unit={successPct === null ? "packets" : `${fmt(successPct, 1)}% ok`}
              />
              <Stat
                title="Lost / bad"
                value={`${lost} / ${bad}`}
                unit={fromReceiver ? "receiver" : "GCS count"}
              />
            </Group>

            <Group
              id="attitude-title"
              title="Attitude"
              note={reading?.attitudeFromGcs ? "roll/pitch: GCS calc" : "yaw: GCS calc, drifts"}
            >
              <Stat title="Roll" value={signed(attitude?.roll, 1)} unit="deg" />
              <Stat title="Pitch" value={signed(attitude?.pitch, 1)} unit="deg" />
              <Stat title="Yaw" value={signed(attitude?.yaw, 1)} unit="deg · GCS" />
            </Group>

            <Group id="accel-title" title="Acceleration" note="accelX/Y/Z · batch avg">
              <Stat title="X" value={signed(reading?.accelX, 3)} unit="g" />
              <Stat title="Y" value={signed(reading?.accelY, 3)} unit="g" />
              <Stat title="Z" value={signed(reading?.accelZ, 3)} unit="g" />
            </Group>

            <Group id="gyro-title" title="Angular rate" note="gyroX/Y/Z · batch avg">
              <Stat title="X" value={signed(reading?.gyroX, 3)} unit="rad/s" />
              <Stat title="Y" value={signed(reading?.gyroY, 3)} unit="rad/s" />
              <Stat title="Z" value={signed(reading?.gyroZ, 3)} unit="rad/s" />
            </Group>

            <Group id="baro-title" title="Barometer" note="BMP280">
              <Stat title="Pressure" value={fmt(reading?.pressure, 0)} unit={`Pa · ${fmt(hPa, 1)} hPa`} />
              <Stat title="Altitude" value={fmt(reading?.altitude, 1)} unit="m ISA" />
              <Stat title="Max rel." value={fmt(derived.maxRelAltitude, 1)} unit="m" />
            </Group>

            <Group id="temp-title" title="Temperature" note="sensor die">
              <Stat title="IMU" value={fmt(reading?.imuTemp, 2)} unit="°C · MPU6050" />
              <Stat title="Baro" value={fmt(reading?.baroTemp, 2)} unit="°C · BMP280" />
            </Group>

            <details className="serial-log">
              <summary>
                Serial output <span className="group-note">{log.length} lines</span>
              </summary>
              <pre ref={logRef}>{log.length ? log.join("\n") : "Nothing received yet."}</pre>
            </details>

            <div className="panel-actions">
              <div className="action-row">
                <button
                  type="button"
                  className="btn btn-download"
                  onClick={setZero}
                  disabled={!reading}
                  title="Keep the board still: sets altitude to 0 m, yaw to 0 and measures the gyro offset"
                >
                  Set zero
                </button>
                <button
                  type="button"
                  className="btn btn-download"
                  onClick={() => void downloadCsv()}
                  disabled={rowCount === 0}
                >
                  Download CSV
                </button>
              </div>
              <section className="eject-panel" aria-labelledby="eject-title">
                <div className="group-head">
                  <h3 id="eject-title">Nosecone eject</h3>
                  <span className="group-note" data-eject={ejectState ?? "OFFLINE"}>
                    {ejectLabel}
                  </span>
                </div>
                <div className="action-row">
                  {ejectState === "ARMED" ? (
                    <button
                      type="button"
                      className="btn btn-eject"
                      onClick={() => void sendEject("EJECT")}
                      title="Starts the countdown on the board, then GPIO25 fires"
                    >
                      Eject nosecone
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-download"
                      onClick={() => void sendEject("ARM")}
                      disabled={ejectState !== "SAFE"}
                      title="Arm first; the board disarms itself after 30 s"
                    >
                      Arm
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-download"
                    onClick={() => void sendEject("ABORT")}
                    disabled={link.state !== "live"}
                  >
                    Abort
                  </button>
                </div>
                {ejectNote ? (
                  <p className="status-line" data-tone={ejectNote.tone} role="status">
                    {ejectNote.text}
                  </p>
                ) : null}
              </section>
              <p className="status-line" data-tone={statusTone} role="status" aria-live="polite">
                {statusText}
              </p>
              <p className="meta-line">
                <span>{fmt(stats.rateHz, 1)} Hz</span>
                <span>{rowCount.toLocaleString("en-US")} rows</span>
              </p>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}

export default App;
