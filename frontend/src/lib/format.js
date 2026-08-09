/**
 * format.js — pemformatan angka dan tanggal untuk pembaca Indonesia.
 *
 * Dipusatkan di sini supaya seluruh halaman menampilkan angka dengan cara
 * yang sama. Rupiah yang kadang pakai titik kadang koma adalah cara tercepat
 * membuat pengguna ragu pada datanya sendiri.
 */

const BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
]

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']

/** 390000 -> "Rp 390.000" */
export function rupiah(nilai) {
  const n = Number(nilai) || 0
  return 'Rp ' + Math.round(n).toLocaleString('id-ID')
}

/** Tanpa prefiks, untuk kolom tabel yang sudah jelas berisi uang. */
export function angka(nilai) {
  return (Math.round(Number(nilai) || 0)).toLocaleString('id-ID')
}

/**
 * Bentuk ringkas untuk kartu ringkasan: 4280000 -> "Rp 4,3 jt"
 *
 * Dipakai hanya di tempat yang angkanya sekadar memberi gambaran skala.
 * Jangan dipakai untuk nilai yang perlu dicocokkan dengan nota.
 */
export function rupiahSingkat(nilai) {
  const n = Math.round(Number(nilai) || 0)
  if (Math.abs(n) >= 1e9) return 'Rp ' + (n / 1e9).toFixed(1).replace('.', ',') + ' M'
  if (Math.abs(n) >= 1e6) return 'Rp ' + (n / 1e6).toFixed(1).replace('.', ',') + ' jt'
  if (Math.abs(n) >= 1e3) return 'Rp ' + Math.round(n / 1e3) + ' rb'
  return 'Rp ' + n
}

/** '2026-08-03' -> "3 Agustus 2026" */
export function tanggal(iso) {
  const b = pecah(iso)
  if (!b) return '—'
  return `${b.tgl} ${BULAN[b.bln - 1]} ${b.thn}`
}

/** '2026-08-03' -> "3 Agu 2026" */
export function tanggalPendek(iso) {
  const b = pecah(iso)
  if (!b) return '—'
  return `${b.tgl} ${BULAN[b.bln - 1].substring(0, 3)} ${b.thn}`
}

/** '2026-08-03' -> "Senin, 3 Agustus 2026" */
export function tanggalLengkap(iso) {
  const b = pecah(iso)
  if (!b) return '—'
  const hari = HARI[new Date(Date.UTC(b.thn, b.bln - 1, b.tgl)).getUTCDay()]
  return `${hari}, ${b.tgl} ${BULAN[b.bln - 1]} ${b.thn}`
}

/** Tanggal hari ini dalam bentuk ISO, mengikuti zona waktu Jakarta. */
export function hariIniIso() {
  // en-CA memberi bentuk YYYY-MM-DD, dan timeZone memastikan pengguna di
  // zona lain tetap melihat tanggal yang sama dengan server.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function pecah(iso) {
  const cocok = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!cocok) return null
  return { thn: +cocok[1], bln: +cocok[2], tgl: +cocok[3] }
}
