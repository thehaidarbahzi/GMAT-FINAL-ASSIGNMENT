export type Phase = "ascent" | "descent" | "landed";

export type Sample = {
  flight: number;
  t: number;
  x: number;
  y: number;
  z: number;
  speed: number;
  apogee: number;
  downrange: number;
  phase: Phase;
};

export type Deploy = {
  t: number;
  altitude: number;
};

const V0 = 60;
const ASCENT_G = 2;
const FREEFALL_G = 9.81;
const CHUTE_RATE = 8;

export const APOGEE_T = V0 / (2 * ASCENT_G);
export const APOGEE_ALT = V0 * APOGEE_T - ASCENT_G * APOGEE_T * APOGEE_T;
export const INITIAL_T = 7.2;
export const SAMPLE_HZ = 5;

export function flightAt(t: number, deploy: Deploy | null) {
  if (deploy && t >= deploy.t) {
    const altitude = Math.max(0, deploy.altitude - CHUTE_RATE * (t - deploy.t));
    return {
      altitude,
      speed: altitude > 0 ? CHUTE_RATE : 0,
      phase: (altitude > 0 ? "descent" : "landed") as Phase,
    };
  }

  if (t <= APOGEE_T) {
    const altitude = V0 * t - ASCENT_G * t * t;
    return {
      altitude,
      speed: V0 - 2 * ASCENT_G * t,
      phase: "ascent" as Phase,
    };
  }

  const dt = t - APOGEE_T;
  const altitude = Math.max(0, APOGEE_ALT - 0.5 * FREEFALL_G * dt * dt);
  return {
    altitude,
    speed: altitude > 0 ? FREEFALL_G * dt : 0,
    phase: (altitude > 0 ? "descent" : "landed") as Phase,
  };
}

export function positionAt(t: number) {
  const x = 1.4 * t + 0.03 * t * t;
  const z = -0.9 * t + 0.01 * t * t;
  return { x, z, downrange: Math.hypot(x, z) };
}

export function makeSample(
  flight: number,
  t: number,
  deploy: Deploy | null,
  apogee: number,
): Sample {
  const { altitude, speed, phase } = flightAt(t, deploy);
  const { x, z, downrange } = positionAt(t);
  return {
    flight,
    t,
    x,
    y: altitude,
    z,
    speed,
    apogee,
    downrange,
    phase,
  };
}

export function seedHistory(flight: number, until: number): Sample[] {
  const rows: Sample[] = [];
  let apogee = 0;
  for (let t = 0; t <= until; t += 1 / SAMPLE_HZ) {
    const sample = makeSample(flight, t, null, apogee);
    apogee = Math.max(apogee, sample.y);
    rows.push({ ...sample, apogee });
  }
  return rows;
}

export function toCsv(rows: Sample[]): string {
  const head = [
    "flight",
    "elapsed_s",
    "x_m",
    "y_m",
    "z_m",
    "altitude_m",
    "speed_mps",
    "apogee_m",
    "downrange_m",
    "phase",
  ];
  const body = rows.map((row) =>
    [
      row.flight,
      row.t.toFixed(2),
      row.x.toFixed(3),
      row.y.toFixed(3),
      row.z.toFixed(3),
      row.y.toFixed(3),
      row.speed.toFixed(3),
      row.apogee.toFixed(3),
      row.downrange.toFixed(3),
      row.phase,
    ].join(","),
  );
  return [head.join(","), ...body].join("\r\n");
}

export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const secs = whole % 60;
  const tenths = Math.floor((Math.max(0, seconds) - whole) * 10);
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${tenths}`;
}
