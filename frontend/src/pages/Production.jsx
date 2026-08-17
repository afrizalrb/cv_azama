import { useState } from 'react'
import { useMuat, useKirim } from '../lib/hooks'
import { angka, tanggalPendek, hariIniIso } from '../lib/format'
import {
  JudulHalaman, Kartu, Statistik, Status, Tombol, Isian, Pilihan,
  SedangMemuat, Galat, Kosong, Tabel, Sel,
} from '../components/ui'

/**
 * Catatan batch produksi.
 *
 * Bukan alat kelola persediaan — model bisnisnya pre-order. Gunanya dua:
 * rekam jejak mutu (pH dan TDS adalah janji produk kepada customer), dan
 * pasangan hitung buku besar, supaya barang keluar sejak Fase 1 akhirnya
 * punya lawan hitung.
 */
export default function Production() {
  const [filter, setFilter] = useState({ dari: '', sampai: '', product_code: '' })
  const { data, galat, memuat, muatUlang } = useMuat('production.list', filter)
  const produk = useMuat('master.products.list', {})
  const [form, setForm] = useState(false)

  if (memuat || produk.memuat) return <SedangMemuat pesan="Memuat catatan produksi..." />
  if (galat) {
    return (
      <>
        <JudulHalaman judul="Produksi" />
        <Galat galat={galat} coba={muatUlang} />
      </>
    )
  }

  const r = data.ringkasan
  const ada = data.daftar.length > 0

  return (
    <>
      <JudulHalaman
        judul="Produksi"
        keterangan={`${angka(r.jumlah_batch)} batch · ${angka(r.total_qty)} unit diproduksi`}
        aksi={<Tombol onClick={() => setForm(true)}>+ Catat batch</Tombol>}
      />

      {form && (
        <FormBatch
          produk={produk.data?.daftar || []}
          onTutup={() => setForm(false)}
          onSelesai={() => { setForm(false); muatUlang() }}
        />
      )}

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Statistik label="Total batch" nilai={angka(r.jumlah_batch)} />
        <Statistik label="Unit diproduksi" nilai={angka(r.total_qty)}
          catatan={r.per_produk.map((p) => `${p.product_code} ${angka(p.qty)}`).join(' · ')} />
        <Statistik
          label="Tanpa catatan mutu"
          nilai={angka(r.tanpa_catatan_mutu)}
          nada={r.tanpa_catatan_mutu > 0 ? 'perhatian' : 'baik'}
          catatan={
            r.tanpa_catatan_mutu > 0
              ? 'pH atau TDS belum diisi'
              : 'seluruh batch tercatat mutunya'
          }
        />
      </div>

      <Kartu padat>
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
          <Pilihan
            label="Produk"
            value={filter.product_code}
            onChange={(e) => setFilter({ ...filter, product_code: e.target.value })}
            className="w-48"
          >
            <option value="">Semua</option>
            {(produk.data?.daftar || []).map((p) => (
              <option key={p.code} value={p.code}>{p.code}</option>
            ))}
          </Pilihan>
          <Isian label="Dari" type="date" value={filter.dari}
            onChange={(e) => setFilter({ ...filter, dari: e.target.value })} className="w-44" />
          <Isian label="Sampai" type="date" value={filter.sampai}
            onChange={(e) => setFilter({ ...filter, sampai: e.target.value })} className="w-44" />
        </div>

        {!ada && (
          <Kosong
            judul="Belum ada batch tercatat"
            keterangan="Catatan produksi menyimpan nilai pH dan TDS tiap batch. Kalau suatu saat ada keluhan mutu, batch mana yang bermasalah hanya bisa ditelusuri kalau angkanya pernah dicatat."
          />
        )}

        {ada && (
          <Tabel
            kepala={[
              { label: 'Batch' },
              { label: 'Tanggal' },
              { label: 'Produk' },
              { label: 'Jumlah', kanan: true },
              { label: 'pH', kanan: true },
              { label: 'TDS', kanan: true },
              { label: 'PIC' },
            ]}
          >
            {data.daftar.map((b) => (
              <tr key={b.batch_id}>
                <Sel tebal>{b.batch_no}</Sel>
                <Sel samar>{tanggalPendek(b.produced_at)}</Sel>
                <Sel>
                  <span className="font-medium">{b.product_code}</span>
                  <span className="ml-2 text-slate-500">{b.kemasan}</span>
                </Sel>
                <Sel kanan tebal>{angka(b.qty)}</Sel>
                <Sel kanan samar={!b.ph_value}>{b.ph_value || '—'}</Sel>
                <Sel kanan samar={!b.tds_value}>{b.tds_value || '—'}</Sel>
                <Sel>
                  <span className="block">{b.pic}</span>
                  {!b.mutu_lengkap && (
                    <Status nilai="unpaid" teks="mutu belum lengkap" />
                  )}
                </Sel>
              </tr>
            ))}
          </Tabel>
        )}
      </Kartu>
    </>
  )
}

