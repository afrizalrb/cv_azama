import { useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useMuat, useKirim } from '../lib/hooks'
import { rupiah, tanggalLengkap, tanggalPendek } from '../lib/format'
import {
  JudulHalaman, Kartu, Status, Tombol, Isian,
  SedangMemuat, Galat, Tabel, Sel,
} from '../components/ui'

/** Detail satu invoice, beserta pembatalan. */
export default function SalesDetail() {
  const { orderId } = useParams()
  const navigate = useNavigate()
  const { data, galat, memuat, muatUlang } = useMuat('sales.get', { order_id: orderId })
  const [formBatal, setFormBatal] = useState(false)

  if (memuat) return <SedangMemuat />
  if (galat) {
    return (
      <>
        <JudulHalaman judul="Detail penjualan" />
        <Galat galat={galat} coba={muatUlang} />
        <div className="mt-4">
          <Tombol varian="kedua" onClick={() => navigate('/penjualan')}>
            Kembali ke daftar
          </Tombol>
        </div>
      </>
    )
  }

  const batal = data.status === 'cancelled'

  return (
    <>
      <div className="mb-2">
        <Link to="/penjualan" className="text-sm text-slate-500 hover:text-slate-800">
          ← Kembali ke daftar penjualan
        </Link>
      </div>

      <JudulHalaman
        judul={data.invoice_no}
        keterangan={`${data.customer_name}${data.customer_area ? ' · ' + data.customer_area : ''}`}
        aksi={
          !batal && (
            <Tombol varian="bahaya" onClick={() => setFormBatal(true)}>
              Batalkan invoice
            </Tombol>
          )
        }
      />

      {batal && (
        <div className="mb-5 rounded-lg border border-slate-300 bg-slate-100 px-4 py-3">
          <p className="text-sm font-medium text-slate-700">Invoice ini sudah dibatalkan.</p>
          <p className="mt-0.5 text-sm text-slate-500">
            Barisnya tetap tersimpan, dan stok serta galonnya sudah dikembalikan lewat
            baris penyeimbang. Riwayat tidak pernah dihapus.
          </p>
        </div>
      )}

      {formBatal && (
        <FormPembatalan
          invoice={data.invoice_no}
          orderId={data.order_id}
          onBatal={() => setFormBatal(false)}
          onSelesai={() => { setFormBatal(false); muatUlang() }}
        />
      )}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Info label="Status" nilai={<Status nilai={batal ? 'cancelled' : data.status} />} />
        <Info label="Tanggal" nilai={tanggalPendek(data.order_date)}
          catatan={tanggalLengkap(data.order_date)} />
        <Info label="Jatuh tempo" nilai={tanggalPendek(data.due_date)} />
        <Info label="Nilai" nilai={rupiah(data.subtotal)} besar />
      </div>

      <Kartu judul="Rincian produk" padat>
        <Tabel
          kepala={[
            { label: 'Produk' },
            { label: 'Jumlah', kanan: true },
            { label: 'Harga satuan', kanan: true },
            { label: 'Total', kanan: true },
          ]}
        >
          {data.items.map((it) => (
            <tr key={it.item_id}>
              <Sel>
                <span className="font-medium">{it.product_code}</span>
                <span className="ml-2 text-slate-500">{it.nama_produk}</span>
              </Sel>
              <Sel kanan>{it.qty.toLocaleString('id-ID')}</Sel>
              <Sel kanan samar>{rupiah(it.unit_price)}</Sel>
              <Sel kanan tebal>{rupiah(it.line_total)}</Sel>
            </tr>
          ))}
          <tr className="bg-slate-50">
            <Sel tebal>Total</Sel>
            <Sel />
            <Sel />
            <Sel kanan tebal>{rupiah(data.subtotal)}</Sel>
          </tr>
        </Tabel>
      </Kartu>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Kartu judul="Margin">
          {data.hpp_lengkap ? (
            <dl className="space-y-2.5 text-sm">
              <BarisDl label="Nilai penjualan" nilai={rupiah(data.subtotal)} />
              <BarisDl label="Harga pokok" nilai={'− ' + rupiah(data.total_hpp)} />
              <div className="border-t border-slate-100 pt-2.5">
                <BarisDl
                  label="Margin kotor"
                  nilai={rupiah(data.subtotal - data.total_hpp)}
                  tebal
                  catatan={
                    data.subtotal > 0
                      ? `${Math.round((data.subtotal - data.total_hpp) / data.subtotal * 100)}%`
                      : ''
                  }
                />
              </div>
            </dl>
          ) : (
            <p className="text-sm text-slate-500">
              Margin belum bisa dihitung karena ada produk yang HPP-nya masih nol.
              Isi HPP di menu Master supaya angkanya bermakna.
            </p>
          )}
        </Kartu>

        <Kartu judul="Pembayaran">
          {data.payments.length === 0 && data.status === 'paid' ? (
            // Kasus yang sangat umum di data lama: invoice ditandai lunas saat
            // migrasi, tapi rincian pembayarannya tidak pernah dicatat di Excel.
            // Menampilkan sisa penuh di sini akan terbaca sebagai tagihan yang
            // tertunggak, padahal bukan.
            <div>
              <p className="text-2xl font-bold text-emerald-700">Lunas</p>
              <p className="mt-1 text-sm text-slate-500">
                Ditandai lunas saat migrasi dari Excel. Rincian tanggal dan cara
                pembayarannya tidak tercatat di data lama.
              </p>
            </div>
          ) : data.payments.length === 0 ? (
            <div>
              <p className="text-sm text-slate-500">Belum ada pembayaran tercatat.</p>
              <p className="mt-2 text-2xl font-bold tabular-nums text-amber-700">
                {rupiah(data.sisa)}
              </p>
              <p className="text-sm text-slate-400">belum tertagih</p>
              {!batal && (
                <div className="mt-4">
                  <Tombol onClick={() => navigate('/piutang')}>
                    Catat pembayaran
                  </Tombol>
                </div>
              )}
            </div>
          ) : (
            <dl className="space-y-2 text-sm">
              {data.payments.map((b) => (
                <BarisDl
                  key={b.payment_id}
                  label={`${tanggalPendek(b.payment_date)} · ${b.method || 'tanpa metode'}`}
                  nilai={rupiah(b.amount)}
                />
              ))}
              <div className="border-t border-slate-100 pt-2">
                <BarisDl label="Sisa" nilai={rupiah(data.sisa)} tebal />
              </div>
            </dl>
          )}
        </Kartu>
      </div>

      <p className="mt-5 pb-4 text-xs text-slate-400">
        Dibuat oleh {data.created_by || 'tidak diketahui'}
        {data.created_at ? ` pada ${data.created_at}` : ''}
      </p>
    </>
  )
}

