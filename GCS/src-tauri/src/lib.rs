// Serial bridge between the ESP32 (receiver or payload over USB) and the React UI.
//
// The UI calls `list_serial_ports`, `connect_serial`, `disconnect_serial`,
// `send_serial` (uplink commands such as the nosecone eject) and `save_csv`.
// Every text line from the board is emitted as a `serial-line` event; parsing
// happens in the frontend (src/telemetry.ts) so the format lives in one place.

use std::io::{ErrorKind, Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use serde::Serialize;
use serialport::{SerialPort, SerialPortType};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::DialogExt;

const READ_TIMEOUT: Duration = Duration::from_millis(100);
const MAX_LINE_BYTES: usize = 4096;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PortInfo {
    name: String,
    description: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SerialStatus {
    state: &'static str,
    port: String,
    message: String,
}

struct Connection {
    stop: Arc<AtomicBool>,
    handle: JoinHandle<()>,
    writer: Box<dyn SerialPort>,
}

#[derive(Default)]
struct SerialState {
    connection: Mutex<Option<Connection>>,
}

impl SerialState {
    fn lock(&self) -> MutexGuard<'_, Option<Connection>> {
        self.connection.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    // Stop the reader thread and wait until it has released the port
    fn stop(&self) {
        let current = self.lock().take();
        if let Some(connection) = current {
            connection.stop.store(true, Ordering::Relaxed);
            let _ = connection.handle.join();
        }
    }
}

fn describe(port_type: &SerialPortType) -> String {
    match port_type {
        SerialPortType::UsbPort(usb) => usb
            .product
            .clone()
            .unwrap_or_else(|| format!("USB {:04X}:{:04X}", usb.vid, usb.pid)),
        SerialPortType::PciPort => "PCI serial".into(),
        SerialPortType::BluetoothPort => "Bluetooth".into(),
        SerialPortType::Unknown => "Serial port".into(),
    }
}

#[tauri::command]
fn list_serial_ports() -> Result<Vec<PortInfo>, String> {
    let ports = serialport::available_ports().map_err(|error| error.to_string())?;
    Ok(ports
        .into_iter()
        .map(|port| PortInfo {
            description: describe(&port.port_type),
            name: port.port_name,
        })
        .collect())
}

#[tauri::command]
async fn connect_serial(
    app: AppHandle,
    state: State<'_, SerialState>,
    port: String,
    baud: u32,
) -> Result<(), String> {
    state.stop();

    let mut serial = serialport::new(&port, baud)
        .timeout(READ_TIMEOUT)
        .open()
        .map_err(|error| format!("Could not open {port}: {error}"))?;

    // Leave DTR and RTS released so the ESP32 auto-reset circuit keeps the board running
    let _ = serial.write_data_terminal_ready(false);
    let _ = serial.write_request_to_send(false);

    let writer = serial
        .try_clone()
        .map_err(|error| format!("Could not open {port} for writing: {error}"))?;

    let stop = Arc::new(AtomicBool::new(false));
    let handle = {
        let app = app.clone();
        let stop = stop.clone();
        let port = port.clone();
        thread::spawn(move || read_loop(app, serial, stop, port))
    };
    *state.lock() = Some(Connection { stop, handle, writer });

    let _ = app.emit(
        "serial-status",
        SerialStatus {
            state: "connected",
            port,
            message: format!("Listening at {baud} baud"),
        },
    );
    Ok(())
}

#[tauri::command]
async fn disconnect_serial(state: State<'_, SerialState>) -> Result<(), String> {
    state.stop();
    Ok(())
}

// Send one command line to the board (the UI adds the checksum)
#[tauri::command]
async fn send_serial(state: State<'_, SerialState>, line: String) -> Result<(), String> {
    let mut guard = state.lock();
    let connection = guard.as_mut().ok_or("Not connected to a serial port")?;
    let mut data = line.trim().to_string();
    data.push('\n');
    connection
        .writer
        .write_all(data.as_bytes())
        .and_then(|_| connection.writer.flush())
        .map_err(|error| format!("Could not send: {error}"))
}

// Save the telemetry CSV through a native "Save as" dialog.
// A blob download from the WebView is unreliable inside Tauri, so the file is
// written here. Returns the saved path, or None when the user cancels.
#[tauri::command]
async fn save_csv(
    app: AppHandle,
    file_name: String,
    contents: String,
) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("Save telemetry CSV")
        .set_file_name(&file_name)
        .add_filter("CSV", &["csv"])
        .blocking_save_file();

    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|error| format!("Unsupported save location: {error}"))?;
    std::fs::write(&path, contents.as_bytes())
        .map_err(|error| format!("Could not save {}: {error}", path.display()))?;
    Ok(Some(path.display().to_string()))
}

fn emit_line(app: &AppHandle, bytes: &[u8]) {
    let text = String::from_utf8_lossy(bytes);
    let text = text.trim();
    if !text.is_empty() {
        let _ = app.emit("serial-line", text.to_string());
    }
}

fn read_loop(
    app: AppHandle,
    mut serial: Box<dyn SerialPort>,
    stop: Arc<AtomicBool>,
    port: String,
) {
    let mut chunk = [0u8; 512];
    let mut line: Vec<u8> = Vec::with_capacity(256);
    let mut failure: Option<String> = None;

    while !stop.load(Ordering::Relaxed) {
        match serial.read(&mut chunk) {
            Ok(count) => {
                for &byte in &chunk[..count] {
                    match byte {
                        b'\n' => {
                            emit_line(&app, &line);
                            line.clear();
                        }
                        b'\r' => {}
                        _ if line.len() < MAX_LINE_BYTES => line.push(byte),
                        _ => {}
                    }
                }
            }
            Err(error) if matches!(error.kind(), ErrorKind::TimedOut | ErrorKind::Interrupted) => {}
            Err(error) => {
                failure = Some(format!("Lost {port}: {error}"));
                break;
            }
        }
    }

    let status = match failure {
        Some(message) => SerialStatus {
            state: "error",
            port,
            message,
        },
        None => SerialStatus {
            state: "disconnected",
            port,
            message: "Port closed".into(),
        },
    };
    let _ = app.emit("serial-status", status);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(SerialState::default())
        .invoke_handler(tauri::generate_handler![
            list_serial_ports,
            connect_serial,
            disconnect_serial,
            send_serial,
            save_csv
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
