import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from 'recharts'
import { Link } from 'react-router-dom'
import { useMuat } from '../lib/hooks'
import { rupiah, rupiahSingkat, angka, tanggalLengkap } from '../lib/format'
import {
  JudulHalaman, Kartu, Statistik, SedangMemuat, Galat, Kosong, Tombol,
} from '../components/ui'

/**
 * Dashboard.
 *
 * Seluruh isinya datang dari satu panggilan `dashboard.summary`. Memecahnya
 * menjadi empat panggilan terpisah akan membuat halaman depan menunggu
 * delapan detik, karena tiap permintaan ke Apps Script memakan satu sampai
 * dua detik untuk melewati redirect.
 *
 * Tidak ada kartu stok. Model bisnisnya pre-order — produksi mengikuti
 * pesanan, tidak ada penyetokan barang jadi.
 */
export default function Dashboard() {
  const { data, galat, memuat, muatUlang } = useMuat('dashboard.summary', { bulan: 12 })

  if (memuat) return <SedangMemuat pesan="Menghitung ringkasan..." />
  if (galat) {
    return (
      <>
        <JudulHalaman judul="Dashboard" />
        <Galat galat={galat} coba={muatUlang} />
      </>
    )
  }

  const r = data.ringkasan
  const penuh = data.dashboard_penuh
  const adaData = r.invoice_total > 0

  return (
    <>
      <JudulHalaman
        judul="Dashboard"
        keterangan={
          penuh
            ? `Seluruh penjualan · per ${tanggalLengkap(data.per)}`
            : `Penjualan customer Anda · per ${tanggalLengkap(data.per)}`
        }
        aksi={<Tombol varian="kedua" onClick={muatUlang}>Muat ulang</Tombol>}
      />

      {!adaData && (
        <Kartu>
          <Kosong
            judul="Belum ada penjualan"
            keterangan="Angka akan muncul di sini setelah penjualan pertama dibuat."
          />
        </Kartu>
      )}

      {adaData && (
        <>
          <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Statistik
              label="Omzet bulan ini"
              nilai={rupiah(r.omzet_bulan_ini)}
              nada={r.pertumbuhan_persen > 0 ? 'baik' : 'netral'}
              catatan={
                r.pertumbuhan_persen === null
                  ? 'bulan lalu tidak ada transaksi'
                  : `${r.pertumbuhan_persen >= 0 ? '▲' : '▼'} ${Math.abs(r.pertumbuhan_persen)}% dibanding bulan lalu`
              }
            />
            <Statistik
              label="Invoice bulan ini"
              nilai={angka(r.invoice_bulan_ini)}
              catatan={`${angka(r.invoice_total)} invoice sepanjang waktu`}
            />
            <Statistik
              label="Belum tertagih"
              nilai={rupiah(r.piutang)}
              nada={r.piutang > 0 ? 'perhatian' : 'baik'}
              catatan={
                r.piutang > 0
                  ? `${angka(r.invoice_jatuh_tempo)} invoice lewat jatuh tempo`
                  : 'seluruh invoice tercatat lunas'
              }
            />
            {penuh ? (
              <Statistik
                label="Margin kotor"
                nilai={r.margin_persen !== null ? `${r.margin_persen}%` : '—'}
                nada={r.margin_bisa_dipercaya ? 'baik' : 'perhatian'}
                catatan={
                  r.margin_bisa_dipercaya
                    ? rupiah(r.margin_total)
                    : 'ada produk ber-HPP nol — angka ini terlalu tinggi'
                }
              />
            ) : (
              <Statistik
                label="Omzet total"
                nilai={rupiahSingkat(r.omzet_total)}
                catatan="seluruh periode"
              />
            )}
          </div>

          {r.piutang_jatuh_tempo > 0 && (
            <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="font-medium text-amber-900">
                {rupiah(r.piutang_jatuh_tempo)} sudah lewat jatuh tempo
              </p>
              <p className="mt-0.5 text-sm text-amber-800">
                Tersebar di {angka(r.invoice_jatuh_tempo)} invoice. Halaman
                aging piutang lengkap menyusul di Fase 3 — sementara ini bisa
                dilihat lewat filter status di daftar penjualan.
              </p>
              <div className="mt-3">
                <Link
                  to="/penjualan"
                  className="text-sm font-medium text-amber-900 underline"
                >
                  Buka daftar penjualan
                </Link>
              </div>
            </div>
          )}

          <div className="mb-5">
            <Kartu judul="Penjualan 12 bulan terakhir">
              <GrafikBulanan data={data.bulanan} />
            </Kartu>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Kartu judul="Produk terlaris" padat>
              <Peringkat
                baris={data.produk_teratas.map((p) => ({
                  kunci: p.code,
                  utama: p.code,
                  sekunder: p.kemasan || p.nama,
                  nilai: `${angka(p.qty)} unit`,
                  bawah: rupiah(p.nilai),
                  bobot: p.qty,
                }))}
                maks={data.produk_teratas[0]?.qty || 1}
              />
            </Kartu>

            <Kartu judul="Customer terbesar" padat>
              <Peringkat
                baris={data.customer_teratas.map((c) => ({
                  kunci: c.code,
                  utama: c.nama,
                  sekunder: `${c.area || 'tanpa area'} · ${angka(c.invoice)} invoice`,
                  nilai: rupiah(c.nilai),
                  bobot: c.nilai,
                }))}
                maks={data.customer_teratas[0]?.nilai || 1}
              />
            </Kartu>
          </div>

          <div className="mt-5">
            <Kartu
              judul="Galon beredar di customer"
              padat
              aksi={
                <span className="text-sm text-slate-500">
                  total {angka(data.galon.total_beredar)} galon
                </span>
              }
            >
              {data.galon.customer.length === 0 ? (
                <Kosong
                  judul="Belum ada galon tercatat keluar"
                  keterangan="Saldo galon mulai terisi dari penjualan yang dibuat lewat sistem. Transaksi sebelum sistem dipakai sengaja tidak dihitung."
                />
              ) : (
                <>
                  <Peringkat
                    baris={data.galon.customer.map((c) => ({
                      kunci: c.code,
                      utama: c.nama,
                      sekunder: c.code,
                      nilai: `${angka(c.saldo)} galon`,
                      bobot: c.saldo,
                    }))}
                    maks={data.galon.customer[0]?.saldo || 1}
                    warna="amber"
                  />
                  <p className="border-t border-slate-100 px-5 py-3 text-sm text-slate-500">
                    Galon fisik milik perusahaan yang sedang berada di tangan
                    customer. Semakin besar angkanya, semakin besar aset yang
                    berisiko tidak kembali.
                  </p>
                </>
              )}
            </Kartu>
          </div>

          {penuh && !r.margin_bisa_dipercaya && (
            <p className="mt-5 pb-4 text-sm text-slate-500">
              Catatan: margin dihitung dari HPP yang tersimpan di tiap baris
              transaksi. Sebagian produk masih ber-HPP nol, sehingga margin
              yang tampil lebih tinggi daripada kenyataan. Isi HPP di menu
              Master untuk memperbaikinya.
            </p>
          )}
        </>
      )}
    </>
  )
}

