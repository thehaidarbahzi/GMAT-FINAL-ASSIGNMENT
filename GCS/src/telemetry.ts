// Telemetry format agreed with the hardware programmer (`tesSensor` branch).
//
// Full receiver line (19 fields, RSSI only when the E22 reports it):
//   packetID,millis,accelX,accelY,accelZ,gyroX,gyroY,gyroZ,imuTemp,baroTemp,
//   pressure,altitude,roll,pitch,receivedCount,badCount,lostCount,totalPacket,rssi
//
// Units: accel in g, gyro in rad/s, temperatures in °C, millis in ms,
// roll/pitch in degrees, pressure in Pa, altitude in m, rssi in dBm.
// packetID and the four counters are plain numbers.
//
// The layout is chosen by the number of fields, so the same parser also reads
// the payload plugged in over USB and receivers whose payload does not send
// roll/pitch yet. To change the format, edit the field groups and LAYOUTS below.

const SENSOR_FIELDS = [
  "packetID",
  "millis",
  "accelX",
  "accelY",
  "accelZ",
  "gyroX",
  "gyroY",
  "gyroZ",
  "imuTemp",
  "baroTemp",
  "pressure",
  "altitude",
] as const;
const ATTITUDE_FIELDS = ["roll", "pitch"] as const;
const LINK_FIELDS = ["receivedCount", "badCount", "lostCount", "totalPacket"] as const;
const RSSI_FIELDS = ["rssi"] as const;

type FieldName =
  | (typeof SENSOR_FIELDS)[number]
  | (typeof ATTITUDE_FIELDS)[number]
  | (typeof LINK_FIELDS)[number]
  | (typeof RSSI_FIELDS)[number];

export type Source = "receiver" | "payload";

type Layout = { label: string; source: Source; fields: readonly FieldName[] };

const LAYOUTS: Layout[] = [
  {
    label: "receiver",
    source: "receiver",
    fields: [...SENSOR_FIELDS, ...ATTITUDE_FIELDS, ...LINK_FIELDS, ...RSSI_FIELDS],
  },
  {
    label: "receiver, no RSSI",
    source: "receiver",
    fields: [...SENSOR_FIELDS, ...ATTITUDE_FIELDS, ...LINK_FIELDS],
  },
  {
    label: "receiver, payload without roll/pitch",
    source: "receiver",
    fields: [...SENSOR_FIELDS, ...LINK_FIELDS, ...RSSI_FIELDS],
  },
  {
    label: "receiver, payload without roll/pitch, no RSSI",
    source: "receiver",
    fields: [...SENSOR_FIELDS, ...LINK_FIELDS],
  },
  {
    label: "payload over USB",
    source: "payload",
    fields: [...SENSOR_FIELDS, ...ATTITUDE_FIELDS],
  },
  {
    label: "payload over USB, without roll/pitch",
    source: "payload",
    fields: [...SENSOR_FIELDS],
  },
];

export const FULL_FIELD_COUNT = LAYOUTS[0].fields.length;
const ACCEPTED_COUNTS = LAYOUTS.map((layout) => layout.fields.length).join(", ");

export type Reading = {
  packetID: number;
  millis: number;
  accelX: number;
  accelY: number;
  accelZ: number;
  gyroX: number;
  gyroY: number;
  gyroZ: number;
  imuTemp: number;
  baroTemp: number;
  pressure: number;
  altitude: number;
  roll: number;
  pitch: number;
  // Counters from the receiver, null when the payload is plugged in directly
  receivedCount: number | null;
  badCount: number | null;
  lostCount: number | null;
  totalPacket: number | null;
  rssi: number | null;
  // true when roll/pitch were not in the line and the GCS calculated them
  attitudeFromGcs: boolean;
  source: Source;
  layout: string;
};

export type ParsedLine =
  | { kind: "reading"; reading: Reading }
  | { kind: "bad"; reason: string }
  | { kind: "other" };

