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

      {punyaRole('admin') && (
        <div className="mt-5">
          <PemeriksaIntegritas />
        </div>
      )}
    </>
  )
}

/**
 * Pemeriksa integritas.
 *
 * Spreadsheet bisa disunting langsung, dan itu memang berguna — tim bisa
 * menambal data tanpa menunggu fitur dibuat. Tapi penyuntingan manual
 * melewati seluruh validasi dan efek samping yang biasanya dikerjakan
 * Apps Script, dan selisihnya tidak akan muncul dengan sendirinya.
 */
function PemeriksaIntegritas() {
  const { kirim, sibuk, galat } = useKirim()
  const [hasil, setHasil] = useState(null)

  async function periksa(perbaiki) {
    try {
      setHasil(await kirim('system.integrity', { perbaiki_stok: perbaiki }))
    } catch {
      // pesan galat sudah ditampilkan
    }
  }

  const bisaDiperbaiki = hasil?.temuan?.some((t) => t.kode === 'DIBUAT_DI_LUAR_SISTEM')

  return (
    <Kartu
      judul="Pemeriksaan keutuhan data"
      aksi={
        <Tombol ukuran="kecil" sibuk={sibuk} onClick={() => periksa(false)}>
          {hasil ? 'Periksa ulang' : 'Periksa sekarang'}
        </Tombol>
      }
    >
      {!hasil && !galat && (
        <p className="text-sm text-slate-500">
          Memeriksa penjualan yang ditambahkan langsung di spreadsheet, nomor
          yang kembar, tanggal yang janggal, subtotal yang tidak cocok dengan
          itemnya, dan referensi yang menunjuk data tidak ada.
        </p>
      )}

      {galat && <Galat galat={galat} />}

      {hasil && (
        <>
          <div className="mb-4 flex flex-wrap gap-3">
            <Hitungan label="Parah" jumlah={hasil.jumlah.parah} nada="buruk" />
            <Hitungan label="Peringatan" jumlah={hasil.jumlah.peringatan} nada="perhatian" />
            <Hitungan label="Catatan" jumlah={hasil.jumlah.catatan} nada="netral" />
          </div>

          {hasil.sehat && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              Tidak ada temuan. Seluruh referensi utuh dan angkanya konsisten.
            </div>
          )}

          <ul className="space-y-3">
            {hasil.temuan.map((t, i) => (
              <li
                key={i}
                className={`rounded-lg border p-4 ${
                  t.tingkat === 'parah'
                    ? 'border-red-200 bg-red-50'
                    : t.tingkat === 'peringatan'
                      ? 'border-amber-200 bg-amber-50'
                      : 'border-slate-200 bg-slate-50'
                }`}
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-medium text-slate-900">{t.kode}</span>
                  {t.jumlah > 0 && (
                    <span className="text-sm text-slate-500">{t.jumlah} baris</span>
                  )}
                </div>
                <p className="mt-1 text-sm text-slate-700">{t.pesan}</p>
                {t.contoh?.length > 0 && (
                  <ul className="mt-2 space-y-0.5">
                    {t.contoh.map((c, j) => (
                      <li key={j} className="font-mono text-xs text-slate-600">{c}</li>
                    ))}
                    {t.jumlah > t.contoh.length && (
                      <li className="text-xs text-slate-400">
                        dan {t.jumlah - t.contoh.length} lainnya
                      </li>
                    )}
                  </ul>
                )}
              </li>
            ))}
          </ul>

          {bisaDiperbaiki && (
            <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-sm text-slate-700">
                Penjualan yang disisipkan manual bisa dilengkapi mutasi barang
                keluarnya secara otomatis. Tanggal mutasi mengikuti tanggal
                penjualannya, bukan hari ini, supaya laporan per periode tetap
                benar. Tidak ada baris yang diubah atau dihapus — hanya ditambah.
              </p>
              <div className="mt-3">
                <Tombol varian="kedua" sibuk={sibuk} onClick={() => periksa(true)}>
                  Lengkapi mutasi yang hilang
                </Tombol>
              </div>
            </div>
          )}

          {hasil.diperbaiki && (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              {hasil.diperbaiki.baris_mutasi_ditambahkan} baris mutasi ditambahkan
              untuk {hasil.diperbaiki.invoice_diperbaiki.length} invoice:{' '}
              {hasil.diperbaiki.invoice_diperbaiki.join(', ')}
            </div>
          )}

          <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400">
            Diperiksa {hasil.diperiksa_pada} · {hasil.jumlah_baris.sales_orders} penjualan,{' '}
            {hasil.jumlah_baris.sales_order_items} baris item,{' '}
            {hasil.jumlah_baris.stock_movements} mutasi
          </p>
        </>
      )}
    </Kartu>
  )
}

function Hitungan({ label, jumlah, nada }) {
  const warna = jumlah === 0
    ? 'bg-slate-100 text-slate-500'
    : { buruk: 'bg-red-100 text-red-800', perhatian: 'bg-amber-100 text-amber-900', netral: 'bg-slate-100 text-slate-700' }[nada]
  return (
    <div className={`rounded-lg px-4 py-2 ${warna}`}>
      <span className="text-lg font-bold tabular-nums">{jumlah}</span>
      <span className="ml-2 text-sm">{label}</span>
    </div>
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
