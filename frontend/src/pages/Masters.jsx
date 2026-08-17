import { useState } from 'react'
import { useMuat, useKirim } from '../lib/hooks'
import { rupiah, angka, tanggalPendek } from '../lib/format'
import { punyaRole } from '../lib/auth'
import {
  JudulHalaman, Kartu, Status, Tombol, Isian, Pilihan,
  SedangMemuat, Galat, Kosong, Tabel, Sel,
} from '../components/ui'

/**
 * Master produk dan customer.
 *
 * Role sales bisa melihat halaman ini — mereka butuh melihat daftar harga dan
 * customer sendiri — tapi tombol ubah hanya muncul untuk admin. Penegakan
 * yang sesungguhnya tetap di Apps Script; ini hanya supaya tombol yang pasti
 * ditolak tidak ikut ditawarkan.
 */
export default function Masters() {
  const bolehUbah = punyaRole('admin')

  // Tab disaring per role. Produksi tidak berhak melihat daftar customer,
  // jadi menampilkan tab-nya hanya akan berujung layar galat.
  const tabTersedia = [
    ['produk', 'Produk', true],
    ['customer', 'Customer', punyaRole('admin', 'sales')],
    ['bahan', 'Bahan baku', punyaRole('admin', 'produksi')],
    ['supplier', 'Supplier', punyaRole('admin', 'produksi')],
  ].filter(([, , boleh]) => boleh)

  const [tab, setTab] = useState(tabTersedia[0][0])

  return (
    <>
      <JudulHalaman
        judul="Data master"
        keterangan={
          bolehUbah
            ? 'Perubahan di sini memengaruhi seluruh penjualan berikutnya'
            : 'Anda dapat melihat, tetapi hanya admin yang dapat mengubah'
        }
      />

      <div className="mb-5 flex gap-1 border-b border-slate-200">
        {tabTersedia.map(([kunci, label]) => (
          <button
            key={kunci}
            onClick={() => setTab(kunci)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition ${
              tab === kunci
                ? 'border-sky-600 text-sky-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'produk' && <TabelProduk bolehUbah={bolehUbah} />}
      {tab === 'customer' && <TabelCustomer bolehUbah={bolehUbah} />}
      {tab === 'bahan' && <TabelSederhana
        action="master.materials"
        judul="bahan baku"
        bolehUbah={bolehUbah}
        kolom={[
          { kunci: 'code', label: 'Kode', tebal: true },
          { kunci: 'name', label: 'Nama' },
          { kunci: 'unit', label: 'Satuan', samar: true },
        ]}
        isian={[
          { kunci: 'code', label: 'Kode bahan', kunciUtama: true,
            keterangan: 'Huruf besar dan angka, 2–12 karakter' },
          { kunci: 'name', label: 'Nama bahan' },
          { kunci: 'unit', label: 'Satuan', placeholder: 'pcs' },
        ]}
        catatan="Daftar ini sengaja tanpa jumlah persediaan. Model bisnisnya pre-order, dan STOK_BAHAN di Excel lama pun hanya berisi nama item tanpa satu pun angka."
      />}
      {tab === 'supplier' && <TabelSederhana
        action="master.suppliers"
        judul="supplier"
        bolehUbah={bolehUbah}
        kolom={[
          { kunci: 'code', label: 'Kode', tebal: true },
          { kunci: 'name', label: 'Nama' },
          { kunci: 'phone', label: 'Kontak', samar: true },
          { kunci: 'address', label: 'Alamat', samar: true },
          { kunci: 'payment_term_days', label: 'Tempo', kanan: true, akhiran: ' hari' },
        ]}
        isian={[
          { kunci: 'code', label: 'Kode supplier', kunciUtama: true },
          { kunci: 'name', label: 'Nama supplier' },
          { kunci: 'phone', label: 'Kontak / No HP' },
          { kunci: 'address', label: 'Alamat' },
          { kunci: 'payment_term_days', label: 'Tempo pembayaran (hari)', tipe: 'number' },
        ]}
      />}
    </>
  )
}

/**
 * Tabel master sederhana untuk bahan dan supplier.
 *
 * Keduanya hanya daftar rujukan tanpa perhitungan apa pun, jadi satu komponen
 * berdasarkan definisi kolom lebih jujur daripada dua komponen yang isinya
 * hampir sama persis.
 */
function TabelSederhana({ action, judul, bolehUbah, kolom, isian, catatan }) {
  const { data, galat, memuat, muatUlang } = useMuat(`${action}.list`, {})
  const [ubah, setUbah] = useState(null)

  if (memuat) return <SedangMemuat />
  if (galat) return <Galat galat={galat} coba={muatUlang} />

  return (
    <>
      {ubah && (
        <FormSederhana
          action={action}
          judul={judul}
          isian={isian}
          awal={ubah}
          onTutup={() => setUbah(null)}
          onSelesai={() => { setUbah(null); muatUlang() }}
        />
      )}

      <Kartu
        judul={`${data.jumlah} ${judul}`}
        padat
        aksi={bolehUbah && (
          <Tombol ukuran="kecil" onClick={() => setUbah({ baru: true })}>
            + Tambah
          </Tombol>
        )}
      >
        {data.daftar.length === 0 ? (
          <Kosong judul={`Belum ada ${judul} tercatat`} />
        ) : (
          <Tabel kepala={[...kolom.map((k) => ({ label: k.label, kanan: k.kanan })), { label: '' }]}>
            {data.daftar.map((baris) => (
              <tr key={baris.code}>
                {kolom.map((k) => (
                  <Sel key={k.kunci} kanan={k.kanan} samar={k.samar} tebal={k.tebal}>
                    {baris[k.kunci] ? `${baris[k.kunci]}${k.akhiran || ''}` : '—'}
                  </Sel>
                ))}
                <Sel>
                  <div className="flex justify-end">
                    {bolehUbah && (
                      <Tombol varian="polos" ukuran="kecil" onClick={() => setUbah(baris)}>
                        Ubah
                      </Tombol>
                    )}
                  </div>
                </Sel>
              </tr>
            ))}
          </Tabel>
        )}
      </Kartu>

      {catatan && <p className="mt-4 pb-4 text-sm text-slate-500">{catatan}</p>}
    </>
  )
}

function FormSederhana({ action, judul, isian, awal, onTutup, onSelesai }) {
  const baru = awal.baru === true
  const { kirim, sibuk, galat } = useKirim()
  const [f, setF] = useState(() => {
    const awalan = {}
    isian.forEach((i) => { awalan[i.kunci] = awal[i.kunci] ?? '' })
    return awalan
  })

  async function simpan(ev) {
    ev.preventDefault()
    try {
      const kirimData = { ...f }
      isian.forEach((i) => {
        if (i.tipe === 'number') kirimData[i.kunci] = Number(f[i.kunci]) || 0
      })
      await kirim(`${action}.upsert`, kirimData)
      onSelesai()
    } catch {
      // pesan galat sudah ditampilkan
    }
  }

  return (
    <PanelMaster judul={baru ? `Tambah ${judul}` : `Ubah ${awal.code}`} onTutup={onTutup}>
      <form onSubmit={simpan} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {isian.map((i) => (
            <Isian
              key={i.kunci}
              label={i.label}
              type={i.tipe || 'text'}
              placeholder={i.placeholder}
              value={f[i.kunci]}
              disabled={i.kunciUtama && !baru}
              onChange={(e) => setF({
                ...f,
                [i.kunci]: i.kunciUtama ? e.target.value.toUpperCase() : e.target.value,
              })}
              keterangan={i.kunciUtama && !baru ? 'Kode tidak bisa diubah' : i.keterangan}
            />
          ))}
        </div>

        {galat && <Galat galat={galat} />}

        <div className="flex justify-end gap-3">
          <Tombol varian="kedua" type="button" onClick={onTutup}>Batal</Tombol>
          <Tombol type="submit" sibuk={sibuk} nonaktif={!f.code || !f.name}>
            Simpan
          </Tombol>
        </div>
      </form>
    </PanelMaster>
  )
}

function PanelMaster({ judul, onTutup, children }) {
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

/* --- produk --------------------------------------------------------------- */

function TabelProduk({ bolehUbah }) {
  const { data, galat, memuat, muatUlang } = useMuat('master.products.list',
    { termasuk_nonaktif: true })
  const [ubah, setUbah] = useState(null)

  if (memuat) return <SedangMemuat />
  if (galat) return <Galat galat={galat} coba={muatUlang} />

  return (
    <>
      {ubah && (
        <FormProduk
          awal={ubah}
          onTutup={() => setUbah(null)}
          onSelesai={() => { setUbah(null); muatUlang() }}
        />
      )}

      <Kartu
        judul={`${data.jumlah} produk`}
        padat
        aksi={bolehUbah && (
          <Tombol ukuran="kecil" onClick={() => setUbah({ baru: true })}>
            + Produk baru
          </Tombol>
        )}
      >
        <Tabel
          kepala={[
            { label: 'Kode' },
            { label: 'Nama' },
            { label: 'HPP', kanan: true },
            { label: 'Harga jual', kanan: true },
            { label: 'Margin', kanan: true },
            { label: '' },
          ]}
        >
          {data.daftar.map((p) => (
            <tr key={p.code} className={p.is_active ? '' : 'bg-slate-50/60'}>
              <Sel tebal>{p.code}</Sel>
              <Sel>
                <span className="block">{p.name}</span>
                <span className="text-xs text-slate-400">
                  {p.packaging_type}
                  {p.volume_ml ? ` · ${angka(p.volume_ml)} ml` : ''}
                  {p.is_returnable ? ' · galon kembali' : ''}
                </span>
              </Sel>
              <Sel kanan samar={!p.hpp_terisi}>
                {p.hpp_terisi ? rupiah(p.cogs) : 'belum diisi'}
              </Sel>
              <Sel kanan>{rupiah(p.price)}</Sel>
              <Sel kanan>
                {p.hpp_terisi ? (
                  <>
                    <span className="font-medium text-emerald-700">{rupiah(p.margin)}</span>
                    <span className="ml-1.5 text-xs text-slate-400">{p.margin_persen}%</span>
                  </>
                ) : <span className="text-slate-300">—</span>}
              </Sel>
              <Sel>
                <div className="flex items-center justify-end gap-2">
                  {!p.is_active && <Status nilai="nonaktif" />}
                  {bolehUbah && (
                    <Tombol varian="polos" ukuran="kecil" onClick={() => setUbah(p)}>
                      Ubah
                    </Tombol>
                  )}
                </div>
              </Sel>
            </tr>
          ))}
        </Tabel>
      </Kartu>
    </>
  )
}

function FormProduk({ awal, onTutup, onSelesai }) {
  const baru = awal.baru === true
  const { kirim, sibuk, galat } = useKirim()
  const [f, setF] = useState({
    code: awal.code || '',
    name: awal.name || '',
    packaging_type: awal.packaging_type || '',
    volume_ml: awal.volume_ml ?? '',
    cogs: awal.cogs ?? '',
    price: awal.price ?? '',
    min_stock: awal.min_stock ?? '',
    deposit_amount: awal.deposit_amount ?? '',
    is_returnable: awal.is_returnable ?? true,
    is_active: awal.is_active ?? true,
  })

  async function simpan(ev) {
    ev.preventDefault()
    try {
      await kirim('master.products.upsert', {
        ...f,
        volume_ml: Number(f.volume_ml) || 0,
        cogs: Number(f.cogs) || 0,
        price: Number(f.price) || 0,
        min_stock: Number(f.min_stock) || 0,
        deposit_amount: Number(f.deposit_amount) || 0,
      })
      onSelesai()
    } catch {
      // pesan galat sudah ditampilkan
    }
  }

  return (
    <Panel judul={baru ? 'Produk baru' : `Ubah ${awal.code}`} onTutup={onTutup}>
      <form onSubmit={simpan} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Isian
            label="Kode produk"
            value={f.code}
            onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })}
            disabled={!baru}
            keterangan={baru
              ? 'Huruf besar dan angka, 2–12 karakter'
              : 'Kode tidak bisa diubah — seluruh invoice lama menunjuk ke sini'}
          />
          <Isian label="Nama produk" value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Isian label="Jenis kemasan" value={f.packaging_type}
            onChange={(e) => setF({ ...f, packaging_type: e.target.value })}
            placeholder="Galon" />
          <Isian label="Volume (ml)" type="number" value={f.volume_ml}
            onChange={(e) => setF({ ...f, volume_ml: e.target.value })} />
          <Isian label="HPP per unit" type="number" value={f.cogs}
            onChange={(e) => setF({ ...f, cogs: e.target.value })}
            keterangan="Tanpa ini, laporan margin tidak bermakna" />
          <Isian label="Harga jual" type="number" value={f.price}
            onChange={(e) => setF({ ...f, price: e.target.value })} />
          <Isian label="Nilai deposit galon" type="number" value={f.deposit_amount}
            onChange={(e) => setF({ ...f, deposit_amount: e.target.value })}
            keterangan="Dipakai modul tukar galon di Fase 3" />
        </div>

        <div className="flex flex-wrap gap-5 rounded-lg bg-slate-50 px-4 py-3">
          <Centang label="Galon dikembalikan customer" nilai={f.is_returnable}
            onUbah={(v) => setF({ ...f, is_returnable: v })} />
          <Centang label="Produk aktif" nilai={f.is_active}
            onUbah={(v) => setF({ ...f, is_active: v })} />
        </div>

        {galat && <Galat galat={galat} />}

        <div className="flex justify-end gap-3">
          <Tombol varian="kedua" type="button" onClick={onTutup}>Batal</Tombol>
          <Tombol type="submit" sibuk={sibuk} nonaktif={!f.code || !f.name}>
            Simpan
          </Tombol>
        </div>
      </form>
    </Panel>
  )
}

/* --- customer ------------------------------------------------------------- */

function TabelCustomer({ bolehUbah }) {
  const [cari, setCari] = useState('')
  const { data, galat, memuat, muatUlang } = useMuat('master.customers.list',
    { termasuk_nonaktif: true, cari })
  const [ubah, setUbah] = useState(null)

  if (galat) return <Galat galat={galat} coba={muatUlang} />

  return (
    <>
      {ubah && (
        <FormCustomer
          awal={ubah}
          onTutup={() => setUbah(null)}
          onSelesai={() => { setUbah(null); muatUlang() }}
        />
      )}

      <Kartu
        judul={data ? `${data.jumlah} customer` : 'Customer'}
        padat
        aksi={bolehUbah && (
          <Tombol ukuran="kecil" onClick={() => setUbah({ baru: true })}>
            + Customer baru
          </Tombol>
        )}
      >
        <div className="border-b border-slate-100 p-4">
          <Isian
            placeholder="Cari nama atau kode customer..."
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            className="max-w-sm"
          />
        </div>

        {memuat && <SedangMemuat />}

        {!memuat && data?.daftar.length === 0 && (
          <Kosong
            judul="Tidak ada customer yang cocok"
            keterangan={cari ? `Tidak ada yang cocok dengan "${cari}".` : undefined}
          />
        )}

        {!memuat && data?.daftar.length > 0 && (
          <Tabel
            kepala={[
              { label: 'Kode' },
              { label: 'Nama' },
              { label: 'Sales' },
              { label: 'Tempo', kanan: true },
              { label: 'Piutang', kanan: true },
              { label: 'Galon', kanan: true },
              { label: '' },
            ]}
          >
            {data.daftar.map((c) => (
              <tr key={c.code} className={c.is_active ? '' : 'bg-slate-50/60'}>
                <Sel tebal>{c.code}</Sel>
                <Sel>
                  <span className="block">{c.name}</span>
                  <span className="text-xs text-slate-400">
                    {[c.area, c.type].filter(Boolean).join(' · ')}
                    {c.transaksi_terakhir
                      ? ` · terakhir ${tanggalPendek(c.transaksi_terakhir)}`
                      : ' · belum pernah transaksi'}
                  </span>
                </Sel>
                <Sel samar>{c.sales_person || '—'}</Sel>
                <Sel kanan samar>{c.payment_term_days} hari</Sel>
                <Sel kanan tebal>
                  <span className={c.piutang > 0 ? 'text-amber-700' : 'text-slate-400'}>
                    {c.piutang > 0 ? rupiah(c.piutang) : '—'}
                  </span>
                </Sel>
                <Sel kanan>
                  <span className={c.saldo_galon > 0 ? 'font-medium text-slate-800' : 'text-slate-300'}>
                    {c.saldo_galon > 0 ? angka(c.saldo_galon) : '—'}
                  </span>
                </Sel>
                <Sel>
                  <div className="flex items-center justify-end gap-2">
                    {!c.is_active && <Status nilai="nonaktif" />}
                    {bolehUbah && (
                      <Tombol varian="polos" ukuran="kecil" onClick={() => setUbah(c)}>
                        Ubah
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

function FormCustomer({ awal, onTutup, onSelesai }) {
  const baru = awal.baru === true
  const { kirim, sibuk, galat } = useKirim()
  const [f, setF] = useState({
    code: awal.code || '',
    name: awal.name || '',
    area: awal.area || '',
    type: awal.type || '',
    payment_term_days: awal.payment_term_days ?? 30,
    phone: awal.phone || '',
    sales_person: awal.sales_person || '',
    is_active: awal.is_active ?? true,
  })

  async function simpan(ev) {
    ev.preventDefault()
    try {
      await kirim('master.customers.upsert', {
        ...f,
        payment_term_days: Number(f.payment_term_days) || 30,
      })
      onSelesai()
    } catch {
      // pesan galat sudah ditampilkan
    }
  }

  return (
    <Panel judul={baru ? 'Customer baru' : `Ubah ${awal.code}`} onTutup={onTutup}>
      <form onSubmit={simpan} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Isian
            label="Kode customer"
            value={f.code}
            onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })}
            disabled={!baru}
            keterangan={baru ? 'Pola yang dipakai selama ini: 22C26MLG' : 'Kode tidak bisa diubah'}
          />
          <Isian label="Nama customer" value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Isian label="Area" value={f.area}
            onChange={(e) => setF({ ...f, area: e.target.value })}
            placeholder="Bululawang" />
          <Pilihan label="Tipe" value={f.type}
            onChange={(e) => setF({ ...f, type: e.target.value })}>
            <option value="">— pilih —</option>
            {['Café', 'Office', 'Personal', 'Community', 'Industry', 'Reseller'].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Pilihan>
          <Isian label="Tempo pembayaran (hari)" type="number"
            value={f.payment_term_days}
            onChange={(e) => setF({ ...f, payment_term_days: e.target.value })}
            keterangan="Jatuh tempo invoice dihitung dari angka ini" />
          <Isian label="Kontak / No HP" value={f.phone}
            onChange={(e) => setF({ ...f, phone: e.target.value })}
            placeholder="0812-3456-7890" />
          <Isian
            label="Sales penanggung jawab"
            value={f.sales_person}
            onChange={(e) => setF({ ...f, sales_person: e.target.value })}
            keterangan="Harus sama persis dengan nama di akun sales, misalnya Zhulham"
          />
        </div>

        <div className="rounded-lg bg-slate-50 px-4 py-3">
          <Centang label="Customer aktif" nilai={f.is_active}
            onUbah={(v) => setF({ ...f, is_active: v })} />
        </div>

        {galat && <Galat galat={galat} />}

        <div className="flex justify-end gap-3">
          <Tombol varian="kedua" type="button" onClick={onTutup}>Batal</Tombol>
          <Tombol type="submit" sibuk={sibuk} nonaktif={!f.code || !f.name}>
            Simpan
          </Tombol>
        </div>
      </form>
    </Panel>
  )
}

/* --- bersama -------------------------------------------------------------- */

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

function Centang({ label, nilai, onUbah }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-700">
      <input
        type="checkbox"
        checked={!!nilai}
        onChange={(e) => onUbah(e.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
      />
      {label}
    </label>
  )
}
