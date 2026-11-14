# Instalasi GCS

GCS adalah aplikasi desktop di folder `GCS/`. Frontend-nya React 19 + TypeScript yang di-bundle Vite, bagian desktop-nya Tauri 2 dengan logika Rust di `src-tauri/`. Panduan ini sampai aplikasi bisa jalan di mode development dan menghasilkan installer.

## Yang perlu dipasang

| Kebutuhan | Versi | Catatan |
|---|---|---|
| Node.js | 20 ke atas, sebaiknya LTS terbaru | Vite 8 menolak Node yang terlalu tua |
| pnpm | 9 atau lebih baru | Repo ini pakai `pnpm-lock.yaml` |
| Rust | 1.85 ke atas | `Cargo.toml` pakai edition 2024 |
| Tauri system dependencies | sesuai OS | Lihat bagian di bawah |

Tauri CLI tidak perlu dipasang global. Sudah ada di `devDependencies`, jadi dipanggil lewat `pnpm tauri`.

Cek dulu yang sudah ada:

```bash
node -v
pnpm -v
rustc --version
```

Kalau Rust belum ada, pasang lewat rustup:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Setelah rustup selesai, tutup terminal lalu buka lagi supaya `cargo` masuk PATH.

## Dependensi sistem per OS

### Linux (Ubuntu, Debian, turunannya)

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

Arch dan Fedora punya nama paket berbeda, daftarnya ada di dokumentasi prasyarat Tauri. Yang penting: WebKitGTK 4.1 dan GTK 3 harus terpasang, karena WebView aplikasi bergantung pada keduanya.

### Windows

Pasang Microsoft C++ Build Tools dengan workload "Desktop development with C++", lalu pastikan WebView2 Runtime ada. Windows 11 sudah membawanya. Toolchain Rust yang dipakai harus `stable-x86_64-pc-windows-msvc`.

### macOS

```bash
xcode-select --install
```

Sisanya berjalan seperti Linux, tanpa paket apt.

## Langkah instalasi

1. Ambil isi repository, bisa lewat clone atau salin folder dari panitia.

   ```bash
   git clone <url-repository>
   cd <nama-folder-repo>
   ```

2. Masuk ke folder GCS dan pasang dependensi JavaScript.

   ```bash
   cd GCS
   pnpm install
   ```

3. Aktifkan pnpm kalau perintahnya belum dikenal. Corepack sudah ikut Node.js.

   ```bash
   corepack enable
   corepack prepare pnpm@latest --activate
   ```

4. Jalankan mode development.

   ```bash
   pnpm tauri dev
   ```

Build pertama makan waktu beberapa menit karena Cargo mengompilasi seluruh dependensi Rust. Setelah selesai, jendela aplikasi berjudul `gcs` akan terbuka dan menampilkan halaman welcome bawaan Tauri.

## Menjalankan frontend saja

Kalau hanya mau mengubah tampilan dan tidak menyentuh Rust, jalankan Vite langsung:

```bash
cd GCS
pnpm dev
```

Buka `http://localhost:1420`. Satu hal yang perlu diingat: tombol Greet memanggil `invoke()` dari `@tauri-apps/api`, dan fungsi itu tidak ada di browser biasa. Jadi tombol tersebut akan error di `pnpm dev`. Untuk menguji interaksi dengan Rust, tetap pakai `pnpm tauri dev`.

## Build installer

```bash
cd GCS
pnpm tauri build
```

Hasilnya ada di `GCS/src-tauri/target/release/bundle/`. Format yang keluar mengikuti OS: `.deb` dan `.AppImage` di Linux, `.msi` di Windows, `.dmg` di macOS. Konfigurasi nama produk, identifier (`com.haidarbahzi.gcs`), ukuran jendela, dan daftar ikon ada di `GCS/src-tauri/tauri.conf.json`.

Build release memakai `lto = true`, `codegen-units = 1`, dan `strip = true`, jadi prosesnya jauh lebih lama dari build debug. Jangan tutup terminal di tengah jalan.

## Kalau ada masalah

**Error `failed to load webkit2gtk-4.1` di Linux.** Paket `libwebkit2gtk-4.1-dev` belum terpasang. Ulangi perintah apt di atas, lalu hapus `GCS/src-tauri/target` dan build lagi.

**Port 1420 sudah dipakai.** `vite.config.ts` memakai `strictPort: true`, jadi Vite tidak akan pindah port sendiri. Cari proses yang menempati port itu lalu hentikan:

```bash
lsof -i :1420
```

**Jendela putih atau crash saat start di Linux dengan GPU NVIDIA.** Coba jalankan dengan renderer DMABUF dimatikan:

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 pnpm tauri dev
```

**`pnpm install` gagal karena signature corepack.** Jalankan `corepack enable` lebih dulu. Kalau masih gagal, pasang pnpm lewat npm: `npm install -g pnpm`.

**Perubahan di `src-tauri` tidak ikut ter-reload.** Restart `pnpm tauri dev`. Hot reload hanya berlaku untuk frontend; kode Rust dikompilasi ulang saat aplikasi dijalankan ulang.

**Build gagal karena versi Rust terlalu tua.** Edition 2024 butuh Rust 1.85+. Perbarui dengan `rustup update stable`.

## Struktur folder GCS

```
GCS/
├── src/                  Komponen React (App.tsx, main.tsx) dan CSS
├── public/               Aset statis, termasuk model.gltf
├── src-tauri/
│   ├── src/              lib.rs (command Rust), main.rs (entry point)
│   ├── capabilities/     Izin plugin Tauri
│   ├── icons/            Ikon aplikasi untuk semua platform
│   ├── Cargo.toml        Dependensi Rust
│   └── tauri.conf.json   Konfigurasi build, jendela, dan bundle
├── index.html            Entry HTML untuk Vite
├── package.json          Skrip dan dependensi JavaScript
└── vite.config.ts        Konfigurasi Vite, port dev 1420
```

`public/model.gltf` sudah ada di repo tapi belum dipakai komponen mana pun. Kalau nanti model 3D ini mau ditampilkan, perlu library tambahan seperti three.js atau react-three-fiber, dan itu belum masuk `package.json`.
