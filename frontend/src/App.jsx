import { lazy, Suspense } from 'react'
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { sudahLogin, ambilUser } from './lib/auth'
import Shell from './components/Shell'
import Login from './pages/Login'
import SalesList from './pages/SalesList'
import SalesEntry from './pages/SalesEntry'
import SalesDetail from './pages/SalesDetail'
import Masters from './pages/Masters'
import Receivables from './pages/Receivables'
import Gallon from './pages/Gallon'
import Production from './pages/Production'
import Expenses from './pages/Expenses'
import Users from './pages/Users'
import Akun from './pages/Akun'
import { Kartu, JudulHalaman, Tombol, SedangMemuat } from './components/ui'

/**
 * Dashboard dimuat terpisah karena satu-satunya halaman yang memakai Recharts,
 * dan pustaka itu sendirian menambah lebih dari 350 KB. Tanpa pemisahan ini,
 * halaman login — yang dibuka semua orang setiap pagi — ikut menunggu pustaka
 * grafik selesai diunduh sebelum menampilkan apa pun.
 */
const Dashboard = lazy(() => import('./pages/Dashboard'))

/**
 * App.jsx — perutean.
 *
 * HashRouter, bukan BrowserRouter. GitHub Pages menyajikan berkas statis dan
 * tidak punya cara mengembalikan index.html untuk alamat yang tidak ada
 * berkasnya. Dengan BrowserRouter, /cv_azama/penjualan akan menghasilkan 404
 * begitu pengguna menyegarkan halaman atau membuka tautan langsung.
 * Alamat berbentuk /cv_azama/#/penjualan tidak pernah dikirim ke server,
 * sehingga selalu bekerja.
 */
export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/masuk" element={<HanyaTamu><Login /></HanyaTamu>} />

        <Route
          path="/dashboard"
          element={
            <Terlindungi roles={['admin', 'sales']}>
              <Suspense fallback={<SedangMemuat pesan="Menyiapkan grafik..." />}>
                <Dashboard />
              </Suspense>
            </Terlindungi>
          }
        />
        <Route path="/penjualan" element={<Terlindungi roles={['admin', 'sales']}><SalesList /></Terlindungi>} />
        <Route path="/penjualan/baru" element={<Terlindungi roles={['admin', 'sales']}><SalesEntry /></Terlindungi>} />
        <Route path="/penjualan/:orderId" element={<Terlindungi roles={['admin', 'sales']}><SalesDetail /></Terlindungi>} />

        <Route path="/piutang" element={<Terlindungi roles={['admin', 'sales']}><Receivables /></Terlindungi>} />
        <Route path="/galon" element={<Terlindungi roles={['admin', 'sales', 'produksi']}><Gallon /></Terlindungi>} />
        <Route path="/produksi" element={<Terlindungi roles={['admin', 'produksi']}><Production /></Terlindungi>} />
        <Route path="/biaya" element={<Terlindungi roles={['admin']}><Expenses /></Terlindungi>} />
        <Route path="/pengguna" element={<Terlindungi roles={['admin']}><Users /></Terlindungi>} />
        <Route path="/master" element={<Terlindungi roles={['admin', 'sales', 'produksi']}><Masters /></Terlindungi>} />
        <Route path="/akun" element={<Terlindungi><Akun /></Terlindungi>} />

        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Terlindungi><TidakDitemukan /></Terlindungi>} />
      </Routes>
    </HashRouter>
  )
}

/**
 * Penjaga rute.
 *
 * Ini kenyamanan tampilan, bukan keamanan. Setiap permintaan tetap diperiksa
 * ulang di Apps Script berdasarkan token bertanda tangan — pengguna yang
 * mengetik alamat halaman admin akan tetap ditolak oleh server, halaman ini
 * hanya menghindarkan mereka dari layar galat yang membingungkan.
 */
function Terlindungi({ roles, children }) {
  const lokasi = useLocation()
  const user = ambilUser()

  if (!sudahLogin() || !user) {
    return <Navigate to="/masuk" replace state={{ dari: lokasi.pathname }} />
  }

  if (roles && !roles.includes(user.role)) {
    return (
      <Shell>
        <JudulHalaman judul="Tidak berhak" />
        <Kartu>
          <p className="text-slate-600">
            Halaman ini tidak tersedia untuk role <strong>{user.role}</strong>.
          </p>
        </Kartu>
      </Shell>
    )
  }

  return <Shell>{children}</Shell>
}

function HanyaTamu({ children }) {
  return sudahLogin() ? <Navigate to="/dashboard" replace /> : children
}

function TidakDitemukan() {
  return (
    <>
      <JudulHalaman judul="Halaman tidak ditemukan" />
      <Kartu>
        <p className="text-slate-600">
          Alamat yang Anda buka tidak ada. Mungkin menu itu belum dibangun pada
          fase ini.
        </p>
        <div className="mt-4">
          <Tombol onClick={() => { window.location.hash = '#/penjualan' }}>
            Ke daftar penjualan
          </Tombol>
        </div>
      </Kartu>
    </>
  )
}