const PREFIXES = ["Received:", "LoRa: Data sent"];
const CSV_START_RE = /^-?\d/;

const RAD_TO_DEG = 180 / Math.PI;

// Same formula as calculateRollPitch() in the payload firmware (mount frame, +Z up)
export function tiltFromAccel(x: number, y: number, z: number) {
  return {
    roll: Math.atan2(y, z) * RAD_TO_DEG,
    pitch: Math.atan2(-x, Math.hypot(y, z)) * RAD_TO_DEG,
  };
}

function parseBody(body: string): ParsedLine {
  // Older receivers printed RSSI as "-87 dBm"
  const fields = body.split(",").map((field) => field.trim().replace(/\s*dBm$/i, ""));
  const layout = LAYOUTS.find((candidate) => candidate.fields.length === fields.length);

  if (!layout) {
    return {
      kind: "bad",
      reason: `Got ${fields.length} fields, expected ${ACCEPTED_COUNTS}. The firmware format may have changed.`,
    };
  }

  const values: Partial<Record<FieldName, number>> = {};
  layout.fields.forEach((name, index) => {
    // Arduino prints NaN as "nan"; Number() turns it into NaN, shown as a dash
    values[name] = Number(fields[index]);
  });

  const num = (name: FieldName) => values[name] ?? Number.NaN;
  const optional = (name: FieldName) =>
    values[name] !== undefined && Number.isFinite(values[name]) ? (values[name] as number) : null;

  if (!Number.isFinite(num("packetID")) || !Number.isFinite(num("millis"))) {
    return { kind: "bad", reason: "packetID or millis is not a number." };
  }

  let roll = num("roll");
  let pitch = num("pitch");
  const attitudeFromGcs = !layout.fields.includes("roll");
  if (attitudeFromGcs) {
    ({ roll, pitch } = tiltFromAccel(num("accelX"), num("accelY"), num("accelZ")));
  }

  let pressure = num("pressure");
  let altitude = num("altitude");
  let baroTemp = num("baroTemp");
  // BMP280 not detected: the firmware leaves its fields at 0, show them as missing
  if (!(pressure > 0)) {
    pressure = Number.NaN;
    altitude = Number.NaN;
    baroTemp = Number.NaN;
  }

  return {
    kind: "reading",
    reading: {
      packetID: num("packetID"),
      millis: num("millis"),
      accelX: num("accelX"),
      accelY: num("accelY"),
      accelZ: num("accelZ"),
      gyroX: num("gyroX"),
      gyroY: num("gyroY"),
      gyroZ: num("gyroZ"),
      imuTemp: num("imuTemp"),
      baroTemp,
      pressure,
      altitude,
      roll,
      pitch,
      receivedCount: optional("receivedCount"),
      badCount: optional("badCount"),
      lostCount: optional("lostCount"),
      totalPacket: optional("totalPacket"),
      rssi: optional("rssi"),
      attitudeFromGcs,
      source: layout.source,
      layout: layout.label,
    },
  };
}

export function parseLine(raw: string): ParsedLine {
  let line = raw.trim();
  if (!line) return { kind: "other" };

  for (const prefix of PREFIXES) {
    if (line.startsWith(prefix)) {
      line = line.slice(prefix.length).trim();
      if (!CSV_START_RE.test(line)) return { kind: "bad", reason: `Receiver: ${line}` };
      return parseBody(line);
    }
  }

  if (CSV_START_RE.test(line) && line.includes(",")) {
    return parseBody(line);
  }

  return { kind: "other" };
}

// ---------------------------------------------------------------------------
// Helpers

export function wrapDegrees(angle: number): number {
  let value = angle % 360;
  if (value > 180) value -= 360;
  if (value < -180) value += 360;
  return value;
}

export function hectopascal(pa: number): number {
  return pa / 100;
}

export function rssiQuality(dbm: number | null): string {
  if (dbm === null) return "";
  if (dbm >= -90) return "strong";
  if (dbm >= -105) return "fair";
  if (dbm >= -115) return "weak";
  return "very weak";
}

