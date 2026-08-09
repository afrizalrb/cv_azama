import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMuat } from '../lib/hooks'
import { rupiah, tanggalPendek } from '../lib/format'
import {
  JudulHalaman, Kartu, Statistik, Status, Tombol, Pilihan, Isian,
  SedangMemuat, Galat, Kosong, Tabel, Sel,
} from '../components/ui'

/**
 * Daftar penjualan.
 *
 * Penyaringan dikirim ke server, bukan dilakukan di peramban. Untuk seratusan
 * invoice per tahun keduanya sama cepat, tapi menyaring di server berarti
 * data yang tidak berhak dilihat memang tidak pernah terkirim.
 */
export default function SalesList() {
  const [filter, setFilter] = useState({ status: '', dari: '', sampai: '' })
  const { data, galat, memuat, muatUlang } = useMuat('sales.list', filter)
  const navigate = useNavigate()

  const ada = data?.daftar?.length > 0
  const adaFilter = filter.status || filter.dari || filter.sampai

  return (
    <>
      <JudulHalaman
        judul="Penjualan"
        keterangan={
          data
            ? `${data.jumlah_total.toLocaleString('id-ID')} invoice`
            : 'Memuat...'
        }
        aksi={
          <Tombol onClick={() => navigate('/penjualan/baru')}>
            + Penjualan baru
          </Tombol>
        }
      />

      {data && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          <Statistik
            label="Nilai penjualan"
            nilai={rupiah(data.ringkasan.nilai)}
            catatan={adaFilter ? 'sesuai filter aktif' : 'seluruh periode'}
          />
          <Statistik
            label="Belum tertagih"
            nilai={rupiah(data.ringkasan.belum_lunas)}
            nada={data.ringkasan.belum_lunas > 0 ? 'perhatian' : 'baik'}
            catatan={
              data.ringkasan.belum_lunas > 0
                ? 'modul pembayaran menyusul di Fase 3'
                : 'seluruh invoice lunas'
            }
          />
        </div>
      )}

      <Kartu padat>
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
          <Pilihan
            label="Status"
            value={filter.status}
            onChange={(e) => setFilter({ ...filter, status: e.target.value })}
            className="w-40"
          >
            <option value="">Semua</option>
            <option value="unpaid">Belum bayar</option>
            <option value="partial">Sebagian</option>
            <option value="paid">Lunas</option>
            <option value="cancelled">Dibatalkan</option>
          </Pilihan>
          <Isian
            label="Dari tanggal"
            type="date"
            value={filter.dari}
            onChange={(e) => setFilter({ ...filter, dari: e.target.value })}
            className="w-44"
          />
          <Isian
            label="Sampai"
            type="date"
            value={filter.sampai}
            onChange={(e) => setFilter({ ...filter, sampai: e.target.value })}
            className="w-44"
          />
          {adaFilter && (
            <Tombol
              varian="polos"
              ukuran="kecil"
              onClick={() => setFilter({ status: '', dari: '', sampai: '' })}
            >
              Hapus filter
            </Tombol>
          )}
        </div>

        {memuat && <SedangMemuat />}
        {galat && <div className="p-5"><Galat galat={galat} coba={muatUlang} /></div>}

        {!memuat && !galat && !ada && (
          <Kosong
            judul={adaFilter ? 'Tidak ada invoice yang cocok' : 'Belum ada penjualan'}
            keterangan={
              adaFilter
                ? 'Coba longgarkan filter tanggal atau statusnya.'
                : 'Penjualan pertama akan muncul di sini setelah dibuat.'
            }
          />
        )}

        {!memuat && !galat && ada && (
          <>
            <Tabel
              kepala={[
                { label: 'Invoice' },
                { label: 'Customer' },
                { label: 'Tanggal' },
                { label: 'Jatuh tempo' },
                { label: 'Status' },
                { label: 'Nilai', kanan: true },
              ]}
            >
              {data.daftar.map((o) => (
                <tr key={o.order_id} className="transition hover:bg-slate-50">
                  <Sel>
                    <Link
                      to={`/penjualan/${o.order_id}`}
                      className="font-medium text-sky-700 hover:underline"
                    >
                      {o.invoice_no}
                    </Link>
                  </Sel>
                  <Sel>
                    <span className="block">{o.customer_name}</span>
                    {o.sales_person && (
                      <span className="text-xs text-slate-400">{o.sales_person}</span>
                    )}
                  </Sel>
                  <Sel samar>{tanggalPendek(o.order_date)}</Sel>
                  <Sel samar>
                    {tanggalPendek(o.due_date)}
                    {o.terlambat_hari > 0 && (
                      <span className="ml-1.5 text-xs font-medium text-red-600">
                        +{o.terlambat_hari} hari
                      </span>
                    )}
                  </Sel>
                  <Sel>
                    <Status
                      nilai={o.terlambat_hari > 0 ? 'terlambat' : o.status}
                    />
                  </Sel>
                  <Sel kanan tebal>
                    <span className={o.status === 'cancelled' ? 'text-slate-400 line-through' : ''}>
                      {rupiah(o.subtotal)}
                    </span>
                  </Sel>
                </tr>
              ))}
            </Tabel>

            {data.dipotong && (
              <p className="border-t border-slate-100 px-5 py-3 text-sm text-slate-500">
                Menampilkan {data.daftar.length} dari {data.jumlah_total} invoice.
                Persempit rentang tanggal untuk melihat sisanya.
              </p>
            )}
          </>
        )}
      </Kartu>
    </>
  )
}
