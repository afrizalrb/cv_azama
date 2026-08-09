/**
 * Konfigurasi PostCSS kosong — sengaja.
 *
 * Tailwind v4 diproses oleh @tailwindcss/vite, bukan oleh PostCSS, jadi tidak
 * ada plugin yang perlu didaftarkan di sini.
 *
 * Berkas ini tetap ada karena PostCSS mencari konfigurasi dengan menelusuri
 * folder ke atas sampai ketemu. Kalau repo ini kebetulan berada di dalam
 * folder yang punya postcss.config.js sendiri, konfigurasi milik tetangga itu
 * yang akan terpakai. Gejalanya membingungkan: build gagal menyebut
 * "@layer base is used but no matching @tailwind base directive is present",
 * seolah CSS kita yang salah, padahal yang berjalan adalah Tailwind v3 milik
 * folder lain.
 *
 * Keberadaan berkas ini menghentikan pencarian tepat di sini.
 */
export default {
  plugins: {},
}
