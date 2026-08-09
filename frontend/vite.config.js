import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],

  // WAJIB sama persis dengan nama repo GitHub, lengkap dengan garis miring
  // di kedua sisi. Kalau salah, GitHub Pages menampilkan halaman putih kosong
  // tanpa pesan error apa pun: berkas JS dicari di /assets/... padahal
  // sebenarnya berada di /cv_azama/assets/...
  base: '/cv_azama/',
})
