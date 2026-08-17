import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMuat, useKirim } from '../lib/hooks'
import { rupiah, hariIniIso, tanggal as fTanggal } from '../lib/format'
import {
  JudulHalaman, Kartu, Tombol, Isian, Pilihan,
  SedangMemuat, Galat, Tabel, Sel,
} from '../components/ui'

/**
 * Form penjualan multi-produk.
 *
 * Harga yang tampil di layar hanyalah perkiraan. Angka yang benar-benar
 * tersimpan selalu dihitung ulang di Apps Script — dari customer_prices bila
 * ada, kalau tidak dari harga master. Halaman ini tidak pernah mengirim
 * harga, hanya kode produk dan jumlah.
 *
 * Perkiraan tetap ditampilkan karena staf perlu tahu total sebelum menekan
 * Simpan. Nilai resmi dari server ditampilkan lagi setelah invoice jadi.
 */
export default function SalesEntry() {
  const navigate = useNavigate()
  const { kirim, sibuk, galat: galatKirim } = useKirim()

  const produk = useMuat('master.products.list', {})
  const customer = useMuat('master.customers.list', {})

  const [kodeCust, setKodeCust] = useState('')
  const [tanggal, setTanggal] = useState(hariIniIso())
  const [catatan, setCatatan] = useState('')
  const [baris, setBaris] = useState([{ product_code: '', qty: '' }])
  const [hasil, setHasil] = useState(null)

  // Harga khusus hanya diambil setelah customer dipilih. Sebelum itu tidak
  // ada yang perlu diminta dari server.
  const hargaKhusus = useMuat(
    'master.customerPrices.list',
    kodeCust ? { customer_code: kodeCust } : {},
    [kodeCust],
  )

  const petaProduk = useMemo(() => {
    const p = {}
    ;(produk.data?.daftar || []).forEach((x) => { p[x.code] = x })
    return p
  }, [produk.data])

  const petaKhusus = useMemo(() => {
    const p = {}
    if (kodeCust) {
      ;(hargaKhusus.data?.daftar || []).forEach((x) => { p[x.product_code] = x.special_price })
    }
    return p
  }, [hargaKhusus.data, kodeCust])

  const custTerpilih = (customer.data?.daftar || []).find((c) => c.code === kodeCust)

  function hargaUntuk(kode) {
    if (!kode) return 0
    if (petaKhusus[kode] !== undefined) return petaKhusus[kode]
    return petaProduk[kode]?.price || 0
  }

  const barisTerisi = baris.filter((b) => b.product_code && Number(b.qty) > 0)
  const perkiraan = barisTerisi.reduce(
    (s, b) => s + hargaUntuk(b.product_code) * Number(b.qty), 0)

  const bisaSimpan = kodeCust && tanggal && barisTerisi.length > 0 && !sibuk

  function ubahBaris(i, patch) {
    setBaris((lama) => lama.map((b, j) => (j === i ? { ...b, ...patch } : b)))
  }

  function tambahBaris() {
    setBaris((lama) => [...lama, { product_code: '', qty: '' }])
  }

  function hapusBaris(i) {
    setBaris((lama) => (lama.length === 1 ? lama : lama.filter((_, j) => j !== i)))
  }

  async function simpan(ev) {
    ev.preventDefault()
    try {
      const data = await kirim('sales.create', {
        customer_code: kodeCust,
        order_date: tanggal,
        notes: catatan,
        items: barisTerisi.map((b) => ({
          product_code: b.product_code,
          qty: Number(b.qty),
        })),
      })
      setHasil(data)
    } catch {
      // Pesan galat sudah ditampilkan lewat galatKirim.
    }
  }

  if (produk.memuat || customer.memuat) return <SedangMemuat />
  if (produk.galat) return <Galat galat={produk.galat} coba={produk.muatUlang} />
  if (customer.galat) return <Galat galat={customer.galat} coba={customer.muatUlang} />

  if (hasil) return <Berhasil hasil={hasil} onBaruLagi={() => window.location.reload()} />

  return (
    <>
      <JudulHalaman
        judul="Penjualan baru"
        keterangan="Harga diambil otomatis dari kesepakatan customer"
        aksi={<Tombol varian="kedua" onClick={() => navigate('/penjualan')}>Batal</Tombol>}
      />

      <form onSubmit={simpan} className="space-y-5">
        <Kartu judul="Customer & tanggal">
          <div className="grid gap-4 sm:grid-cols-2">
            <Pilihan
              label="Customer"
              value={kodeCust}
              onChange={(e) => setKodeCust(e.target.value)}
              keterangan={
                custTerpilih
                  ? `${custTerpilih.area || 'tanpa area'} · tempo ${custTerpilih.payment_term_days} hari`
                  : 'Pilih dulu supaya harga khusus ikut terpakai'
              }
            >
              <option value="">— pilih customer —</option>
              {(customer.data?.daftar || [])
                .filter((c) => c.is_active)
                .map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name} ({c.code})
                  </option>
                ))}
            </Pilihan>

            <Isian
              label="Tanggal penjualan"
              type="date"
              value={tanggal}
              max={hariIniIso()}
              onChange={(e) => setTanggal(e.target.value)}
              keterangan={
                custTerpilih
                  ? `Jatuh tempo ${custTerpilih.payment_term_days} hari setelah tanggal ini`
                  : 'Tidak boleh tanggal yang belum terjadi'
              }
            />
          </div>
        </Kartu>

        <Kartu
          judul="Produk"
          padat
          aksi={
            <Tombol varian="kedua" ukuran="kecil" type="button" onClick={tambahBaris}>
              + Tambah baris
            </Tombol>
          }
        >
          <Tabel
            kepala={[
              { label: 'Produk' },
              { label: 'Jumlah', kanan: true, lebar: 'w-32' },
              { label: 'Harga satuan', kanan: true, lebar: 'w-44' },
              { label: 'Total', kanan: true, lebar: 'w-40' },
              { label: '', lebar: 'w-12' },
            ]}
          >
            {baris.map((b, i) => {
              const harga = hargaUntuk(b.product_code)
              const khusus = b.product_code && petaKhusus[b.product_code] !== undefined
              const p = petaProduk[b.product_code]
              return (
                <tr key={i}>
                  <Sel>
                    <select
                      value={b.product_code}
                      onChange={(e) => ubahBaris(i, { product_code: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm
                        focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
                    >
                      <option value="">— pilih produk —</option>
                      {(produk.data?.daftar || []).map((x) => (
                        <option key={x.code} value={x.code}>
                          {x.code} — {x.packaging_type || x.name}
                        </option>
                      ))}
                    </select>
                    {p && (
                      <span className="mt-1 block text-xs text-slate-400">
                        {p.packaging_type}
                        {p.volume_ml ? ` · ${(p.volume_ml / 1000).toLocaleString('id-ID')} liter` : ''}
                      </span>
                    )}
                  </Sel>

                  <Sel kanan>
                    <input
                      type="number"
                      min="1"
                      inputMode="numeric"
                      value={b.qty}
                      onChange={(e) => ubahBaris(i, { qty: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm
                        tabular-nums focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
                    />
                  </Sel>

                  <Sel kanan samar={!b.product_code}>
                    {b.product_code ? rupiah(harga) : '—'}
                    {khusus && (
                      <span className="mt-0.5 block text-xs font-medium text-sky-600">
                        harga khusus
                      </span>
                    )}
                  </Sel>

                  <Sel kanan tebal>
                    {b.product_code && Number(b.qty) > 0
                      ? rupiah(harga * Number(b.qty))
                      : <span className="font-normal text-slate-300">—</span>}
                  </Sel>

                  <Sel>
                    {baris.length > 1 && (
                      <button
                        type="button"
                        onClick={() => hapusBaris(i)}
                        className="rounded p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                        aria-label={`Hapus baris ${i + 1}`}
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24"
                          stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                        </svg>
                      </button>
                    )}
                  </Sel>
                </tr>
              )
            })}
          </Tabel>

          <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-5 py-4">
            <div>
              <p className="text-sm font-medium text-slate-600">Perkiraan total</p>
              <p className="text-xs text-slate-400">
                Nilai final dihitung ulang di server saat disimpan
              </p>
            </div>
            <p className="text-2xl font-bold tabular-nums text-slate-900">
              {rupiah(perkiraan)}
            </p>
          </div>
        </Kartu>

        <Kartu judul="Catatan">
          <Isian
            placeholder="Opsional — misalnya nomor PO customer atau keterangan pengiriman"
            value={catatan}
            onChange={(e) => setCatatan(e.target.value)}
          />
        </Kartu>

        {galatKirim && <Galat galat={galatKirim} />}

        <div className="flex items-center justify-end gap-3 pb-4">
          <Tombol varian="kedua" type="button" onClick={() => navigate('/penjualan')}>
            Batal
          </Tombol>
          <Tombol type="submit" sibuk={sibuk} nonaktif={!bisaSimpan}>
            Simpan penjualan
          </Tombol>
        </div>
      </form>
    </>
  )
}

/** Layar setelah invoice berhasil dibuat. */
function Berhasil({ hasil, onBaruLagi }) {
  const navigate = useNavigate()
  return (
    <>
      <JudulHalaman judul="Penjualan tersimpan" />
      <Kartu>
        <div className="mb-6 flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-100">
            <svg className="h-6 w-6 text-emerald-700" fill="none" viewBox="0 0 24 24"
              stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <p className="text-xl font-bold text-slate-900">{hasil.invoice_no}</p>
            <p className="text-slate-600">{hasil.customer_name}</p>
          </div>
        </div>

        <dl className="grid gap-4 border-t border-slate-100 pt-5 sm:grid-cols-3">
          <Baris label="Nilai" nilai={rupiah(hasil.subtotal)} besar />
          <Baris label="Jatuh tempo" nilai={fTanggal(hasil.due_date)}
            catatan={`${hasil.tempo_hari} hari`} />
          <Baris label="Galon keluar" nilai={`${hasil.galon_keluar} galon`}
            catatan="tercatat di saldo customer" />
        </dl>

        <div className="mt-6 flex flex-wrap gap-3 border-t border-slate-100 pt-5">
          <Tombol onClick={onBaruLagi}>Buat penjualan lagi</Tombol>
          <Tombol varian="kedua" onClick={() => navigate(`/penjualan/${hasil.order_id}`)}>
            Lihat detail
          </Tombol>
          <Tombol varian="kedua" onClick={() => navigate('/penjualan')}>
            Kembali ke daftar
          </Tombol>
        </div>
      </Kartu>
    </>
  )
}

function Baris({ label, nilai, catatan, besar }) {
  return (
    <div>
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className={`mt-0.5 font-semibold tabular-nums text-slate-900 ${besar ? 'text-lg' : ''}`}>
        {nilai}
      </dd>
      {catatan && <dd className="text-xs text-slate-400">{catatan}</dd>}
    </div>
  )
}
