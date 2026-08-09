import { useState } from 'react'
import { panggilApi, ping, ApiError } from './lib/api'
import { simpanSesi, hapusSesi, ambilUser, sudahLogin } from './lib/auth'

/**
 * Halaman Cek Koneksi — perkakas verifikasi Fase 0, bukan halaman untuk
 * pengguna akhir.
 *
 * Gunanya memisahkan tiga kegagalan yang gejalanya di layar tampak sama
 * padahal penyebabnya berbeda jauh:
 *
 *   1. VITE_API_URL belum diisi          -> frontend tidak tahu harus ke mana
 *   2. ping gagal                        -> web app belum ter-deploy benar
 *   3. ping berhasil tapi login gagal    -> data users belum terimpor
 *
 * Halaman ini diganti Login yang sesungguhnya di Fase 1.
 */

const urlApi = import.meta.env.VITE_API_URL || ''

export default function App() {
  const [hasilPing, setHasilPing] = useState(null)
  const [hasilLogin, setHasilLogin] = useState(null)
  const [diagnostik, setDiagnostik] = useState(null)
  const [sibuk, setSibuk] = useState('')
  const [user, setUser] = useState(ambilUser())
  const [form, setForm] = useState({ username: '', password: '' })
  const [formPw, setFormPw] = useState({ lama: '', baru: '', ulangi: '' })
  const [hasilPw, setHasilPw] = useState(null)

  async function jalankan(nama, fn, setHasil) {
    setSibuk(nama)
    setHasil(null)
    try {
      setHasil({ ok: true, data: await fn() })
    } catch (e) {
      setHasil({
        ok: false,
        kode: e instanceof ApiError ? e.kode : 'ERROR',
        pesan: e.message,
      })
    } finally {
      setSibuk('')
    }
  }

  async function masuk(ev) {
    ev.preventDefault()
    await jalankan('login', async () => {
      const data = await panggilApi('auth.login', form)
      simpanSesi(data.token, data.user)
      setUser(data.user)
      return data.user
    }, setHasilLogin)
  }

  function keluar() {
    hapusSesi()
    setUser(null)
    setHasilLogin(null)
    setDiagnostik(null)
    setHasilPw(null)
    setFormPw({ lama: '', baru: '', ulangi: '' })
  }

  async function gantiPassword(ev) {
    ev.preventDefault()

    // Kecocokan dua isian diperiksa di sini karena backend tidak mungkin
    // tahu pengguna salah ketik. Aturan lainnya — panjang minimal, harus
    // berbeda dari yang lama, kebenaran password lama — tetap ditegakkan
    // di Apps Script, bukan di sini.
    if (formPw.baru !== formPw.ulangi) {
      setHasilPw({ ok: false, kode: 'TIDAK_COCOK', pesan: 'Ketikan password baru tidak sama.' })
      return
    }

    await jalankan('pw', async () => {
      const data = await panggilApi('auth.changePassword', {
        password_lama: formPw.lama,
        password_baru: formPw.baru,
      })
      setFormPw({ lama: '', baru: '', ulangi: '' })
      return data
    }, setHasilPw)
  }

  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-3xl space-y-5">

        <header>
          <h1 className="text-2xl font-bold text-slate-900">CV Azama Sejahtera</h1>
          <p className="text-slate-600">Sistem Informasi Internal — Cek Koneksi</p>
        </header>

        {/* Langkah 1 — konfigurasi */}
        <Kartu nomor="1" judul="Alamat server">
          {urlApi ? (
            <Status ok>
              Terisi: <code className="break-all text-xs">{urlApi}</code>
            </Status>
          ) : (
            <Status>
              <p className="font-medium">VITE_API_URL belum diisi.</p>
              <p className="mt-1 text-sm">
                Buat berkas <code>frontend/.env.local</code> berisi satu baris:
              </p>
              <pre className="mt-2 overflow-x-auto rounded bg-slate-900 p-2 text-xs text-slate-100">
                VITE_API_URL=https://script.google.com/macros/s/.../exec
              </pre>
              <p className="mt-1 text-sm">Lalu jalankan ulang <code>npm run dev</code>.</p>
            </Status>
          )}
        </Kartu>

        {/* Langkah 2 — backend hidup */}
        <Kartu nomor="2" judul="Backend hidup">
          <Tombol
            onClick={() => jalankan('ping', ping, setHasilPing)}
            sibuk={sibuk === 'ping'}
            nonaktif={!urlApi}
          >
            Uji koneksi
          </Tombol>
          <Hasil hasil={hasilPing} />
        </Kartu>

        {/* Langkah 3 — login */}
        <Kartu nomor="3" judul="Login">
          {user ? (
            <div className="space-y-3">
              <Status ok>
                Masuk sebagai <strong>{user.full_name}</strong> ({user.role})
                {user.sales_person_name && ` — sales: ${user.sales_person_name}`}
              </Status>
              <Tombol onClick={keluar} varian="abu">Keluar</Tombol>
            </div>
          ) : (
            <form onSubmit={masuk} className="space-y-3">
              <Isian
                label="Username"
                value={form.username}
                onChange={(v) => setForm({ ...form, username: v })}
              />
              <Isian
                label="Password"
                type="password"
                value={form.password}
                onChange={(v) => setForm({ ...form, password: v })}
              />
              <Tombol
                type="submit"
                sibuk={sibuk === 'login'}
                nonaktif={!urlApi || !form.username || !form.password}
              >
                Masuk
              </Tombol>
            </form>
          )}
          <Hasil hasil={hasilLogin} />
        </Kartu>

        {/* Langkah 4 — data terimpor */}
        {user?.role === 'admin' && (
          <Kartu nomor="4" judul="Data terimpor">
            <Tombol
              onClick={() => jalankan(
                'diag',
                () => panggilApi('system.diagnostics'),
                setDiagnostik
              )}
              sibuk={sibuk === 'diag'}
            >
              Hitung isi spreadsheet
            </Tombol>

            {diagnostik?.ok && (
              <div className="mt-3 space-y-3">
                <p className="text-sm text-slate-700">
                  Total omzet tercatat:{' '}
                  <strong>
                    Rp {diagnostik.data.total_omzet_tercatat.toLocaleString('id-ID')}
                  </strong>
                  {diagnostik.data.total_omzet_tercatat === 49020000 && (
                    <span className="ml-2 text-emerald-700">
                      cocok dengan total di Excel
                    </span>
                  )}
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <tbody>
                      {Object.entries(diagnostik.data.jumlah_baris).map(([tab, n]) => (
                        <tr key={tab} className="border-b border-slate-100">
                          <td className="py-1 pr-4 text-slate-600">{tab}</td>
                          <td className="py-1 text-right font-mono">
                            {n === null ? 'tab belum ada' : n}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {diagnostik && !diagnostik.ok && <Hasil hasil={diagnostik} />}
          </Kartu>
        )}

        {/* Langkah 5 — ganti password bawaan */}
        {user && (
          <Kartu nomor="5" judul="Ganti password">
            <p className="mb-3 text-sm text-slate-600">
              Password awal dibangkitkan acak oleh skrip migrasi dan tersimpan
              sebagai teks polos di berkas <code>KREDENSIAL_AWAL.txt</code>.
              Setiap pengguna sebaiknya menggantinya sekali di sini, lalu
              berkas itu dihapus.
            </p>
            <form onSubmit={gantiPassword} className="space-y-3">
              <Isian
                label="Password sekarang"
                type="password"
                value={formPw.lama}
                onChange={(v) => setFormPw({ ...formPw, lama: v })}
              />
              <Isian
                label="Password baru (minimal 8 karakter)"
                type="password"
                autoComplete="new-password"
                value={formPw.baru}
                onChange={(v) => setFormPw({ ...formPw, baru: v })}
              />
              <Isian
                label="Ulangi password baru"
                type="password"
                autoComplete="new-password"
                value={formPw.ulangi}
                onChange={(v) => setFormPw({ ...formPw, ulangi: v })}
              />
              <Tombol
                type="submit"
                sibuk={sibuk === 'pw'}
                nonaktif={!formPw.lama || !formPw.baru || !formPw.ulangi}
              >
                Simpan password baru
              </Tombol>
            </form>
            <Hasil hasil={hasilPw} />
          </Kartu>
        )}

        <p className="pb-4 text-center text-xs text-slate-500">
          Halaman ini diganti antarmuka sesungguhnya pada Fase 1.
        </p>
      </div>
    </div>
  )
}

/* --- Komponen tampilan sederhana ------------------------------------------ */

function Kartu({ nomor, judul, children }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 flex items-center gap-2 font-semibold text-slate-800">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 text-xs text-white">
          {nomor}
        </span>
        {judul}
      </h2>
      {children}
    </section>
  )
}

function Status({ ok, children }) {
  return (
    <div
      className={`rounded border p-3 text-sm ${
        ok
          ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
          : 'border-amber-200 bg-amber-50 text-amber-900'
      }`}
    >
      {children}
    </div>
  )
}

function Hasil({ hasil }) {
  if (!hasil) return null
  if (hasil.ok) {
    return (
      <pre className="mt-3 overflow-x-auto rounded bg-emerald-50 p-3 text-xs text-emerald-900">
        {JSON.stringify(hasil.data, null, 2)}
      </pre>
    )
  }
  return (
    <div className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-900">
      <p className="font-mono text-xs text-red-700">{hasil.kode}</p>
      <p className="mt-1">{hasil.pesan}</p>
    </div>
  )
}

function Tombol({ children, sibuk, nonaktif, varian = 'gelap', ...sisa }) {
  const warna =
    varian === 'abu'
      ? 'bg-slate-200 text-slate-800 hover:bg-slate-300'
      : 'bg-slate-800 text-white hover:bg-slate-700'
  return (
    <button
      {...sisa}
      disabled={sibuk || nonaktif}
      className={`rounded px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${warna}`}
    >
      {sibuk ? 'Memproses...' : children}
    </button>
  )
}

function Isian({ label, type = 'text', value, onChange, autoComplete }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={
          autoComplete || (type === 'password' ? 'current-password' : 'username')
        }
        className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
      />
    </label>
  )
}