/* --- grafik --------------------------------------------------------------- */

function GrafikBulanan({ data }) {
  const adaIsi = data.some((d) => d.omzet > 0)
  if (!adaIsi) {
    return <Kosong judul="Belum ada transaksi pada rentang ini" />
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 12, fill: '#64748b' }}
            axisLine={{ stroke: '#e2e8f0' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 12, fill: '#64748b' }}
            axisLine={false}
            tickLine={false}
            width={64}
            tickFormatter={(v) => (v >= 1e6 ? `${v / 1e6} jt` : v / 1e3 + ' rb')}
          />
          <Tooltip
            cursor={{ fill: '#f1f5f9' }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const d = payload[0].payload
              return (
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg">
                  <p className="text-sm font-medium text-slate-800">{label}</p>
                  <p className="text-sm tabular-nums text-slate-900">{rupiah(d.omzet)}</p>
                  <p className="text-xs text-slate-500">{d.invoice} invoice</p>
                </div>
              )
            }}
          />
          <Bar dataKey="omzet" radius={[4, 4, 0, 0]}>
            {data.map((d, i) => (
              // Bulan berjalan dibedakan warnanya, karena angkanya belum utuh
              // dan tidak sebanding dengan bulan-bulan sebelumnya.
              <Cell key={i} fill={i === data.length - 1 ? '#7dd3fc' : '#0284c7'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="mt-2 text-center text-xs text-slate-400">
        Batang paling kanan adalah bulan berjalan, belum genap sebulan
      </p>
    </div>
  )
}

/* --- daftar peringkat ----------------------------------------------------- */

function Peringkat({ baris, maks, warna = 'sky' }) {
  if (!baris.length) return <Kosong judul="Belum ada data" />

  const bar = warna === 'amber' ? 'bg-amber-400' : 'bg-sky-500'

  return (
    <ul className="divide-y divide-slate-100">
      {baris.map((b) => (
        <li key={b.kunci} className="px-5 py-3">
          <div className="flex items-baseline justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate font-medium text-slate-800">{b.utama}</p>
              <p className="truncate text-xs text-slate-400">{b.sekunder}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-semibold tabular-nums text-slate-900">{b.nilai}</p>
              {b.bawah && <p className="text-xs tabular-nums text-slate-400">{b.bawah}</p>}
            </div>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full ${bar}`}
              style={{ width: `${Math.max(2, (b.bobot / maks) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}