export function fmt(value: number | null | undefined, digits: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

export function signed(value: number | null | undefined, digits: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value >= 0 ? "+" : "-";
  return `${sign}${Math.abs(value).toFixed(digits)}`;
}

export function formatClock(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const whole = Math.floor(safe);
  const minutes = Math.floor(whole / 60);
  const secs = whole % 60;
  const tenths = Math.floor((safe - whole) * 10);
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${tenths}`;
}

// ---------------------------------------------------------------------------
// CSV export: the 19 hardware fields in the agreed order, then GCS-only columns

export type LoggedRow = {
  receivedAt: string;
  reading: Reading;
  relAltitude: number | null;
  yaw: number;
};

function csvNumber(value: number | null, digits: number): string {
  if (value === null || !Number.isFinite(value)) return "";
  return value.toFixed(digits);
}

export function toCsv(rows: LoggedRow[]): string {
  const head = [
    ...LAYOUTS[0].fields,
    "pc_time",
    "source",
    "attitude_from_gcs",
    "altitude_rel_m",
    "yaw_gcs_deg",
  ];
  const body = rows.map(({ receivedAt, reading: r, relAltitude, yaw }) =>
    [
      r.packetID,
      r.millis,
      csvNumber(r.accelX, 3),
      csvNumber(r.accelY, 3),
      csvNumber(r.accelZ, 3),
      csvNumber(r.gyroX, 3),
      csvNumber(r.gyroY, 3),
      csvNumber(r.gyroZ, 3),
      csvNumber(r.imuTemp, 3),
      csvNumber(r.baroTemp, 3),
      csvNumber(r.pressure, 3),
      csvNumber(r.altitude, 3),
      csvNumber(r.roll, 3),
      csvNumber(r.pitch, 3),
      r.receivedCount ?? "",
      r.badCount ?? "",
      r.lostCount ?? "",
      r.totalPacket ?? "",
      r.rssi ?? "",
      receivedAt,
      r.source,
      r.attitudeFromGcs ? 1 : 0,
      csvNumber(relAltitude, 3),
      csvNumber(yaw, 2),
    ].join(","),
  );
  return [head.join(","), ...body].join("\r\n");
}

// ---------------------------------------------------------------------------
// Demo feed: prints the full 19-field receiver line, so the parser is exercised
// the same way as with real hardware. Used in the browser or without a board.

export const DEMO_INTERVAL_MS = 300;
const GROUND_ALT_ISA = 35; // m, pad height in the ISA model
const DEMO_FLIGHT_S = 75;

function pressureAtIsaAltitude(altitude: number): number {
  return 101325 * Math.pow(1 - altitude / 44330, 5.255);
}

function demoAltitudeAgl(t: number): number {
  // 8 s on the pad, 9 s climb, coast to apogee, then descent under canopy
  const flight = t - 8;
  if (flight <= 0) return 0;
  if (flight <= 9) return 0.5 * 12 * flight * flight;
  const burnout = 0.5 * 12 * 81;
  const coast = flight - 9;
  if (coast <= 11) return burnout + 108 * coast - 4.9 * coast * coast;
  const apogee = burnout + 108 * 11 - 4.9 * 121;
  return Math.max(0, apogee - 9 * (coast - 11));
}

export function createDemoFeed() {
  let packetID = 0;
  let received = 0;
  let lost = 0;
  const startedAt = performance.now();

  const noise = (scale: number) => (Math.random() - 0.5) * 2 * scale;

  return function next(): string[] {
    const millis = Math.round(performance.now() - startedAt) + 4200;
    const t = (millis / 1000) % DEMO_FLIGHT_S;
    const altitude = demoAltitudeAgl(t);
    const flying = t > 8 && altitude > 0;
    const burning = t > 8 && t <= 17;

    const sway = flying ? 6 : 1.2;
    const rollDeg = Math.sin(t / 3) * sway + noise(0.3);
    const pitchDeg = Math.cos(t / 4) * sway + noise(0.3);
    const g = burning ? 2.2 : flying && t < 28 ? 0.06 : 1;
    const rollRad = rollDeg / RAD_TO_DEG;
    const pitchRad = pitchDeg / RAD_TO_DEG;

    const accelX = -Math.sin(pitchRad) * g + noise(0.004);
    const accelY = Math.sin(rollRad) * Math.cos(pitchRad) * g + noise(0.004);
    const accelZ = Math.cos(rollRad) * Math.cos(pitchRad) * g + noise(0.004);
    const gyroX = noise(0.01) + (flying ? Math.cos(t / 3) * 0.035 : 0);
    const gyroY = noise(0.01) - (flying ? Math.sin(t / 4) * 0.026 : 0);
    const gyroZ = noise(0.008) + (flying ? 0.35 : 0);
    const tilt = tiltFromAccel(accelX, accelY, accelZ);

    const isa = GROUND_ALT_ISA + altitude + noise(0.25);
    const pressure = pressureAtIsaAltitude(isa);
    const imuTemp = 31.5 + noise(0.05);
    const baroTemp = 29.8 - altitude * 0.0065 + noise(0.03);

    const thisID = packetID;
    packetID += 1;

    // Occasionally drop a packet like a real radio link
    if (Math.random() < 0.04) {
      lost += 1;
      return [];
    }
    received += 1;

    const rssi = Math.round(-62 - Math.min(altitude, 900) * 0.04 + noise(3));
    const line = [
      thisID,
      millis,
      accelX.toFixed(3),
      accelY.toFixed(3),
      accelZ.toFixed(3),
      gyroX.toFixed(3),
      gyroY.toFixed(3),
      gyroZ.toFixed(3),
      imuTemp.toFixed(3),
      baroTemp.toFixed(3),
      pressure.toFixed(3),
      isa.toFixed(3),
      tilt.roll.toFixed(3),
      tilt.pitch.toFixed(3),
      received,
      0,
      lost,
      received + lost,
      rssi,
    ].join(",");
    return [line];
  };
}

// ---------------------------------------------------------------------------
// Nosecone eject uplink (EjectTest firmware, protocol.h packet format)
//
// GCS -> board:  ARM*XX / EJECT*XX / ABORT*XX / STATUS*XX  (XX = XOR checksum)
// board -> GCS:  EJECT,<SAFE|ARMED|COUNTDOWN|FIRING>,<remaining ms>
//                EJECT,FIRED,<pulse ms>
//                EJECT,REJECT,<reason>

export type EjectCommand = "ARM" | "EJECT" | "ABORT" | "STATUS";
export type EjectState = "SAFE" | "ARMED" | "COUNTDOWN" | "FIRING";

export type EjectLine =
  | { kind: "state"; state: EjectState; remainingMs: number }
  | { kind: "fired"; pulseMs: number }
  | { kind: "reject"; reason: string };

// Same as buildPacket() in protocol.h, without the trailing newline
export function buildCommand(body: string): string {
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum ^= body.charCodeAt(i) & 0xff;
  return `${body}*${sum.toString(16).toUpperCase().padStart(2, "0")}`;
}

const EJECT_STATES: readonly string[] = ["SAFE", "ARMED", "COUNTDOWN", "FIRING"];

export function parseEjectLine(raw: string): EjectLine | null {
  const line = raw.trim();
  if (!line.startsWith("EJECT,")) return null;
  const [, kind = "", value = ""] = line.split(",");
  if (kind === "FIRED") return { kind: "fired", pulseMs: Number(value) || 0 };
  if (kind === "REJECT") return { kind: "reject", reason: value || "unknown" };
  if (EJECT_STATES.includes(kind)) {
    return { kind: "state", state: kind as EjectState, remainingMs: Number(value) || 0 };
  }
  return null;
}
