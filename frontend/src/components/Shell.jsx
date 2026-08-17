import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { ambilUser, hapusSesi } from '../lib/auth'
import { panggilApi } from '../lib/api'

/**
 * Shell.jsx — kerangka aplikasi: menu samping dan kepala halaman.
 *
 * Menu disaring per role, tapi itu semata kenyamanan tampilan. Penegakan hak
 * akses yang sebenarnya ada di Apps Script, yang membaca role dari token
 * bertanda tangan. Menyembunyikan tautan tidak menghalangi siapa pun
 * memanggil endpoint langsung.
 *
 * Menu fase berikutnya sengaja tetap ditampilkan dalam keadaan mati dan
 * bertanda "segera". Pengguna jadi tahu bentuk akhir sistemnya, dan tidak
 * mengira ada menu yang hilang.
 */

/* --- ikon ----------------------------------------------------------------- */

/**
 * Ikon didefinisikan sebelum MENU, bukan setelahnya.
 *
 * MENU dievaluasi saat modul dimuat dan langsung merujuk ke ikon-ikon ini.
 * Kalau definisinya diletakkan di bawah, const-nya masih berada di temporal
 * dead zone dan seluruh aplikasi gagal dimuat dengan pesan
 * "Cannot access 'IkonDashboard' before initialization".
 */
function bungkus(d) {
  return function Ikon() {
    return (
      <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24"
        stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d={d} />
      </svg>
    )
  }
}

const IkonDashboard = bungkus('M3 13h8V3H3v10Zm10 8h8V11h-8v10ZM3 21h8v-6H3v6ZM13 9h8V3h-8v6Z')
const IkonPenjualan = bungkus('M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m-6 9h6m-6 4h4')
const IkonPiutang = bungkus('M12 8c-1.7 0-3 .9-3 2s1.3 2 3 2 3 .9 3 2-1.3 2-3 2m0-8c1.3 0 2.4.5 2.8 1.3M12 8V6m0 10v2m0-2c-1.3 0-2.4-.5-2.8-1.3M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z')
const IkonGalon = bungkus('M8 3h8M9 3v3.5L6.5 10A4 4 0 0 0 6 12v7a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-7a4 4 0 0 0-.5-2L15 6.5V3M6 15h12')
const IkonProduksi = bungkus('M4 20h16M5 20V9l5 3.5V9l5 3.5V6l4 2.5V20')
const IkonBiaya = bungkus('M3 6h18M3 6v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6M3 6l2-3h14l2 3M9 11h6')
const IkonMaster = bungkus('M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Zm0 0v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3')

/**
 * Tidak ada menu Stok.
 *
 * Model bisnisnya pre-order: produksi mengikuti pesanan yang masuk, tidak ada
 * penyetokan barang jadi. Mutasi barang keluar tetap dicatat di buku besar
 * sebagai riwayat, tapi tidak ada angka stok yang bermakna untuk ditampilkan.
 */
const MENU = [
  { ke: '/dashboard', label: 'Dashboard', ikon: IkonDashboard, roles: ['admin', 'sales'] },
  { ke: '/penjualan', label: 'Penjualan', ikon: IkonPenjualan, roles: ['admin', 'sales'] },
  { ke: '/piutang', label: 'Piutang', ikon: IkonPiutang, roles: ['admin', 'sales'] },
  { ke: '/galon', label: 'Galon', ikon: IkonGalon, roles: ['admin', 'sales', 'produksi'] },
  { ke: '/produksi', label: 'Produksi', ikon: IkonProduksi, roles: ['admin', 'produksi'], segera: true },
  { ke: '/biaya', label: 'Biaya', ikon: IkonBiaya, roles: ['admin'], segera: true },
  { ke: '/master', label: 'Master', ikon: IkonMaster, roles: ['admin', 'sales'] },
]

export default function Shell({ children }) {
  const [menuTerbuka, setMenuTerbuka] = useState(false)
  const user = ambilUser()
  const navigate = useNavigate()

  async function keluar() {
    // Token tanpa status di server, jadi panggilan ini hanya untuk audit log.
    // Kegagalannya tidak boleh menghalangi pengguna keluar.
    try {
      await panggilApi('auth.logout')
    } catch {
      // diabaikan dengan sengaja
    }
    hapusSesi()
    navigate('/masuk', { replace: true })
  }

  const menuTerpakai = MENU.filter((m) => m.roles.includes(user?.role))

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Kepala versi ponsel */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <Logo />
        <button
          onClick={() => setMenuTerbuka(!menuTerbuka)}
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
          aria-label="Buka menu"
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" d={menuTerbuka ? 'M6 18L18 6M6 6l12 12' : 'M4 7h16M4 12h16M4 17h16'} />
          </svg>
        </button>
      </div>

      <div className="lg:flex">
        {/* Menu samping */}
        <aside
          className={`${menuTerbuka ? 'block' : 'hidden'} border-b border-slate-200 bg-white
            lg:sticky lg:top-0 lg:block lg:h-screen lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r`}
        >
          <div className="hidden px-5 py-5 lg:block">
            <Logo />
          </div>

          <nav className="space-y-0.5 px-3 pb-4 lg:pb-0">
            {menuTerpakai.map((m) => (
              <ItemMenu
                key={m.ke}
                {...m}
                onNavigasi={() => setMenuTerbuka(false)}
              />
            ))}
          </nav>

          <div className="mt-auto border-t border-slate-100 p-3 lg:absolute lg:bottom-0 lg:w-60">
            <NavLink
              to="/akun"
              onClick={() => setMenuTerbuka(false)}
              className={({ isActive }) =>
                `block rounded-lg px-3 py-2 transition ${
                  isActive ? 'bg-sky-50' : 'hover:bg-slate-100'
                }`
              }
            >
              <p className="truncate text-sm font-medium text-slate-800">
                {user?.full_name}
              </p>
              <p className="text-xs text-slate-500">
                {{ admin: 'Administrator', sales: 'Sales', produksi: 'Produksi' }[user?.role] ||
                  user?.role}
                {user?.sales_person_name ? ` · ${user.sales_person_name}` : ''}
              </p>
            </NavLink>
            <button
              onClick={keluar}
              className="mt-1 w-full rounded-lg px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-100"
            >
              Keluar
            </button>
          </div>
        </aside>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  )
}

function ItemMenu({ ke, label, ikon: Ikon, segera, onNavigasi }) {
  if (segera) {
    return (
      <div
        className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-300"
        title="Belum tersedia pada fase ini"
      >
        <Ikon />
        <span className="flex-1">{label}</span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
          segera
        </span>
      </div>
    )
  }

  return (
    <NavLink
      to={ke}
      onClick={onNavigasi}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
          isActive
            ? 'bg-sky-50 text-sky-700'
            : 'text-slate-700 hover:bg-slate-100'
        }`
      }
    >
      <Ikon />
      {label}
    </NavLink>
  )
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-600">
        <svg className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2.5c-.4 0-.7.2-.9.5C9.4 5.6 5.5 11.3 5.5 14.8a6.5 6.5 0 1 0 13 0c0-3.5-3.9-9.2-5.6-11.8a1 1 0 0 0-.9-.5Z" />
        </svg>
      </div>
      <div className="leading-tight">
        <p className="text-sm font-bold text-slate-900">AZAMA</p>
        <p className="text-[11px] text-slate-500">Sistem Informasi</p>
      </div>
    </div>
  )
}

