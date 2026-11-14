# Instalasi Hardware

> **Status: TODO.** Folder `hardware/` masih kosong. Belum ada komponen, skema wiring, atau firmware yang bisa didokumentasikan. Halaman ini sengaja dibiarkan sebagai kerangka supaya pengisiannya nanti tidak mulai dari nol.

## Yang perlu ditulis di sini

Bagian ini daftar pekerjaan, bukan hasil. Ganti setiap poin dengan isi sebenarnya begitu berkasnya tersedia.

**Daftar komponen.** Nama part, jumlah, dan link datasheet. Tulis versi atau tipe persisnya, karena "modul radio 2.4 GHz" saja tidak cukup saat ada dua varian dengan pinout berbeda.

**Skema wiring.** Foto atau diagram koneksi antar komponen, plus tabel pin ke pin. Sebutkan tegangan kerja tiap jalur dan di mana regulator dipasang.

**Firmware dan toolchain.** Board yang dipakai, cara flash, dan versi library. Kalau butuh Arduino IDE atau PlatformIO, tulis setting board-nya.

**Kalibrasi dan pengujian.** Prosedur sebelum dipakai di lapangan, termasuk nilai yang dianggap normal dan tanda ada masalah.

**Integrasi dengan GCS.** Protokol komunikasi, baud rate, format pesan, dan pin mana yang dipakai. Bagian ini yang menyambung folder `hardware/` ke aplikasi di `GCS/`.

## Sementara ini

Belum ada perintah instalasi yang bisa dijalankan. Kalau kamu memegang bagian hardware dan sudah punya berkas awal, taruh di `hardware/` lalu isi halaman ini. Untuk sisi perangkat lunak, lihat [installation-gcs.md](installation-gcs.md).
