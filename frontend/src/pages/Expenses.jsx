import { useState } from 'react'
import { useMuat, useKirim } from '../lib/hooks'
import { rupiah, angka, tanggalPendek, hariIniIso } from '../lib/format'
import {
  JudulHalaman, Kartu, Statistik, Tombol, Isian, Pilihan,
  SedangMemuat, Galat, Kosong, Tabel, Sel,
} from '../components/ui'

/**
 * Biaya operasional dan laporan laba rugi.
 *
 * Keduanya disatukan dalam satu halaman karena memang saling menjelaskan:
 * angka laba bersih tidak bermakna tanpa tahu biaya apa saja yang sudah
 * tercatat, dan biaya tidak bermakna tanpa tahu pengaruhnya ke laba.
 */
export default function Expenses() {
  const [tab, setTab] = useState('labarugi')

  return (
    <>
      <JudulHalaman
        judul="Biaya & laba rugi"
        keterangan="Laba bersih dihitung dari omzet dikurangi harga pokok dikurangi biaya operasional"
      />

      <div className="mb-5 flex gap-1 border-b border-slate-200">
        {[['labarugi', 'Laba rugi'], ['biaya', 'Biaya operasional']].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition ${
              tab === k
                ? 'border-sky-600 text-sky-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'labarugi' ? <LabaRugi /> : <DaftarBiaya />}
    </>
  )
}

/* --- laba rugi ------------------------------------------------------------- */

function LabaRugi() {
  const { data, galat, memuat, muatUlang } = useMuat('report.profitLoss', { bulan: 12 })

  if (memuat) return <SedangMemuat pesan="Menghitung laba rugi..." />
  if (galat) return <Galat galat={galat} coba={muatUlang} />

  const t = data.total

  return (
    <>
      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Statistik label="Omzet" nilai={rupiah(t.omzet)}
          catatan={`${angka(t.invoice)} invoice`} />
        <Statistik label="Harga pokok" nilai={rupiah(t.hpp)}
          nada={data.hpp_lengkap ? 'netral' : 'perhatian'}
          catatan={data.hpp_lengkap ? '' : `${angka(data.baris_tanpa_hpp)} baris tanpa HPP`} />
        <Statistik label="Laba kotor" nilai={rupiah(t.laba_kotor)} nada="baik"
          catatan={`margin ${t.margin_kotor_persen}%`} />
        <Statistik
          label="Laba bersih"
          nilai={rupiah(t.laba_bersih)}
          nada={t.laba_bersih > 0 ? 'baik' : 'buruk'}
          catatan={`setelah biaya ${rupiah(t.biaya)}`}
        />
      </div>

      {!data.ada_biaya_tercatat && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="font-medium text-amber-900">Laba bersih belum bisa dipercaya</p>
          <p className="mt-0.5 text-sm text-amber-800">{data.catatan}</p>
        </div>
      )}

      {!data.hpp_lengkap && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="font-medium text-amber-900">
            {angka(data.baris_tanpa_hpp)} baris transaksi tersimpan tanpa HPP
          </p>
          <p className="mt-0.5 text-sm text-amber-800">
            Baris itu terhitung berlaba penuh, sehingga margin di atas lebih
            tinggi daripada kenyataan. HPP diambil dari nilai yang tersimpan di
            baris transaksi, bukan dari master saat ini — mengubah HPP di Master
            hari ini tidak akan memperbaiki laporan bulan lalu.
          </p>
        </div>
      )}

      {data.omzet_di_luar_periode !== 0 && (
        <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm text-slate-600">
            {rupiah(data.omzet_di_luar_periode)} omzet berada di luar {data.periode_bulan}{' '}
            bulan terakhir, biasanya karena tanggal invoice salah ketik tahun.
            Angka itu tidak masuk tabel di bawah, tapi ikut terhitung di Dashboard.
          </p>
        </div>
      )}

      <Kartu judul={`Rincian ${data.periode_bulan} bulan terakhir`} padat>
        <Tabel
          kepala={[
            { label: 'Bulan' },
            { label: 'Omzet', kanan: true },
            { label: 'HPP', kanan: true },
            { label: 'Laba kotor', kanan: true },
            { label: 'Biaya', kanan: true },
            { label: 'Laba bersih', kanan: true },
          ]}
        >
          {data.bulanan.map((b) => (
            <tr key={b.bulan} className={b.omzet === 0 && b.biaya === 0 ? 'text-slate-300' : ''}>
              <Sel tebal>{b.label}</Sel>
              <Sel kanan samar>{b.omzet ? rupiah(b.omzet) : '—'}</Sel>
              <Sel kanan samar>{b.hpp ? rupiah(b.hpp) : '—'}</Sel>
              <Sel kanan>
                {b.omzet ? (
                  <>
                    {rupiah(b.laba_kotor)}
                    <span className="ml-1.5 text-xs text-slate-400">{b.margin_persen}%</span>
                  </>
                ) : '—'}
              </Sel>
              <Sel kanan samar>{b.biaya ? rupiah(b.biaya) : '—'}</Sel>
              <Sel kanan tebal>
                {b.omzet || b.biaya ? (
                  <span className={b.laba_bersih < 0 ? 'text-red-600' : 'text-slate-900'}>
                    {rupiah(b.laba_bersih)}
                  </span>
                ) : '—'}
              </Sel>
            </tr>
          ))}
          <tr className="bg-slate-50">
            <Sel tebal>Total</Sel>
            <Sel kanan tebal>{rupiah(t.omzet)}</Sel>
            <Sel kanan tebal>{rupiah(t.hpp)}</Sel>
            <Sel kanan tebal>{rupiah(t.laba_kotor)}</Sel>
            <Sel kanan tebal>{rupiah(t.biaya)}</Sel>
            <Sel kanan tebal>
              <span className={t.laba_bersih < 0 ? 'text-red-600' : 'text-slate-900'}>
                {rupiah(t.laba_bersih)}
              </span>
            </Sel>
          </tr>
        </Tabel>
      </Kartu>

      <p className="mt-4 pb-4 text-sm text-slate-500">
        Pembelian bahan baku sengaja tidak ikut dikurangkan di sini, karena biaya
        bahan sudah terkandung di dalam HPP tiap produk. Menghitungnya dua kali
        akan membuat perusahaan terlihat merugi padahal tidak.
      </p>
    </>
  )
}