function FormPembatalan({ invoice, orderId, onBatal, onSelesai }) {
  const { kirim, sibuk, galat } = useKirim()
  const [alasan, setAlasan] = useState('')

  async function kirimBatal(ev) {
    ev.preventDefault()
    try {
      await kirim('sales.cancel', { order_id: orderId, alasan })
      onSelesai()
    } catch {
      // pesan galat sudah ditampilkan
    }
  }

  return (
    <form
      onSubmit={kirimBatal}
      className="mb-5 rounded-xl border border-red-200 bg-red-50 p-5"
    >
      <p className="font-semibold text-red-900">Batalkan {invoice}?</p>
      <p className="mt-1 text-sm text-red-800">
        Barisnya tidak dihapus. Stok dan galon dikembalikan lewat baris penyeimbang,
        sehingga jejak transaksinya tetap bisa ditelusuri.
      </p>

      <div className="mt-4">
        <Isian
          label="Alasan pembatalan"
          placeholder="Misalnya: salah input customer"
          value={alasan}
          onChange={(e) => setAlasan(e.target.value)}
          autoFocus
        />
      </div>

      {galat && <div className="mt-3"><Galat galat={galat} /></div>}

      <div className="mt-4 flex gap-3">
        <Tombol varian="bahaya" type="submit" sibuk={sibuk} nonaktif={!alasan.trim()}>
          Ya, batalkan
        </Tombol>
        <Tombol varian="kedua" type="button" onClick={onBatal}>
          Jangan jadi
        </Tombol>
      </div>
    </form>
  )
}

function Info({ label, nilai, catatan, besar }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <div className={`mt-1 font-semibold tabular-nums text-slate-900 ${besar ? 'text-lg' : ''}`}>
        {nilai}
      </div>
      {catatan && <p className="mt-0.5 text-xs text-slate-400">{catatan}</p>}
    </div>
  )
}

function BarisDl({ label, nilai, catatan, tebal }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={tebal ? 'font-medium text-slate-700' : 'text-slate-500'}>{label}</dt>
      <dd className={`tabular-nums ${tebal ? 'font-bold text-slate-900' : 'text-slate-700'}`}>
        {nilai}
        {catatan && <span className="ml-2 text-sm font-normal text-slate-400">{catatan}</span>}
      </dd>
    </div>
  )
}
