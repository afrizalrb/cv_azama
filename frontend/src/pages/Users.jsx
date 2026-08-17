import { useState } from 'react'
import { useMuat, useKirim } from '../lib/hooks'
import { angka } from '../lib/format'
import {
  JudulHalaman, Kartu, Status, Tombol, Isian, Pilihan,
  SedangMemuat, Galat, Tabel, Sel,
} from '../components/ui'

/**
 * Manajemen pengguna. Admin saja.
 *
 * Password tidak pernah bisa dilihat, bahkan oleh admin. Yang bisa dilakukan
 * hanya membangkitkan yang baru, dan hasilnya ditampilkan satu kali saja.
 */
export default function Users() {
  const { data, galat, memuat, muatUlang } = useMuat('user.list', {})
  const [ubah, setUbah] = useState(null)
  const [password, setPassword] = useState(null)

  if (memuat) return <SedangMemuat pesan="Memuat daftar pengguna..." />
  if (galat) {
    return (
      <>
        <JudulHalaman judul="Pengguna" />
        <Galat galat={galat} coba={muatUlang} />
      </>
    )
  }

  return (
    <>
      <JudulHalaman
        judul="Pengguna"
        keterangan={`${angka(data.jumlah)} akun · ${angka(data.jumlah_admin_aktif)} admin aktif`}
        aksi={<Tombol onClick={() => setUbah({ baru: true })}>+ Pengguna baru</Tombol>}
      />

      {password && (
        <PanelPassword data={password} onTutup={() => setPassword(null)} />
      )}

      {ubah && (
        <FormUser
          awal={ubah}
          namaSalesTerpakai={data.nama_sales_terpakai}
          roleTersedia={data.role_tersedia}
          onTutup={() => setUbah(null)}
          onSelesai={(hasil) => {
            setUbah(null)
            muatUlang()
            if (hasil?.password_baru) setPassword(hasil)
          }}
        />
      )}

      <Kartu padat>
        <Tabel
          kepala={[
            { label: 'Username' },
            { label: 'Nama' },
            { label: 'Role' },
            { label: 'Aktivitas', kanan: true },
            { label: '' },
          ]}
        >
          {data.daftar.map((u) => (
            <tr key={u.user_id} className={u.is_active ? '' : 'bg-slate-50/60'}>
              <Sel tebal>
                {u.username}
                {u.diri_sendiri && (
                  <span className="ml-2 text-xs font-normal text-slate-400">Anda</span>
                )}
              </Sel>
              <Sel>
                <span className="block">{u.full_name}</span>
                {u.peringatan && (
                  <span className="text-xs text-amber-700">{u.peringatan}</span>
                )}
              </Sel>
              <Sel>
                <span className="capitalize">{u.role}</span>
                {u.sales_person_name && (
                  <span className="block text-xs text-slate-400">
                    {u.sales_person_name}
                    {u.jumlah_customer !== null && ` · ${angka(u.jumlah_customer)} customer`}
                  </span>
                )}
              </Sel>
              <Sel kanan samar>
                {u.total_aktivitas > 0 ? (
                  <>
                    <span className="font-medium text-slate-700">
                      {angka(u.total_aktivitas)}
                    </span>
                    <span className="block text-xs">
                      {[
                        u.aktivitas.penjualan && `${u.aktivitas.penjualan} jual`,
                        u.aktivitas.pembayaran && `${u.aktivitas.pembayaran} bayar`,
                        u.aktivitas.produksi && `${u.aktivitas.produksi} batch`,
                      ].filter(Boolean).join(' · ')}
                    </span>
                  </>
                ) : 'belum ada'}
              </Sel>
              <Sel>
                <div className="flex items-center justify-end gap-2">
                  {!u.is_active && <Status nilai="nonaktif" />}
                  <Tombol varian="polos" ukuran="kecil" onClick={() => setUbah(u)}>
                    Ubah
                  </Tombol>
                </div>
              </Sel>
            </tr>
          ))}
        </Tabel>
      </Kartu>

      <p className="mt-4 pb-4 text-sm text-slate-500">
        Username tidak bisa diubah setelah dibuat, karena kolom pencatat di
        seluruh tabel transaksi menyimpan username — mengubahnya akan memutus
        jejak siapa mengerjakan apa.
      </p>
    </>
  )
}