/* --- daftar biaya ---------------------------------------------------------- */

function DaftarBiaya() {
  const [filter, setFilter] = useState({ dari: '', sampai: '', category: '' })
  const { data, galat, memuat, muatUlang } = useMuat('expense.list', filter)
  const [form, setForm] = useState(false)
  const [batal, setBatal] = useState(null)

  if (memuat) return <SedangMemuat />
  if (galat) return <Galat galat={galat} coba={muatUlang} />

  return (
    <>
      {form && (
        <FormBiaya
          kategori={data.kategori_tersedia}
          onTutup={() => setForm(false)}
          onSelesai={() => { setForm(false); muatUlang() }}
        />
      )}
      {batal && (
        <FormPembatalan
          biaya={batal}
          onTutup={() => setBatal(null)}
          onSelesai={() => { setBatal(null); muatUlang() }}
        />
      )}

      <div className="mb-5 grid gap-4 sm:grid-cols-2">
        <Statistik label="Total biaya" nilai={rupiah(data.total)}
          catatan={`${angka(data.jumlah_total)} catatan`} />
        <Kartu>
          <p className="mb-2 text-sm font-medium text-slate-500">Sebaran kategori</p>
          {data.per_kategori.length === 0 ? (
            <p className="text-sm text-slate-400">belum ada</p>
          ) : (
            <div className="space-y-1.5">
              {data.per_kategori.slice(0, 4).map((k) => (
                <div key={k.category} className="flex justify-between text-sm">
                  <span className="text-slate-600">{k.category}</span>
                  <span className="tabular-nums text-slate-800">
                    {rupiah(k.nilai)}
                    <span className="ml-2 text-slate-400">{k.persen}%</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </Kartu>
      </div>

      <Kartu
        padat
        judul="Catatan biaya"
        aksi={<Tombol ukuran="kecil" onClick={() => setForm(true)}>+ Catat biaya</Tombol>}
      >
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
          <Pilihan label="Kategori" value={filter.category}
            onChange={(e) => setFilter({ ...filter, category: e.target.value })}
            className="w-48">
            <option value="">Semua</option>
            {data.kategori_tersedia.map((k) => <option key={k} value={k}>{k}</option>)}
          </Pilihan>
          <Isian label="Dari" type="date" value={filter.dari}
            onChange={(e) => setFilter({ ...filter, dari: e.target.value })} className="w-44" />
          <Isian label="Sampai" type="date" value={filter.sampai}
            onChange={(e) => setFilter({ ...filter, sampai: e.target.value })} className="w-44" />
        </div>

        {data.daftar.length === 0 ? (
          <Kosong
            judul="Belum ada biaya tercatat"
            keterangan="Tanpa biaya operasional, laba bersih akan sama dengan laba kotor — dan itu belum menggambarkan keuntungan yang sesungguhnya."
          />
        ) : (
          <Tabel
            kepala={[
              { label: 'Tanggal' },
              { label: 'Kategori' },
              { label: 'Keterangan' },
              { label: 'Nominal', kanan: true },
              { label: '' },
            ]}
          >
            {data.daftar.map((b) => (
              <tr key={b.expense_id} className={b.pembatalan ? 'bg-slate-50' : ''}>
                <Sel samar>{tanggalPendek(b.expense_date)}</Sel>
                <Sel>{b.category}</Sel>
                <Sel samar>
                  <span className="block max-w-md truncate">{b.description}</span>
                </Sel>
                <Sel kanan tebal>
                  <span className={b.pembatalan ? 'text-emerald-700' : ''}>
                    {rupiah(b.amount)}
                  </span>
                </Sel>
                <Sel>
                  <div className="flex justify-end">
                    {!b.pembatalan && (
                      <Tombol varian="polos" ukuran="kecil" onClick={() => setBatal(b)}>
                        Batalkan
                      </Tombol>
                    )}
                  </div>
                </Sel>
              </tr>
            ))}
          </Tabel>
        )}
      </Kartu>
    </>
  )
}

function FormBiaya({ kategori, onTutup, onSelesai }) {
  const { kirim, sibuk, galat } = useKirim()
  const [f, setF] = useState({
    expense_date: hariIniIso(), category: '', amount: '', description: '',
  })

  async function simpan(ev) {
    ev.preventDefault()
    try {
      await kirim('expense.create', { ...f, amount: Number(f.amount) || 0 })
      onSelesai()
    } catch {
      // pesan galat sudah ditampilkan
    }
  }

  return (
    <Panel judul="Catat biaya operasional" onTutup={onTutup}>
      <form onSubmit={simpan} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Pilihan label="Kategori" value={f.category}
            onChange={(e) => setF({ ...f, category: e.target.value })}>
            <option value="">— pilih kategori —</option>
            {kategori.map((k) => <option key={k} value={k}>{k}</option>)}
          </Pilihan>
          <Isian label="Nominal" type="number" min="1" value={f.amount}
            onChange={(e) => setF({ ...f, amount: e.target.value })} />
          <Isian label="Tanggal" type="date" value={f.expense_date} max={hariIniIso()}
            onChange={(e) => setF({ ...f, expense_date: e.target.value })} />
        </div>
        <Isian label="Keterangan" value={f.description}
          onChange={(e) => setF({ ...f, description: e.target.value })}
          placeholder="Misalnya: PLN Agustus"
          keterangan="Wajib — tanpa ini biaya lama tidak bisa ditelusuri lagi" />

        {galat && <Galat galat={galat} />}

        <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
          <Tombol varian="kedua" type="button" onClick={onTutup}>Batal</Tombol>
          <Tombol type="submit" sibuk={sibuk}
            nonaktif={!f.category || !f.amount || !f.description}>
            Simpan
          </Tombol>
        </div>
      </form>
    </Panel>
  )
}

function FormPembatalan({ biaya, onTutup, onSelesai }) {
  const { kirim, sibuk, galat } = useKirim()
  const [alasan, setAlasan] = useState('')

  async function simpan(ev) {
    ev.preventDefault()
    try {
      await kirim('expense.reverse', { expense_id: biaya.expense_id, alasan })
      onSelesai()
    } catch {
      // pesan galat sudah ditampilkan
    }
  }

  return (
    <Panel judul="Batalkan biaya" onTutup={onTutup}>
      <form onSubmit={simpan} className="space-y-4">
        <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm">
          <p className="font-medium text-slate-800">{biaya.description}</p>
          <p className="text-slate-500">
            {biaya.category} · {tanggalPendek(biaya.expense_date)} · {rupiah(biaya.amount)}
          </p>
        </div>
        <p className="text-sm text-slate-600">
          Baris aslinya tidak dihapus. Pembatalan ditulis sebagai baris bernilai
          negatif, sehingga laporan langsung terkoreksi tapi jejaknya tetap ada.
        </p>
        <Isian label="Alasan pembatalan" value={alasan} autoFocus
          onChange={(e) => setAlasan(e.target.value)}
          placeholder="Misalnya: dobel input" />

        {galat && <Galat galat={galat} />}

        <div className="flex justify-end gap-3">
          <Tombol varian="kedua" type="button" onClick={onTutup}>Jangan jadi</Tombol>
          <Tombol varian="bahaya" type="submit" sibuk={sibuk} nonaktif={!alasan.trim()}>
            Ya, batalkan
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