function FormBatch({ produk, onTutup, onSelesai }) {
  const { kirim, sibuk, galat } = useKirim()
  const [f, setF] = useState({
    product_code: '', qty: '', ph_value: '', tds_value: '',
    pic: '', notes: '', produced_at: hariIniIso(),
  })
  const [hasil, setHasil] = useState(null)

  async function simpan(ev) {
    ev.preventDefault()
    try {
      setHasil(await kirim('production.create', {
        ...f,
        qty: Number(f.qty) || 0,
        ph_value: f.ph_value === '' ? null : Number(f.ph_value),
        tds_value: f.tds_value === '' ? null : Number(f.tds_value),
      }))
    } catch {
      // pesan galat sudah ditampilkan
    }
  }

  if (hasil) {
    return (
      <Panel judul="Batch tersimpan" onTutup={onSelesai}>
        <p className="text-xl font-bold text-slate-900">{hasil.batch_no}</p>
        <p className="mt-0.5 text-slate-600">
          {angka(hasil.qty)} unit {hasil.product_code} · {hasil.pic}
        </p>
        {(hasil.ph_value === null || hasil.tds_value === null) && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Batch ini tersimpan tanpa catatan mutu lengkap. Nilai pH dan TDS
            tidak bisa ditambahkan belakangan lewat sistem — hanya lewat
            spreadsheet.
          </div>
        )}
        <div className="mt-5">
          <Tombol onClick={onSelesai}>Selesai</Tombol>
        </div>
      </Panel>
    )
  }

  return (
    <Panel judul="Catat batch produksi" onTutup={onTutup}>
      <form onSubmit={simpan} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Pilihan
            label="Produk"
            value={f.product_code}
            onChange={(e) => setF({ ...f, product_code: e.target.value })}
          >
            <option value="">— pilih produk —</option>
            {produk.filter((p) => p.is_active).map((p) => (
              <option key={p.code} value={p.code}>
                {p.code} — {p.packaging_type || p.name}
              </option>
            ))}
          </Pilihan>
          <Isian label="Jumlah diproduksi" type="number" min="1" value={f.qty}
            onChange={(e) => setF({ ...f, qty: e.target.value })} />
          <Isian label="Tanggal produksi" type="date" value={f.produced_at}
            max={hariIniIso()}
            onChange={(e) => setF({ ...f, produced_at: e.target.value })} />
          <Isian label="Penanggung jawab" value={f.pic}
            onChange={(e) => setF({ ...f, pic: e.target.value })}
            placeholder="Nama operator"
            keterangan="Wajib — jejak bila ada keluhan mutu" />
          <Isian label="Nilai pH" type="number" step="0.1" min="0" max="14"
            value={f.ph_value}
            onChange={(e) => setF({ ...f, ph_value: e.target.value })}
            keterangan="Target produk: 6" />
          <Isian label="Nilai TDS" type="number" step="0.001" min="0"
            value={f.tds_value}
            onChange={(e) => setF({ ...f, tds_value: e.target.value })}
            keterangan="Target produk: 0.003" />
        </div>

        <Isian label="Catatan" value={f.notes}
          onChange={(e) => setF({ ...f, notes: e.target.value })}
          placeholder="Opsional" />

        {galat && <Galat galat={galat} />}

        <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
          <Tombol varian="kedua" type="button" onClick={onTutup}>Batal</Tombol>
          <Tombol type="submit" sibuk={sibuk}
            nonaktif={!f.product_code || !f.qty || !f.pic}>
            Simpan batch
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
