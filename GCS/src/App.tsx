import { useEffect, useRef, useState } from "react";
import { RocketScene } from "./RocketScene";
import {
  INITIAL_T,
  SAMPLE_HZ,
  flightAt,
  formatClock,
  makeSample,
  seedHistory,
  toCsv,
  type Deploy,
  type Sample,
} from "./telemetry";
import "./App.css";

const RESET_DELAY_MS = 3000;
const TAPE_SPAN = 50;
const TAPE_STEP = 10;
const TRAIL_POINTS = 100;

const firstFlight = makeSample(1, INITIAL_T, null, 0);
const initialSample: Sample = { ...firstFlight, apogee: firstFlight.y };

function signed(value: number, digits: number): string {
  const sign = value >= 0 ? "+" : "-";
  return `${sign}${Math.abs(value).toFixed(digits)}`;
}

function phaseLabel(sample: Sample): string {
  if (sample.phase === "ascent") return "Ascent";
  if (sample.phase === "descent") return "Descent";
  return "Landed";
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
        <div
          className="tape-tick"
          key={tick.value}
          style={{ top: `${tick.position}%` }}
        >
          <span>{tick.value}</span>
          <i />
        </div>
      ))}
      <div className="tape-cursor" />
    </div>
  );
}

function AltitudeTrace({ values }: { values: number[] }) {
  const peak = Math.max(1, ...values);
  const lastIndex = Math.max(values.length - 1, 1);
  const points = values.map((value, index) => {
    const x = (index / lastIndex) * 100;
    const y = 100 - (value / peak) * 100;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const line = points.join(" ");

  return (
    <figure className="altitude-trace" aria-hidden="true">
      <figcaption className="trace-head">
        <span className="trace-title">Altitude</span>
        <span className="group-note">
          last 20 s · {Math.round(peak)} m
        </span>
      </figcaption>
      <div className="trace-plot">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false">
          <line
            x1="0"
            y1="50"
            x2="100"
            y2="50"
            className="trace-rule"
            vectorEffect="non-scaling-stroke"
          />
          <polygon points={`0,100 ${line} 100,100`} className="trace-area" />
          <polyline
            points={line}
            className="trace-line"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
    </figure>
  );
}

function App() {
  const [sample, setSample] = useState<Sample>(initialSample);
  const [flightNo, setFlightNo] = useState(1);
  const [chute, setChute] = useState<Deploy | null>(null);
  const [rowCount, setRowCount] = useState(0);
  const [downloadNote, setDownloadNote] = useState<string | null>(null);
  const [trail, setTrail] = useState<number[]>([]);
  const [confirmAltitude, setConfirmAltitude] = useState<number | null>(null);

  const flightNoRef = useRef(1);
  const flightStartRef = useRef(performance.now() - INITIAL_T * 1000);
  const deployRef = useRef<Deploy | null>(null);
  const apogeeRef = useRef(initialSample.apogee);
  const landedAtRef = useRef<number | null>(null);
  const historyRef = useRef<Sample[]>([]);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (historyRef.current.length === 0) {
      historyRef.current = seedHistory(1, INITIAL_T);
      setRowCount(historyRef.current.length);
      setTrail(historyRef.current.slice(-TRAIL_POINTS).map((row) => row.y));
    }

    const tick = () => {
      const now = performance.now();
      let t = (now - flightStartRef.current) / 1000;
      let next = makeSample(
        flightNoRef.current,
        t,
        deployRef.current,
        apogeeRef.current,
      );

      if (next.phase === "landed") {
        if (landedAtRef.current === null) {
          landedAtRef.current = now;
          dialogRef.current?.close();
        } else if (now - landedAtRef.current >= RESET_DELAY_MS) {
          flightNoRef.current += 1;
          setFlightNo(flightNoRef.current);
          flightStartRef.current = now;
          deployRef.current = null;
          setChute(null);
          apogeeRef.current = 0;
          landedAtRef.current = null;
          t = 0;
          setTrail([]);
          next = makeSample(flightNoRef.current, 0, null, 0);
        }
      }

      apogeeRef.current = Math.max(apogeeRef.current, next.y);
      next = { ...next, apogee: apogeeRef.current };

      setSample(next);
      setTrail((prev) => [...prev.slice(-(TRAIL_POINTS - 1)), next.y]);
      historyRef.current.push(next);
      if (historyRef.current.length > 6000) {
        historyRef.current.splice(0, historyRef.current.length - 6000);
      }
      setRowCount(historyRef.current.length);
    };

    const id = window.setInterval(tick, 1000 / SAMPLE_HZ);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!downloadNote) return;
    const id = window.setTimeout(() => setDownloadNote(null), 4000);
    return () => window.clearTimeout(id);
  }, [downloadNote]);

  const openEject = () => {
    setConfirmAltitude(sample.y);
    dialogRef.current?.showModal();
    window.requestAnimationFrame(() => cancelRef.current?.focus());
  };

  const confirmEject = () => {
    const now = performance.now();
    const t = (now - flightStartRef.current) / 1000;
    const current = flightAt(t, deployRef.current);
    dialogRef.current?.close();

    if (deployRef.current || current.altitude <= 0) return;

    const deploy = { t, altitude: current.altitude };
    deployRef.current = deploy;
    setChute(deploy);
    setDownloadNote(null);
  };

  const downloadCsv = () => {
    const rows = historyRef.current;
    if (rows.length === 0) return;

    const blob = new Blob(["\ufeff", toCsv(rows)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    anchor.href = url;
    anchor.download = `gcs-telemetry-${stamp}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setDownloadNote(`CSV saved, ${rows.length} rows.`);
  };

  const statusText =
    downloadNote ??
    (sample.phase === "landed"
      ? `Touchdown. Flight ${sample.flight} complete.`
      : chute
        ? `Parachute deployed at ${Math.round(chute.altitude)} m.`
        : "Parachute armed.");
  const statusTone = sample.phase === "landed" ? "muted" : chute ? "ok" : "muted";

  const ejectDisabled = Boolean(chute) || sample.phase === "landed";

  return (
    <div className="gcs-app">
      <header className="app-header">
        <div className="brand">
          <h1>Ground control</h1>
          <span className="vehicle">Vehicle 01</span>
        </div>
        <div className="header-meta">
          <span className="clock">
            <span className="clock-prefix">T+</span>
            {formatClock(sample.t)}
          </span>
        </div>
      </header>

      <main className="app-main">
        <section className="scene-shell" aria-label="Vehicle view">
          <RocketScene deployed={Boolean(chute)} altitude={sample.y} />

          <div className="scene-reading">
            <p className="scene-label">Altitude AGL</p>
            <p className="scene-value">
              {sample.y.toFixed(1)}
              <span>m</span>
            </p>
            <p className="scene-phase">{phaseLabel(sample)}</p>
          </div>

          <AltitudeTape altitude={sample.y} />

          <p className="scene-hint">
            Drag sideways to rotate. The view stays on the front arc.
          </p>
        </section>

        <aside className="control-panel" aria-label="Telemetry and flight controls">
          <div className="panel-inner">
            <header className="panel-head">
              <div>
                <h2>Telemetry</h2>
                <p className="panel-sub">Flight {flightNo}</p>
              </div>
              <span className="badge badge-sim">Simulated feed</span>
            </header>

            <section className="readout-group" aria-labelledby="position-title">
              <div className="group-head">
                <h3 id="position-title">Position</h3>
                <span className="group-note">local ENU</span>
              </div>
              <div className="stats telemetry-stats">
                <div className="stat">
                  <div className="stat-title">X</div>
                  <div className="stat-value">{signed(sample.x, 2)}</div>
                  <div className="stat-desc">m</div>
                </div>
                <div className="stat">
                  <div className="stat-title">Y</div>
                  <div className="stat-value">{signed(sample.y, 2)}</div>
                  <div className="stat-desc">m</div>
                </div>
                <div className="stat">
                  <div className="stat-title">Z</div>
                  <div className="stat-value">{signed(sample.z, 2)}</div>
                  <div className="stat-desc">m</div>
                </div>
              </div>
            </section>

            <section className="readout-group" aria-labelledby="flight-title">
              <div className="group-head">
                <h3 id="flight-title">Flight</h3>
                <span className="group-note">from pad</span>
              </div>
              <div className="stats telemetry-stats">
                <div className="stat">
                  <div className="stat-title">Speed</div>
                  <div className="stat-value">{sample.speed.toFixed(1)}</div>
                  <div className="stat-desc">m/s</div>
                </div>
                <div className="stat">
                  <div className="stat-title">Apogee</div>
                  <div className="stat-value">{sample.apogee.toFixed(1)}</div>
                  <div className="stat-desc">m</div>
                </div>
                <div className="stat">
                  <div className="stat-title">Downrange</div>
                  <div className="stat-value">{sample.downrange.toFixed(1)}</div>
                  <div className="stat-desc">m</div>
                </div>
              </div>
            </section>

            <AltitudeTrace values={trail} />

            <div className="panel-actions">
              <button
                type="button"
                className="btn btn-download"
                onClick={downloadCsv}
                disabled={rowCount === 0}
              >
                Download CSV
              </button>
              <button
                type="button"
                className="btn btn-eject"
                onClick={openEject}
                disabled={ejectDisabled}
              >
                {chute
                  ? "Parachute deployed"
                  : sample.phase === "landed"
                    ? "Flight complete"
                    : "Eject parachute now"}
              </button>
              <p className="status-line" data-tone={statusTone} role="status" aria-live="polite">
                {statusText}
              </p>
              <p className="meta-line">
                <span>{SAMPLE_HZ} Hz</span>
                <span>{rowCount.toLocaleString("en-US")} rows</span>
              </p>
            </div>
          </div>
        </aside>
      </main>

      <dialog
        ref={dialogRef}
        className="modal"
        aria-labelledby="eject-title"
        onClose={() => setConfirmAltitude(null)}
      >
        <div className="modal-box">
          <h2 id="eject-title">Eject the parachute?</h2>
          <p>
            The canopy deploys now at{" "}
            {Math.round(confirmAltitude ?? sample.y)} m. The vehicle starts its
            descent under canopy.
          </p>
          <div className="modal-action">
            <form method="dialog">
              <button ref={cancelRef} type="submit" className="btn btn-cancel">
                Cancel
              </button>
            </form>
            <button
              type="button"
              className="btn btn-danger"
              onClick={confirmEject}
              disabled={ejectDisabled}
            >
              Eject now
            </button>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button type="submit" aria-label="Close" aria-hidden="true" tabIndex={-1}>
            Close
          </button>
        </form>
      </dialog>
    </div>
  );
}

export default App;
