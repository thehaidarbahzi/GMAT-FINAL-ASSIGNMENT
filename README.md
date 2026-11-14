# FINAL ASSIGNMENT GMAT

Repository final assignment kelompok 2 oprec GMAT. Isinya dua bagian kerja: aplikasi desktop **GCS** dan folder **hardware** yang masih menunggu diisi.

## Isi repository

```
.
├── GCS/          Aplikasi desktop (Tauri 2 + React 19 + TypeScript + Vite)
├── docs/         Panduan instalasi dan catatan teknis
├── hardware/     Berkas perangkat keras (masih kosong)
└── README.md
```

**GCS/** sudah bisa dijalankan, tapi statusnya masih scaffold. Yang ada baru template bawaan Tauri: halaman welcome, satu command Rust `greet`, dan `public/model.gltf` yang belum dipakai di UI. Rangkaian fitur GCS yang sebenarnya belum masuk.

**hardware/** belum punya isi sama sekali. Rencana komponen, skema wiring, dan firmware akan ditulis di sana. Sementara ini lihat [docs/installation-hardware.md](docs/installation-hardware.md).

## Mulai dari mana

Kalau mau menjalankan aplikasi desktop, buka [docs/installation-gcs.md](docs/installation-gcs.md). Butuh Node.js, pnpm, dan toolchain Rust. Di Linux ada paket sistem tambahan yang harus dipasang dulu, dan panduannya sudah menyertakan perintahnya.

Ringkasnya:

```bash
cd GCS
pnpm install
pnpm tauri dev
```

Untuk build installer:

```bash
cd GCS
pnpm tauri build
```

Hasil build muncul di `GCS/src-tauri/target/release/bundle/`.

## Dokumentasi

| Dokumen | Isi |
|---|---|
| [docs/README.md](docs/README.md) | Daftar dokumen yang tersedia |
| [docs/installation-gcs.md](docs/installation-gcs.md) | Prasyarat dan langkah instalasi GCS di Linux, Windows, macOS |
| [docs/installation-hardware.md](docs/installation-hardware.md) | Rencana dokumentasi hardware, masih TODO |

## Stack GCS

Bagian frontend pakai React 19 dengan TypeScript, di-bundle Vite 8. Bagian desktop pakai Tauri 2, jadi UI React berjalan di dalam WebView dan logika sistem ditulis di Rust (`GCS/src-tauri/`). Manajer paket yang dipakai pnpm, terlihat dari `pnpm-lock.yaml` dan `beforeDevCommand` di `tauri.conf.json`.

## Kontributor

Evan Gamart Anugrah Siadari
Rasyid Pasha Muhamad
Vincenlee Jonathans
Fitra Adin Auliansyah
Zidan Fabiana
Muhammad Farrel Balapradhana
Muhammad Farhan Wikan Syah Alam
Donny Zaki Huda
Riyan Ramadhan Elfatih
Haidar Bahzi
Abdillah Kamal Azizy
Muhammad Ahsan Al Asyari
Victoria Nadine Wiyono
Ghoziyah Alimah S
