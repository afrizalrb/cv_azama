/**
 * auth.js — penyimpanan sesi di sisi peramban.
 *
 * Token disimpan di sessionStorage, bukan localStorage. Bedanya nyata:
 * sessionStorage hilang saat tab ditutup. Komputer kantor sering dipakai
 * bergantian, dan sesi yang menempel berhari-hari adalah masalah yang
 * kelihatannya kecil sampai suatu hari tidak lagi.
 *
 * Yang perlu diingat: apa pun yang disimpan di sini bisa dibaca dan diubah
 * pengguna lewat konsol peramban. Karena itu `role` yang tersimpan hanya
 * dipakai untuk mengatur tampilan menu. Hak akses yang sesungguhnya
 * ditegakkan di Apps Script, yang membaca role dari token bertanda tangan.
 */

const KUNCI_TOKEN = 'azama_token'
const KUNCI_USER = 'azama_user'

export function simpanSesi(token, user) {
  sessionStorage.setItem(KUNCI_TOKEN, token)
  sessionStorage.setItem(KUNCI_USER, JSON.stringify(user))
}

export function ambilToken() {
  return sessionStorage.getItem(KUNCI_TOKEN) || ''
}

export function ambilUser() {
  const mentah = sessionStorage.getItem(KUNCI_USER)
  if (!mentah) return null
  try {
    return JSON.parse(mentah)
  } catch {
    // Isi rusak lebih baik dianggap tidak ada daripada membuat aplikasi macet.
    hapusSesi()
    return null
  }
}

export function hapusSesi() {
  sessionStorage.removeItem(KUNCI_TOKEN)
  sessionStorage.removeItem(KUNCI_USER)
}

export function sudahLogin() {
  return Boolean(ambilToken())
}

/**
 * Cek role untuk keperluan tampilan saja.
 *
 * Jangan pernah dipakai sebagai satu-satunya penjaga operasi penting.
 * Menyembunyikan tombol hanya membuat antarmuka rapi — siapa pun bisa
 * memanggil endpoint langsung tanpa lewat antarmuka ini.
 */
export function punyaRole(...daftarRole) {
  const user = ambilUser()
  return Boolean(user && daftarRole.includes(user.role))
}
