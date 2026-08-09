import { useCallback, useEffect, useState } from 'react'
import { panggilApi, ApiError } from './api'

/**
 * Muat data dari satu action, lengkap dengan keadaan memuat dan galat.
 *
 * Tiga keadaan yang harus selalu bisa dibedakan halaman mana pun:
 * sedang memuat, gagal, dan berhasil tapi kosong. Menyamakan "kosong" dengan
 * "belum selesai memuat" membuat pengguna menatap layar kosong tanpa tahu
 * harus menunggu atau melapor.
 */
export function useMuat(action, payload, deps = []) {
  const [data, setData] = useState(null)
  const [galat, setGalat] = useState(null)
  const [memuat, setMemuat] = useState(true)
  const [penanda, setPenanda] = useState(0)

  const kunciPayload = JSON.stringify(payload || {})

  useEffect(() => {
    let dibatalkan = false
    setMemuat(true)
    setGalat(null)

    panggilApi(action, JSON.parse(kunciPayload))
      .then((hasil) => { if (!dibatalkan) setData(hasil) })
      .catch((e) => {
        // Komponen yang sudah dilepas tidak boleh menulis state — itu sumber
        // peringatan React yang membingungkan saat pengguna berpindah cepat.
        if (dibatalkan) return
        setGalat(e instanceof ApiError ? e : new ApiError('ERROR', e.message))
      })
      .finally(() => { if (!dibatalkan) setMemuat(false) })

    return () => { dibatalkan = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, kunciPayload, penanda, ...deps])

  const muatUlang = useCallback(() => setPenanda((n) => n + 1), [])
  return { data, galat, memuat, muatUlang }
}

/**
 * Kirim satu action atas perintah pengguna, misalnya saat menekan Simpan.
 *
 * Berbeda dari useMuat yang berjalan sendiri saat halaman dibuka.
 */
export function useKirim() {
  const [sibuk, setSibuk] = useState(false)
  const [galat, setGalat] = useState(null)

  const kirim = useCallback(async (action, payload) => {
    setSibuk(true)
    setGalat(null)
    try {
      return await panggilApi(action, payload)
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError('ERROR', e.message)
      setGalat(err)
      throw err
    } finally {
      setSibuk(false)
    }
  }, [])

  return { kirim, sibuk, galat, bersihkanGalat: () => setGalat(null) }
}
