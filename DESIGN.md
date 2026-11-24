# DESIGN.md — BukuUtang

## Design Read
Reading this as: Aplikasi pencatatan buku kas utang piutang personal dan komunitas untuk pengguna harian, dengan gaya Buku Kas Editorial (Warm Paper & Ink), dial ENERGY 2 / RHYTHM 2 / MOTION 1.

Dial: ENERGY 2 / RHYTHM 2 / MOTION 1

## Identitas & Motif
- **Nama Produk (Wordmark):** BukuUtang (tipografi serif tegas tanpa ikon generik).
- **Karakter:** Tenang, jujur, rapi seperti buku catatan kas modern di atas kertas hangat.
- **Identity Motif:** Garis tipis horizontal ala buku besar (`1px solid var(--border-ledger)`), penomoran transaksi (`#001`), dan angka Rupiah dengan `font-variant-numeric: tabular-nums`.
- **Focal Point per Layar:**
  - Halaman masuk: panel otentikasi tunggal yang fokus dengan penjelasan alur singkat dan nyata.
  - Dashboard: blok Ringkasan Saldo Bersih (Piutang vs Tagihan) di bagian atas, diikuti form pencatatan cepat dan daftar ledger.

## Palet Warna (Terverifikasi WCAG AA via contrast-check.py)
### Mode Terang (Warm Paper & Ink - Default)
- `--bg-canvas`: `#FAF7F2` (kertas hangat, mengurangi silau putih mentah)
- `--bg-surface`: `#F2ECE1` (permukaan sekunder untuk pemisah hirarki tanpa shadow berlebih)
- `--bg-elevated`: `#FFFFFF` (permukaan input dan dialog)
- `--ink-primary`: `#1C1917` (kontras 16.37:1 di atas `#FAF7F2`)
- `--ink-secondary`: `#57534E` (kontras 7.14:1 di atas `#FAF7F2`)
- `--accent-debt`: `#B43B24` dengan teks `#FFFFFF` (kontras 5.85:1; khusus CTA utama & penanda tagihan yang harus dibayar)
- `--status-credit`: `#1F5E3B` dengan teks `#FFFFFF` (kontras 7.71:1; khusus status piutang & lunas)
- `--status-pending`: `#8A4B08` dengan latar `#FEF3C7` (status menunggu konfirmasi)
- `--border-ledger`: `#D6CEC2`

### Mode Gelap (Warm Charcoal & Paper - Toggle R-21/R-34)
- `--bg-canvas`: `#181615`
- `--bg-surface`: `#221F1D`
- `--bg-elevated`: `#2B2724`
- `--ink-primary`: `#F5F2EB` (kontras 16.13:1 di atas `#181615`)
- `--ink-secondary`: `#BDB5AA`
- `--accent-debt`: `#D4553B` dengan teks `#FFFFFF`
- `--status-credit`: `#2E7D52` dengan teks `#FFFFFF`
- `--status-pending`: `#FCD34D` dengan latar `#3B2B12`
- `--border-ledger`: `#3A3530`

## Tipografi (R-06)
- **Display & Nominal Saldo:** `Newsreader`, Georgia, serif (memberi karakter editorial buku kas).
- **UI & Daftar Ledger:** `Plus Jakarta Sans`, system-ui, sans-serif (keterbacaan tinggi untuk teks Bahasa Indonesia).
- **Angka:** Wajib `font-variant-numeric: tabular-nums` pada semua nominal Rupiah dan nomor transaksi.

## Spasi, Radius, Elevasi & Motion
- **Radius (R-11):** `4px` untuk input, badge status, dan tombol sekunder; `8px` untuk panel dan dialog; tanpa bentuk pill seragam.
- **Shadow (R-12):** Nol shadow pada kartu biasa; shadow tipis hanya pada dialog modal untuk menandai elevasi lapisan atas.
- **Motion (DIAL 1):** Hanya state hover, fokus, dan transisi buka/tutup modal; nonaktif di bawah `prefers-reduced-motion: reduce`.
- **Responsivitas (R-03):** Tiga tahap lebar (Mobile `< 640px`, Tablet `640px-1024px`, Desktop `> 1024px`), tap target minimal `44x44px`, nol horizontal overflow.
