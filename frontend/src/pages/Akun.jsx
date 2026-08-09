import { useState } from 'react'
import { useKirim, useMuat } from '../lib/hooks'
import { ambilUser, punyaRole } from '../lib/auth'
import { rupiah } from '../lib/format'
import {
  JudulHalaman, Kartu, Tombol, Isian, Galat, SedangMemuat, Status,
} from '../components/ui'

/**
 * Akun — ganti password dan periksa sambungan.
 *
 * Halaman ini menggantikan layar Cek Koneksi dari Fase 0. Isi diagnostiknya
 * dipertahankan karena tetap berguna: kalau suatu saat sistem terasa aneh,
 * ini tempat pertama untuk memastikan backend dan datanya masih waras.
 */
export default function Akun() {
  const user = ambilUser()

  return (
    <>
      <JudulHalaman
        judul="Akun"
        keterangan={`${user?.full_name} · ${user?.username}`}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <GantiPassword />
        {punyaRole('admin') ? <Diagnostik /> : <InfoAkun user={user} />}
      </div>
    </>
  )
}

function GantiPassword() {
  const { kirim, sibuk, galat } = useKirim()
  const [f, setF] = useState({ lama: '', baru: '', ulangi: '' })
  const [selesai, setSelesai] = useState(false)
  const [tidakCocok, setTidakCocok] = useState(false)

  async function simpan(ev) {
    ev.preventDefault()
    setSelesai(false)

    // Kecocokan ketikan diperiksa di sini karena server tidak mungkin tahu
    // pengguna salah ketik. Aturan lain tetap ditegakkan di Apps Script.
    if (f.baru !== f.ulangi) {
      setTidakCocok(true)
      return
    }
    setTidakCocok(false)

    try {
      await kirim('auth.changePassword', {
        password_lama: f.lama,
        password_baru: f.baru,
      })
      setF({ lama: '', baru: '', ulangi: '' })
      setSelesai(true)
    } catch {
      // pesan galat sudah ditampilkan
    }
  }

  return (
    <Kartu judul="Ganti password">
      <form onSubmit={simpan} className="space-y-4">
        <Isian
          label="Password sekarang"
          type="password"
          autoComplete="current-password"
          value={f.lama}
          onChange={(e) => setF({ ...f, lama: e.target.value })}
        />
        <Isian
          label="Password baru"
          type="password"
          autoComplete="new-password"
          value={f.baru}
          onChange={(e) => setF({ ...f, baru: e.target.value })}
          keterangan="Minimal 8 karakter"
        />
        <Isian
          label="Ulangi password baru"
          type="password"
          autoComplete="new-password"
          value={f.ulangi}
          onChange={(e) => { setF({ ...f, ulangi: e.target.value }); setTidakCocok(false) }}
          galat={tidakCocok ? 'Ketikan password baru tidak sama.' : undefined}
        />

        {galat && <Galat galat={galat} />}

        {selesai && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            Password berhasil diganti. Gunakan password baru saat login berikutnya.
          </div>
        )}

        <Tombol type="submit" sibuk={sibuk}
          nonaktif={!f.lama || !f.baru || !f.ulangi}>
          Simpan password baru
        </Tombol>
      </form>
    </Kartu>
  )
}

function Diagnostik() {
  const { data, galat, memuat, muatUlang } = useMuat('system.diagnostics', {})

  return (
    <Kartu
      judul="Kondisi sistem"
      aksi={<Tombol varian="polos" ukuran="kecil" onClick={muatUlang}>Muat ulang</Tombol>}
    >
      {memuat && <SedangMemuat pesan="Menghitung isi spreadsheet..." />}
      {galat && <Galat galat={galat} coba={muatUlang} />}

      {data && (
        <>
          <div className="mb-4 rounded-lg bg-slate-50 px-4 py-3">
            <p className="text-sm text-slate-500">Total omzet tercatat</p>
            <p className="text-xl font-bold tabular-nums text-slate-900">
              {rupiah(data.total_omzet_tercatat)}
            </p>
          </div>

          <dl className="max-h-72 space-y-1.5 overflow-y-auto text-sm">
            {Object.entries(data.jumlah_baris).map(([tab, n]) => (
              <div key={tab} className="flex items-center justify-between gap-4">
                <dt className="text-slate-600">{tab}</dt>
                <dd className="tabular-nums text-slate-800">
                  {n === null
                    ? <Status nilai="nonaktif" teks="tab tidak ada" />
                    : n.toLocaleString('id-ID')}
                </dd>
              </div>
            ))}
          </dl>

          <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400">
            Waktu server {data.waktu_server}
          </p>
        </>
      )}
    </Kartu>
  )
}

function InfoAkun({ user }) {
  return (
    <Kartu judul="Hak akses Anda">
      <dl className="space-y-3 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-slate-500">Role</dt>
          <dd className="font-medium text-slate-800">{user?.role}</dd>
        </div>
        {user?.sales_person_name && (
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Nama sales</dt>
            <dd className="font-medium text-slate-800">{user.sales_person_name}</dd>
          </div>
        )}
      </dl>
      <p className="mt-4 border-t border-slate-100 pt-3 text-sm text-slate-500">
        Sebagai sales, Anda hanya melihat customer dan penjualan yang kolom
        salesnya bernama <strong>{user?.sales_person_name || '(belum diatur)'}</strong>.
        Hubungi administrator bila ada customer yang seharusnya muncul.
      </p>
    </Kartu>
  )
}
