/**
 * ui.jsx — komponen tampilan bersama.
 *
 * Semua halaman memakai bentuk yang sama dari sini. Warna dan jarak tidak
 * ditulis ulang di tiap halaman, supaya perubahan gaya cukup dilakukan sekali
 * dan tidak ada halaman yang perlahan menyimpang sendiri.
 *
 * Arah tampilannya: lapang, teks cukup besar, status berwarna jelas.
 * Penggunanya staf administrasi di layar laptop, bukan analis di layar lebar.
 */

/* --- wadah ---------------------------------------------------------------- */

export function Kartu({ judul, aksi, anak, children, padat }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      {(judul || aksi) && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <h2 className="font-semibold text-slate-800">{judul}</h2>
          {aksi}
        </header>
      )}
      <div className={padat ? '' : 'p-5'}>{children ?? anak}</div>
    </section>
  )
}

export function JudulHalaman({ judul, keterangan, aksi }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{judul}</h1>
        {keterangan && <p className="mt-1 text-slate-500">{keterangan}</p>}
      </div>
      {aksi}
    </div>
  )
}

/** Angka besar untuk kartu ringkasan. */
export function Statistik({ label, nilai, catatan, nada = 'netral' }) {
  const warna = {
    netral: 'text-slate-900',
    baik: 'text-emerald-700',
    perhatian: 'text-amber-700',
    buruk: 'text-red-700',
  }[nada]

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className={`mt-1.5 text-2xl font-bold tabular-nums ${warna}`}>{nilai}</p>
      {catatan && <p className="mt-1 text-sm text-slate-500">{catatan}</p>}
    </div>
  )
}

/* --- status --------------------------------------------------------------- */

const GAYA_STATUS = {
  paid: ['Lunas', 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'],
  partial: ['Sebagian', 'bg-sky-50 text-sky-700 ring-sky-600/20'],
  unpaid: ['Belum bayar', 'bg-amber-50 text-amber-800 ring-amber-600/20'],
  cancelled: ['Dibatalkan', 'bg-slate-100 text-slate-500 ring-slate-400/20'],
  terlambat: ['Terlambat', 'bg-red-50 text-red-700 ring-red-600/20'],
  aktif: ['Aktif', 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'],
  nonaktif: ['Nonaktif', 'bg-slate-100 text-slate-500 ring-slate-400/20'],
}

export function Status({ nilai, teks }) {
  const [label, gaya] = GAYA_STATUS[nilai] || [
    nilai, 'bg-slate-100 text-slate-600 ring-slate-400/20',
  ]
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${gaya}`}
    >
      {teks || label}
    </span>
  )
}

/* --- kendali -------------------------------------------------------------- */

export function Tombol({
  children, varian = 'utama', sibuk, nonaktif, ukuran = 'normal',
  className = '', ...sisa
}) {
  const gaya = {
    utama: 'bg-sky-600 text-white hover:bg-sky-700 focus-visible:outline-sky-600',
    kedua: 'bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50',
    bahaya: 'bg-white text-red-700 ring-1 ring-inset ring-red-300 hover:bg-red-50',
    polos: 'text-slate-600 hover:bg-slate-100',
  }[varian]

  const dimensi = ukuran === 'kecil' ? 'px-2.5 py-1.5 text-xs' : 'px-4 py-2.5 text-sm'

  return (
    <button
      {...sisa}
      disabled={sibuk || nonaktif}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition
        focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2
        disabled:cursor-not-allowed disabled:opacity-50 ${dimensi} ${gaya} ${className}`}
    >
      {sibuk && <Pemuat kecil />}
      {sibuk ? 'Menyimpan...' : children}
    </button>
  )
}

export function Isian({
  label, keterangan, galat, type = 'text', className = '', ...sisa
}) {
  return (
    <label className={`block ${className}`}>
      {label && (
        <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      )}
      <input
        type={type}
        {...sisa}
        className={`w-full rounded-lg border px-3 py-2.5 text-sm text-slate-900 shadow-sm
          transition placeholder:text-slate-400 focus:outline-none focus:ring-2
          ${galat
            ? 'border-red-300 focus:border-red-400 focus:ring-red-100'
            : 'border-slate-300 focus:border-sky-400 focus:ring-sky-100'}`}
      />
      {galat
        ? <span className="mt-1 block text-sm text-red-600">{galat}</span>
        : keterangan && <span className="mt-1 block text-sm text-slate-500">{keterangan}</span>}
    </label>
  )
}

export function Pilihan({ label, keterangan, anak, children, className = '', ...sisa }) {
  return (
    <label className={`block ${className}`}>
      {label && (
        <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      )}
      <select
        {...sisa}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm
          text-slate-900 shadow-sm transition focus:border-sky-400 focus:outline-none
          focus:ring-2 focus:ring-sky-100"
      >
        {children ?? anak}
      </select>
      {keterangan && <span className="mt-1 block text-sm text-slate-500">{keterangan}</span>}
    </label>
  )
}

/* --- keadaan -------------------------------------------------------------- */

export function Pemuat({ kecil }) {
  const d = kecil ? 'h-3.5 w-3.5' : 'h-5 w-5'
  return (
    <svg className={`${d} animate-spin`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-90" fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
    </svg>
  )
}

export function SedangMemuat({ pesan = 'Memuat data...' }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-slate-500">
      <Pemuat />
      <span>{pesan}</span>
    </div>
  )
}

/**
 * Tampilan galat.
 *
 * Kode error ikut ditampilkan kecil di bawah. Bagi pengguna itu tidak berarti
 * apa-apa, tapi saat mereka mengirim tangkapan layar, kode itulah yang membuat
 * penyebabnya bisa ditemukan dalam hitungan detik.
 */
export function Galat({ galat, coba }) {
  if (!galat) return null
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4">
      <p className="font-medium text-red-900">{galat.message}</p>
      <div className="mt-2 flex items-center gap-3">
        {galat.kode && (
          <code className="text-xs text-red-600">{galat.kode}</code>
        )}
        {coba && (
          <button onClick={coba} className="text-sm font-medium text-red-700 underline">
            Coba lagi
          </button>
        )}
      </div>
    </div>
  )
}

export function Kosong({ judul, keterangan, aksi }) {
  return (
    <div className="py-16 text-center">
      <p className="font-medium text-slate-700">{judul}</p>
      {keterangan && <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{keterangan}</p>}
      {aksi && <div className="mt-5 flex justify-center">{aksi}</div>}
    </div>
  )
}

/* --- tabel ---------------------------------------------------------------- */

/**
 * Pembungkus tabel dengan gulir mendatar sendiri.
 *
 * Tabel lebar harus menggulir di dalam wadahnya, bukan membuat seluruh
 * halaman ikut bergeser ke samping. Di laptop 13 inci itu bedanya besar.
 */
export function Tabel({ kepala, children }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left">
            {kepala.map((k, i) => (
              <th
                key={i}
                className={`px-5 py-3 font-semibold text-slate-600 ${
                  k.kanan ? 'text-right' : ''
                } ${k.lebar || ''}`}
              >
                {k.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  )
}

export function Sel({ children, kanan, samar, tebal, className = '' }) {
  return (
    <td
      className={`px-5 py-3.5 ${kanan ? 'text-right tabular-nums' : ''} ${
        samar ? 'text-slate-500' : 'text-slate-800'
      } ${tebal ? 'font-semibold' : ''} ${className}`}
    >
      {children}
    </td>
  )
}