function PanelPassword({ data, onTutup }) {
  const [disalin, setDisalin] = useState(false)

  return (
    <Panel judul="Password baru" onTutup={onTutup}>
      <p className="text-sm text-slate-600">
        Password untuk <strong>{data.username}</strong>. Sampaikan lewat jalur
        pribadi, dan minta yang bersangkutan menggantinya di menu Akun.
      </p>

      <div className="my-4 flex items-center gap-3 rounded-lg border border-slate-300 bg-slate-50 px-4 py-3">
        <code className="flex-1 select-all font-mono text-lg tracking-wide text-slate-900">
          {data.password_baru}
        </code>
        <Tombol
          varian="kedua"
          ukuran="kecil"
          onClick={() => {
            navigator.clipboard?.writeText(data.password_baru)
            setDisalin(true)
          }}
        >
          {disalin ? 'Tersalin' : 'Salin'}
        </Tombol>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Password ini ditampilkan <strong>satu kali saja</strong>. Yang tersimpan
        di sistem hanya hash-nya, dan itu tidak bisa dibaca balik. Kalau tertutup
        sebelum sempat dicatat, satu-satunya jalan adalah membangkitkan yang baru.
      </div>

      <div className="mt-5">
        <Tombol onClick={onTutup}>Sudah saya catat</Tombol>
      </div>
    </Panel>
  )
}

function FormUser({ awal, namaSalesTerpakai, roleTersedia, onTutup, onSelesai }) {
  const baru = awal.baru === true
  const { kirim, sibuk, galat } = useKirim()
  const [f, setF] = useState({
    username: awal.username || '',
    full_name: awal.full_name || '',
    role: awal.role || 'sales',
    sales_person_name: awal.sales_person_name || '',
    is_active: awal.is_active ?? true,
    reset_password: false,
  })

  async function simpan(ev) {
    ev.preventDefault()
    try {
      const hasil = await kirim('user.upsert', {
        user_id: baru ? '' : awal.user_id,
        username: f.username,
        full_name: f.full_name,
        role: f.role,
        // Nama sales hanya berlaku untuk role sales; server menolak bila diisi
        // untuk role lain, jadi dikosongkan di sini agar tidak perlu ditolak.
        sales_person_name: f.role === 'sales' ? f.sales_person_name : '',
        is_active: f.is_active,
        reset_password: f.reset_password,
      })
      onSelesai(hasil)
    } catch {
      // pesan galat sudah ditampilkan
    }
  }

  return (
    <Panel judul={baru ? 'Pengguna baru' : `Ubah ${awal.username}`} onTutup={onTutup}>
      <form onSubmit={simpan} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Isian
            label="Username"
            value={f.username}
            onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })}
            disabled={!baru}
            keterangan={baru
              ? 'Huruf kecil, angka, titik, 3–20 karakter'
              : 'Tidak bisa diubah — dipakai sebagai jejak di tabel transaksi'}
          />
          <Isian label="Nama lengkap" value={f.full_name}
            onChange={(e) => setF({ ...f, full_name: e.target.value })} />
          <Pilihan label="Role" value={f.role}
            onChange={(e) => setF({ ...f, role: e.target.value })}
            keterangan={
              { admin: 'Akses penuh termasuk laba rugi dan kelola pengguna',
                sales: 'Hanya customer miliknya, tanpa margin',
                produksi: 'Batch produksi dan retur galon' }[f.role]
            }
          >
            {roleTersedia.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </Pilihan>

          {f.role === 'sales' && (
            <div>
              <Isian
                label="Nama sales"
                value={f.sales_person_name}
                onChange={(e) => setF({ ...f, sales_person_name: e.target.value })}
                list="nama-sales"
                keterangan="Harus sama persis dengan kolom sales di master customer"
              />
              <datalist id="nama-sales">
                {namaSalesTerpakai.map((n) => <option key={n} value={n} />)}
              </datalist>
            </div>
          )}
        </div>

        <div className="space-y-3 rounded-lg bg-slate-50 px-4 py-3">
          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-700">
            <input type="checkbox" checked={f.is_active}
              onChange={(e) => setF({ ...f, is_active: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500" />
            Akun aktif
          </label>

          {!baru && (
            <label className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-700">
              <input type="checkbox" checked={f.reset_password}
                onChange={(e) => setF({ ...f, reset_password: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500" />
              Bangkitkan password baru
            </label>
          )}
        </div>

        {baru && (
          <p className="text-sm text-slate-500">
            Password akan dibangkitkan otomatis dan ditampilkan satu kali setelah
            disimpan.
          </p>
        )}

        {galat && <Galat galat={galat} />}

        <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
          <Tombol varian="kedua" type="button" onClick={onTutup}>Batal</Tombol>
          <Tombol type="submit" sibuk={sibuk}
            nonaktif={!f.full_name || (baru && !f.username)}>
            Simpan
          </Tombol>
        </div>
      </form>
    </Panel>
  )
}

function Panel({ judul, onTutup, children }) {
  return (
    <div className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8">
      <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold text-slate-900">{judul}</h2>
          <button onClick={onTutup} className="rounded p-1.5 text-slate-400 hover:bg-slate-100"
            aria-label="Tutup">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}
