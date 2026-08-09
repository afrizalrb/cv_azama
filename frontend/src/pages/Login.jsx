import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { panggilApi, ApiError } from '../lib/api'
import { simpanSesi } from '../lib/auth'
import { Isian, Tombol } from '../components/ui'

/**
 * Halaman masuk.
 *
 * Pesan galat sengaja ditampilkan apa adanya dari server. Backend sudah
 * menyamakan pesan untuk "username tidak ada" dan "password salah", sehingga
 * tidak ada yang bocor dari sini.
 */
export default function Login() {
  const [form, setForm] = useState({ username: '', password: '' })
  const [galat, setGalat] = useState(null)
  const [sibuk, setSibuk] = useState(false)
  const navigate = useNavigate()

  async function masuk(ev) {
    ev.preventDefault()
    setSibuk(true)
    setGalat(null)
    try {
      const data = await panggilApi('auth.login', {
        username: form.username.trim(),
        password: form.password,
      })
      simpanSesi(data.token, data.user)
      navigate(data.user.role === 'produksi' ? '/galon' : '/penjualan', { replace: true })
    } catch (e) {
      setGalat(e instanceof ApiError ? e : new ApiError('ERROR', e.message))
    } finally {
      setSibuk(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-7 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-600 shadow-lg shadow-sky-600/20">
            <svg className="h-8 w-8 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2.5c-.4 0-.7.2-.9.5C9.4 5.6 5.5 11.3 5.5 14.8a6.5 6.5 0 1 0 13 0c0-3.5-3.9-9.2-5.6-11.8a1 1 0 0 0-.9-.5Z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-slate-900">CV Azama Sejahtera</h1>
          <p className="mt-1 text-sm text-slate-500">Sistem Informasi Internal</p>
        </div>

        <form
          onSubmit={masuk}
          className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <Isian
            label="Username"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            autoComplete="username"
            autoFocus
            placeholder="admin"
          />
          <Isian
            label="Password"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            autoComplete="current-password"
          />

          {galat && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-3">
              <p className="text-sm font-medium text-red-900">{galat.message}</p>
              <code className="mt-0.5 block text-[11px] text-red-500">{galat.kode}</code>
            </div>
          )}

          <Tombol
            type="submit"
            sibuk={sibuk}
            nonaktif={!form.username || !form.password}
            className="w-full"
          >
            Masuk
          </Tombol>
        </form>

        <p className="mt-5 text-center text-xs text-slate-400">
          Lupa password? Hubungi administrator.
        </p>
      </div>
    </div>
  )
}
