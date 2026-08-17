import { useMemo, useState } from 'react'
import { useMuat, useKirim } from '../lib/hooks'
import { rupiah, angka, tanggalPendek, hariIniIso } from '../lib/format'
import {
  JudulHalaman, Kartu, Statistik, Status, Tombol, Isian, Pilihan,
  SedangMemuat, Galat, Kosong, Tabel, Sel,
} from '../components/ui'

/**
 * Saldo dan mutasi galon.
 *
 * Galon kosong adalah aset fisik perusahaan yang berada di tangan customer.
 * Saldo positif berarti galon itu belum kembali. Ini satu-satunya persediaan
 * yang tetap dilacak pada model pre-order — barang jadi memang tidak distok,
 * tapi galonnya berputar terus dan bisa hilang.
 */

const JENIS = {
  gallon_out: ['Keluar', 'bg-sky-50 text-sky-700 ring-sky-600/20'],
  gallon_return: ['Kembali', 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'],
  lost: ['Hilang', 'bg-red-50 text-red-700 ring-red-600/20'],
  damaged: ['Rusak', 'bg-amber-50 text-amber-800 ring-amber-600/20'],
}

export default function Gallon() {
  const [tab, setTab] = useState('saldo')
  const [formRetur, setFormRetur] = useState(null)

  const saldo = useMuat('gallon.balance', {})

  if (saldo.memuat) return <SedangMemuat pesan="Menghitung saldo galon..." />
  if (saldo.galat) {
    return (
      <>
        <JudulHalaman judul="Galon" />
        <Galat galat={saldo.galat} coba={saldo.muatUlang} />
      </>
    )
  }

  const r = saldo.data.ringkasan

  return (
    <>
      <JudulHalaman
        judul="Galon"
        keterangan={`${angka(r.total_beredar)} galon sedang di tangan ${angka(r.jumlah_customer)} customer`}
        aksi={
          <Tombol onClick={() => setFormRetur({ customer_code: '' })}>
            + Catat retur
          </Tombol>
        }
      />

      {formRetur && (
        <FormRetur
          awal={formRetur}
          daftarCustomer={saldo.data.customer}
          onTutup={() => setFormRetur(null)}
          onSelesai={() => { setFormRetur(null); saldo.muatUlang() }}
        />
      )}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Statistik
          label="Beredar di customer"
          nilai={angka(r.total_beredar)}
          nada={r.total_beredar > 0 ? 'perhatian' : 'netral'}
          catatan="galon belum kembali"
        />
        <Statistik label="Total keluar" nilai={angka(r.total_keluar)}
          catatan="sejak sistem dipakai" />
        <Statistik label="Sudah kembali" nilai={angka(r.total_kembali)} nada="baik" />
        <Statistik
          label="Hilang & rusak"
          nilai={angka(r.total_hilang + r.total_rusak)}
          nada={r.total_hilang + r.total_rusak > 0 ? 'buruk' : 'netral'}
          catatan={`${angka(r.total_hilang)} hilang · ${angka(r.total_rusak)} rusak`}
        />
      </div>

      <div className="mb-5 flex gap-1 border-b border-slate-200">
        {[['saldo', 'Saldo per customer'], ['mutasi', 'Riwayat mutasi']].map(([k, label]) => (
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

      {tab === 'saldo'
        ? <DaftarSaldo data={saldo.data} onRetur={setFormRetur} />
        : <RiwayatMutasi />}
    </>
  )
}

function DaftarSaldo({ data, onRetur }) {
  const punyaSaldo = data.customer.filter((c) => c.saldo > 0)

  if (punyaSaldo.length === 0) {
    return (
      <Kartu>
        <Kosong
          judul="Belum ada galon yang tercatat keluar"
          keterangan="Saldo mulai terisi dari penjualan produk galon yang dibuat lewat sistem. Transaksi sebelum sistem dipakai sengaja tidak dihitung, karena galonnya secara fisik sudah ditukar berkali-kali."
        />
      </Kartu>
    )
  }

  return (
    <Kartu judul={`${punyaSaldo.length} customer memegang galon`} padat>
      <Tabel
        kepala={[
          { label: 'Customer' },
          { label: 'Rincian produk' },
          { label: 'Terakhir', kanan: true },
          { label: 'Saldo', kanan: true },
          { label: '' },
        ]}
      >
        {punyaSaldo.map((c) => (
          <tr key={c.code}>
            <Sel>
              <span className="block font-medium">{c.nama}</span>
              <span className="text-xs text-slate-400">
                {[c.code, c.area, c.sales_person].filter(Boolean).join(' · ')}
              </span>
            </Sel>
            <Sel samar>
              {c.per_produk.filter((p) => p.saldo > 0).map((p) => (
                <span key={p.product_code} className="mr-3 whitespace-nowrap">
                  {p.product_code} <strong className="text-slate-700">{angka(p.saldo)}</strong>
                </span>
              ))}
            </Sel>
            <Sel kanan samar>{c.terakhir ? tanggalPendek(c.terakhir) : '—'}</Sel>
            <Sel kanan tebal>
              <span className="text-lg">{angka(c.saldo)}</span>
            </Sel>
            <Sel>
              <div className="flex justify-end">
                <Tombol ukuran="kecil" varian="kedua"
                  onClick={() => onRetur({ customer_code: c.code })}>
                  Catat retur
                </Tombol>
              </div>
            </Sel>
          </tr>
        ))}
      </Tabel>
    </Kartu>
  )
}

function RiwayatMutasi() {
  const [filter, setFilter] = useState({ jenis: '', dari: '', sampai: '' })
  const { data, galat, memuat, muatUlang } = useMuat('gallon.movements', filter)

  return (
    <Kartu padat>
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
        <Pilihan
          label="Jenis"
          value={filter.jenis}
          onChange={(e) => setFilter({ ...filter, jenis: e.target.value })}
          className="w-44"
        >
          <option value="">Semua</option>
          <option value="gallon_out">Keluar</option>
          <option value="gallon_return">Kembali</option>
          <option value="lost">Hilang</option>
          <option value="damaged">Rusak</option>
        </Pilihan>
        <Isian label="Dari" type="date" value={filter.dari}
          onChange={(e) => setFilter({ ...filter, dari: e.target.value })} className="w-44" />
        <Isian label="Sampai" type="date" value={filter.sampai}
          onChange={(e) => setFilter({ ...filter, sampai: e.target.value })} className="w-44" />
      </div>

      {memuat && <SedangMemuat />}
      {galat && <div className="p-5"><Galat galat={galat} coba={muatUlang} /></div>}

      {!memuat && !galat && data.daftar.length === 0 && (
        <Kosong judul="Belum ada mutasi galon pada rentang ini" />
      )}

      {!memuat && !galat && data.daftar.length > 0 && (
        <Tabel
          kepala={[
            { label: 'Tanggal' },
            { label: 'Customer' },
            { label: 'Produk' },
            { label: 'Jenis' },
            { label: 'Qty', kanan: true },
            { label: 'Keterangan' },
          ]}
        >
          {data.daftar.map((m) => {
            const [label, gaya] = JENIS[m.movement_type] || [m.movement_type, '']
            return (
              <tr key={m.ledger_id}>
                <Sel samar>{tanggalPendek(m.moved_at)}</Sel>
                <Sel>{m.customer_name}</Sel>
                <Sel samar>{m.product_code}</Sel>
                <Sel>
                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${gaya}`}>
                    {label}
                  </span>
                </Sel>
                <Sel kanan tebal>
                  <span className={m.qty > 0 ? 'text-slate-900' : 'text-emerald-700'}>
                    {m.qty > 0 ? '+' : ''}{angka(m.qty)}
                  </span>
                </Sel>
                <Sel samar>
                  <span className="block max-w-xs truncate">{m.notes}</span>
                  {m.deposit_amount > 0 && (
                    <span className="text-xs text-red-600">
                      deposit {rupiah(m.deposit_amount)}
                    </span>
                  )}
                </Sel>
              </tr>
            )
          })}
        </Tabel>
      )}
    </Kartu>
  )
}

function FormRetur({ awal, daftarCustomer, onTutup, onSelesai }) {
  const { kirim, sibuk, galat } = useKirim()
  const [kodeCust, setKodeCust] = useState(awal.customer_code || '')
  const [jenis, setJenis] = useState('gallon_return')
  const [tanggal, setTanggal] = useState(hariIniIso())
  const [catatan, setCatatan] = useState('')
  const [baris, setBaris] = useState([{ product_code: '', qty: '' }])
  const [hasil, setHasil] = useState(null)

  const customer = daftarCustomer.find((c) => c.code === kodeCust)

  // Hanya produk yang benar-benar sedang dipegang customer ini yang boleh
  // dipilih. Menawarkan produk lain hanya akan berujung penolakan server.
  const produkTersedia = useMemo(
    () => (customer?.per_produk || []).filter((p) => p.saldo > 0),
    [customer],
  )

  const terisi = baris.filter((b) => b.product_code && Number(b.qty) > 0)
  const total = terisi.reduce((s, b) => s + Number(b.qty), 0)

  function ubah(i, patch) {
    setBaris((l) => l.map((b, j) => (j === i ? { ...b, ...patch } : b)))
  }

  async function simpan(ev) {
    ev.preventDefault()
    try {
      setHasil(await kirim('gallon.return', {
        customer_code: kodeCust,
        moved_at: tanggal,
        jenis,
        notes: catatan,
        items: terisi.map((b) => ({ product_code: b.product_code, qty: Number(b.qty) })),
      }))
    } catch {
      // pesan galat sudah ditampilkan
    }
  }

  if (hasil) {
    return (
      <Panel judul="Retur tersimpan" onTutup={onSelesai}>
        <p className="text-lg font-semibold text-slate-900">
          {angka(hasil.total_qty)} galon · {hasil.jenis_label}
        </p>
        <p className="mt-0.5 text-slate-600">{hasil.customer_name}</p>
        <dl className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-500">Saldo galon sekarang</dt>
            <dd className="font-semibold tabular-nums">{angka(hasil.saldo_akhir)}</dd>
          </div>
          {hasil.total_deposit > 0 && (
            <div className="flex justify-between">
              <dt className="text-slate-500">Deposit terpotong</dt>
              <dd className="font-semibold tabular-nums text-red-700">
                {rupiah(hasil.total_deposit)}
              </dd>
            </div>
          )}
        </dl>
        <div className="mt-5">
          <Tombol onClick={onSelesai}>Selesai</Tombol>
        </div>
      </Panel>
    )
  }

  return (
    <Panel judul="Catat retur galon" onTutup={onTutup}>
      <form onSubmit={simpan} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Pilihan
            label="Customer"
            value={kodeCust}
            onChange={(e) => { setKodeCust(e.target.value); setBaris([{ product_code: '', qty: '' }]) }}
            keterangan={customer ? `memegang ${angka(customer.saldo)} galon` : 'pilih dulu'}
          >
            <option value="">— pilih customer —</option>
            {daftarCustomer.filter((c) => c.saldo > 0).map((c) => (
              <option key={c.code} value={c.code}>
                {c.nama} ({angka(c.saldo)} galon)
              </option>
            ))}
          </Pilihan>

          <Pilihan
            label="Jenis pencatatan"
            value={jenis}
            onChange={(e) => setJenis(e.target.value)}
            keterangan={
              jenis === 'gallon_return'
                ? 'Galon kembali utuh, deposit tidak terpotong'
                : 'Deposit customer akan terpotong sesuai nilai galon'
            }
          >
            <option value="gallon_return">Kembali</option>
            <option value="lost">Hilang</option>
            <option value="damaged">Rusak</option>
          </Pilihan>
        </div>

        <Isian
          label="Tanggal"
          type="date"
          value={tanggal}
          max={hariIniIso()}
          onChange={(e) => setTanggal(e.target.value)}
        />

        {kodeCust && produkTersedia.length === 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Customer ini tidak tercatat memegang galon apa pun.
          </div>
        )}

        {produkTersedia.length > 0 && (
          <div className="space-y-3 rounded-lg border border-slate-200 p-4">
            {baris.map((b, i) => {
              const dipilih = produkTersedia.find((p) => p.product_code === b.product_code)
              return (
                <div key={i} className="grid gap-3 sm:grid-cols-[1fr_8rem_auto]">
                  <Pilihan
                    label={i === 0 ? 'Produk' : undefined}
                    value={b.product_code}
                    onChange={(e) => ubah(i, { product_code: e.target.value })}
                  >
                    <option value="">— pilih —</option>
                    {produkTersedia.map((p) => (
                      <option key={p.product_code} value={p.product_code}>
                        {p.product_code} — dipegang {angka(p.saldo)}
                      </option>
                    ))}
                  </Pilihan>
                  <Isian
                    label={i === 0 ? 'Jumlah' : undefined}
                    type="number"
                    min="1"
                    max={dipilih?.saldo}
                    value={b.qty}
                    onChange={(e) => ubah(i, { qty: e.target.value })}
                    galat={
                      dipilih && Number(b.qty) > dipilih.saldo
                        ? `maksimal ${dipilih.saldo}`
                        : undefined
                    }
                  />
                  <div className={i === 0 ? 'flex items-end' : 'flex items-start'}>
                    {baris.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setBaris((l) => l.filter((_, j) => j !== i))}
                        className="rounded p-2.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        aria-label="Hapus baris"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24"
                          stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              )
            })}

            {baris.length < produkTersedia.length && (
              <Tombol varian="polos" ukuran="kecil" type="button"
                onClick={() => setBaris((l) => [...l, { product_code: '', qty: '' }])}>
                + Tambah produk
              </Tombol>
            )}
          </div>
        )}

        <Isian
          label="Keterangan"
          placeholder="Misalnya: diambil sopir saat pengiriman"
          value={catatan}
          onChange={(e) => setCatatan(e.target.value)}
        />

        {galat && <Galat galat={galat} />}

        <div className="flex items-center justify-between gap-4 border-t border-slate-100 pt-4">
          <p className="text-sm text-slate-500">
            {total > 0 ? `${angka(total)} galon akan dicatat` : 'belum ada yang dicatat'}
          </p>
          <div className="flex gap-3">
            <Tombol varian="kedua" type="button" onClick={onTutup}>Batal</Tombol>
            <Tombol type="submit" sibuk={sibuk} nonaktif={!kodeCust || terisi.length === 0}>
              Simpan
            </Tombol>
          </div>
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
