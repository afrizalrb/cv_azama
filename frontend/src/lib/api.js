/**
 * api.js — satu-satunya jalan frontend berbicara dengan Apps Script.
 *
 * Tidak ada komponen yang boleh memanggil fetch() sendiri. Semua lewat sini,
 * supaya penanganan token, redirect, dan error cuma ditulis satu kali.
 */

import { hapusSesi, ambilToken } from './auth'

/**
 * URL web app Apps Script.
 *
 * Variabel VITE_* ikut ter-bundle ke JavaScript yang bisa dilihat siapa saja.
 * Ini bukan tempat menyimpan rahasia, dan memang tidak perlu: URL API boleh
 * terlihat. Keamanannya ada pada verifikasi token di sisi Apps Script, bukan
 * pada kerahasiaan alamatnya.
 */
const URL_API = import.meta.env.VITE_API_URL || ''

/** Error yang membawa kode dari backend, supaya UI bisa bereaksi berbeda. */
export class ApiError extends Error {
  constructor(kode, pesan) {
    super(pesan)
    this.name = 'ApiError'
    this.kode = kode
  }
}

/**
 * Kirim satu action ke backend.
 *
 * @param {string} action  contoh: 'auth.login', 'sales.create'
 * @param {object} payload isi permintaan
 * @returns {Promise<any>} isi field `data` bila berhasil
 * @throws  {ApiError}     bila backend menolak atau jaringan gagal
 */
export async function panggilApi(action, payload = {}) {
  if (!URL_API) {
    throw new ApiError(
      'CONFIG_MISSING',
      'Alamat server belum diatur. Buat berkas frontend/.env.local berisi ' +
      'VITE_API_URL=<URL web app Apps Script>, lalu jalankan ulang npm run dev.'
    )
  }

  let respons
  try {
    respons = await fetch(URL_API, {
      method: 'POST',
      // text/plain dipakai dengan sengaja. application/json memicu preflight
      // OPTIONS, dan Apps Script tidak melayani OPTIONS — permintaannya akan
      // mati di CORS sebelum sampai ke server. Isinya tetap JSON.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token: ambilToken(), payload }),
      // Apps Script selalu membalas dengan redirect ke googleusercontent.com.
      // fetch mengikutinya otomatis, tapi ditulis eksplisit supaya jelas
      // kenapa curl butuh flag -L untuk endpoint yang sama.
      redirect: 'follow',
    })
  } catch {
    throw new ApiError(
      'NETWORK',
      'Tidak bisa menghubungi server. Periksa koneksi internet Anda.'
    )
  }

  const teks = await respons.text()

  let hasil
  try {
    hasil = JSON.parse(teks)
  } catch {
    // Balasan berupa HTML hampir selalu berarti hal yang sama: deployment
    // tidak diatur "Anyone", sehingga Google mengembalikan halaman login.
    throw new ApiError(
      'BAD_RESPONSE',
      teks.trimStart().startsWith('<')
        ? 'Server membalas halaman HTML, bukan data. Biasanya karena deployment ' +
          'Apps Script belum diatur "Who has access: Anyone".'
        : 'Balasan server tidak bisa dibaca.'
    )
  }

  if (!hasil.ok) {
    const { code, message } = hasil.error || {}

    // Sesi habis di tengah pemakaian: bersihkan sekarang, supaya layar
    // berikutnya tidak mencoba memakai token yang sudah mati.
    if (code === 'TOKEN_EXPIRED' || code === 'UNAUTHORIZED') {
      hapusSesi()
    }
    throw new ApiError(code || 'UNKNOWN', message || 'Permintaan ditolak server.')
  }

  return hasil.data
}

/** Uji apakah backend hidup. Tidak memerlukan login. */
export function ping() {
  return panggilApi('ping')
}
