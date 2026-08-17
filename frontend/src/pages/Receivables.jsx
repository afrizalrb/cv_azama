import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMuat, useKirim } from '../lib/hooks'
import { rupiah, angka, tanggalPendek, hariIniIso } from '../lib/format'
import {
  JudulHalaman, Kartu, Statistik, Status, Tombol, Isian, Pilihan,
  SedangMemuat, Galat, Kosong, Tabel, Sel,
} from '../components/ui'

/**
 * Aging piutang.
 *
 * Inilah modul yang menjadi alasan utama sistem ini dibangun. Seluruh
 * customer bertempo 14 atau 30 hari, tapi sebelumnya tidak ada satu pun
 * pencatatan pembayaran — tidak ada yang tahu berapa uang yang belum kembali
 * dan sejak kapan.
 *
 * Urutannya sengaja menempatkan yang paling lama menunggak di atas. Itu
 * pertanyaan pertama yang muncul saat halaman ini dibuka: siapa yang harus
 * ditelepon hari ini.
 */

const WARNA_EMBER = {
  belum_jatuh_tempo: 'bg-slate-400',
  h1_30: 'bg-amber-400',
  h31_60: 'bg-orange-500',
  h61_90: 'bg-red-500',
  h90plus: 'bg-red-700',
}

export default function Receivables() {
  const [per, setPer] = useState(hariIniIso())
  const { data, galat, memuat, muatUlang } = useMuat('receivable.aging', { per_tanggal: per })
  const [bayar, setBayar] = useState(null)

  if (memuat) return <SedangMemuat pesan="Menghitung umur piutang..." />
  if (galat) {
    return (
      <>
        <JudulHalaman judul="Piutang" />
        <Galat galat={galat} coba={muatUlang} />
      </>
    )
  }

  const r = data.ringkasan
  const ada = data.customer.length > 0

  return (
    <>
      <JudulHalaman
        judul="Piutang"
        keterangan={`${angka(r.jumlah_invoice)} invoice belum lunas dari ${angka(r.jumlah_customer)} customer`}
        aksi={
          <Isian
            type="date"
            value={per}
            max={hariIniIso()}
            onChange={(e) => setPer(e.target.value)}
            className="w-44"
          />
        }
      />

      {bayar && (
        <FormPembayaran
          invoice={bayar}
          onTutup={() => setBayar(null)}
          onSelesai={() => { setBayar(null); muatUlang() }}
        />
      )}

      <div className="mb-5 grid gap-4 sm:grid-cols-2">
        <Statistik
          label="Total belum tertagih"
          nilai={rupiah(r.total_piutang)}
          nada={r.total_piutang > 0 ? 'perhatian' : 'baik'}
          catatan={`per ${tanggalPendek(data.per_tanggal)}`}
        />
        <Statistik
          label="Sudah lewat jatuh tempo"
          nilai={rupiah(r.total_terlambat)}
          nada={r.total_terlambat > 0 ? 'buruk' : 'baik'}
          catatan={
            r.total_piutang > 0
              ? `${Math.round(r.total_terlambat / r.total_piutang * 100)}% dari total piutang`
              : 'tidak ada tunggakan'
          }
        />
      </div>

      {ada && (
        <div className="mb-5">
          <Kartu judul="Sebaran umur piutang">
            <div className="space-y-3">
              {data.ember.map((e) => (
                <div key={e.kunci}>
                  <div className="mb-1 flex items-baseline justify-between gap-4 text-sm">
                    <span className="text-slate-600">{e.label}</span>
                    <span className="tabular-nums">
                      <span className="font-semibold text-slate-900">{rupiah(e.nilai)}</span>
                      <span className="ml-2 text-slate-400">{e.persen}%</span>
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full ${WARNA_EMBER[e.kunci]}`}
                      style={{ width: `${e.persen}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Kartu>
        </div>
      )}

      {!ada && (
        <Kartu>
          <Kosong
            judul="Tidak ada piutang tercatat"
            keterangan="Seluruh invoice sudah berstatus lunas. Piutang akan muncul di sini begitu ada penjualan yang belum dibayar."
          />
        </Kartu>
      )}

      {ada && (
        <div className="space-y-4">
          {data.customer.map((c) => (
            <KartuCustomer key={c.code} customer={c} onBayar={setBayar} />
          ))}
        </div>
      )}

      {data.invoice_dikecualikan > 0 && (
        <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm text-slate-600">{data.catatan_pengecualian}</p>
          <p className="mt-1 text-sm text-slate-500">
            Bila ternyata ada di antaranya yang belum dibayar, ubah statusnya
            menjadi <code>unpaid</code> di tab <code>sales_orders</code>, lalu
            invoice itu akan muncul di halaman ini.
          </p>
        </div>
      )}
    </>
  )
}

function KartuCustomer({ customer: c, onBayar }) {
  const [buka, setBuka] = useState(false)

  return (
    <Kartu padat>
      <button
        onClick={() => setBuka(!buka)}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-slate-50"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-900">{c.nama}</span>
            <span className="text-xs text-slate-400">{c.code}</span>
            {c.umur_tertua > 0 && (
              <Status
                nilai={c.umur_tertua > 60 ? 'terlambat' : 'unpaid'}
                teks={`terlambat ${c.umur_tertua} hari`}
              />
            )}
          </div>
          <p className="mt-0.5 truncate text-sm text-slate-500">
            {[c.area, c.sales_person && `sales ${c.sales_person}`, c.telepon]
              .filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-lg font-bold tabular-nums text-slate-900">{rupiah(c.total)}</p>
          <p className="text-xs text-slate-400">
            {c.invoice.length} invoice · {buka ? 'tutup' : 'lihat rincian'}
          </p>
        </div>
      </button>

      {buka && (
        <Tabel
          kepala={[
            { label: 'Invoice' },
            { label: 'Jatuh tempo' },
            { label: 'Umur' },
            { label: 'Tagihan', kanan: true },
            { label: 'Dibayar', kanan: true },
            { label: 'Sisa', kanan: true },
            { label: '' },
          ]}
        >
          {c.invoice.map((inv) => (
            <tr key={inv.order_id}>
              <Sel>
                <Link
                  to={`/penjualan/${inv.order_id}`}
                  className="font-medium text-sky-700 hover:underline"
                >
                  {inv.invoice_no}
                </Link>
              </Sel>
              <Sel samar>{tanggalPendek(inv.due_date)}</Sel>
              <Sel>
                {inv.umur_hari > 0 ? (
                  <span className="font-medium text-red-600">
                    +{inv.umur_hari} hari
                  </span>
                ) : (
                  <span className="text-slate-400">
                    {inv.umur_hari === 0 ? 'jatuh tempo hari ini' : `${-inv.umur_hari} hari lagi`}
                  </span>
                )}
              </Sel>
              <Sel kanan samar>{rupiah(inv.subtotal)}</Sel>
              <Sel kanan samar>{inv.dibayar > 0 ? rupiah(inv.dibayar) : '—'}</Sel>
              <Sel kanan tebal>{rupiah(inv.sisa)}</Sel>
              <Sel>
                <div className="flex justify-end">
                  <Tombol
                    ukuran="kecil"
                    onClick={() => onBayar({ ...inv, customer_nama: c.nama })}
                  >
                    Catat bayar
                  </Tombol>
                </div>
              </Sel>
            </tr>
          ))}
        </Tabel>
      )}
    </Kartu>
  )
}

function FormPembayaran({ invoice, onTutup, onSelesai }) {
  const { kirim, sibuk, galat } = useKirim()
  const [f, setF] = useState({
    amount: String(invoice.sisa),
    payment_date: hariIniIso(),
    method: 'transfer',
    reference: '',
  })

  const jumlah = Number(f.amount) || 0
  const lunas = jumlah >= invoice.sisa

  async function simpan(ev) {
    ev.preventDefault()
    try {
      await kirim('payment.create', {
        order_id: invoice.order_id,
        payment_date: f.payment_date,
        amount: jumlah,
        method: f.method,
        reference: f.reference,
      })
      onSelesai()
    } catch {
      // pesan galat sudah ditampilkan
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl">
        <header className="border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold text-slate-900">Catat pembayaran</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            {invoice.invoice_no} · {invoice.customer_nama}
          </p>
        </header>

        <form onSubmit={simpan} className="space-y-4 p-5">
          <div className="rounded-lg bg-slate-50 px-4 py-3">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Tagihan</span>
              <span className="tabular-nums text-slate-700">{rupiah(invoice.subtotal)}</span>
            </div>
            {invoice.dibayar > 0 && (
              <div className="mt-1 flex justify-between text-sm">
                <span className="text-slate-500">Sudah dibayar</span>
                <span className="tabular-nums text-slate-700">− {rupiah(invoice.dibayar)}</span>
              </div>
            )}
            <div className="mt-2 flex justify-between border-t border-slate-200 pt-2">
              <span className="font-medium text-slate-700">Sisa</span>
              <span className="font-bold tabular-nums text-slate-900">{rupiah(invoice.sisa)}</span>
            </div>
          </div>

          <Isian
            label="Jumlah dibayar"
            type="number"
            min="1"
            max={invoice.sisa}
            value={f.amount}
            onChange={(e) => setF({ ...f, amount: e.target.value })}
            autoFocus
            keterangan={
              jumlah > invoice.sisa
                ? 'Melebihi sisa tagihan — akan ditolak server'
                : lunas
                  ? 'Invoice akan berstatus lunas'
                  : `Sisa setelah ini: ${rupiah(invoice.sisa - jumlah)}`
            }
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Isian
              label="Tanggal terima"
              type="date"
              value={f.payment_date}
              max={hariIniIso()}
              min={invoice.order_date}
              onChange={(e) => setF({ ...f, payment_date: e.target.value })}
            />
            <Pilihan
              label="Metode"
              value={f.method}
              onChange={(e) => setF({ ...f, method: e.target.value })}
            >
              <option value="transfer">Transfer</option>
              <option value="tunai">Tunai</option>
              <option value="giro">Giro</option>
              <option value="lainnya">Lainnya</option>
            </Pilihan>
          </div>

          <Isian
            label="Keterangan"
            placeholder="Misalnya: BCA 17/08 a.n. Budi"
            value={f.reference}
            onChange={(e) => setF({ ...f, reference: e.target.value })}
            keterangan="Membantu mencocokkan dengan rekening koran"
          />

          {galat && <Galat galat={galat} />}

          <div className="flex justify-end gap-3 pt-1">
            <Tombol varian="kedua" type="button" onClick={onTutup}>Batal</Tombol>
            <Tombol type="submit" sibuk={sibuk} nonaktif={jumlah <= 0 || jumlah > invoice.sisa}>
              Simpan pembayaran
            </Tombol>
          </div>
        </form>
      </div>
    </div>
  )
}
