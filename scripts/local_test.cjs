/**
 * local_test.cjs — uji kode Apps Script di komputer sendiri.
 *
 *     node scripts/local_test.cjs
 *
 * Kenapa ada berkas ini:
 *
 * Siklus ubah-kode lalu uji di Apps Script sangat lambat. Setiap perubahan
 * kecil menuntut clasp push, bikin versi baru, arahkan deployment, lalu
 * panggil URL. Kalau ada yang salah, satu-satunya petunjuk adalah log di
 * dasbor Google.
 *
 * Lingkungan tiruannya ada di lib/harness.cjs. Data yang diuji adalah data
 * sungguhan hasil migrasi, bukan data karangan.
 *
 * Yang TIDAK bisa diuji di sini: perilaku kuota, penguncian sungguhan antar
 * eksekusi bersamaan, dan cara Google Sheets diam-diam mengubah tipe kolom
 * saat impor. Tiga hal itu hanya muncul di lingkungan aslinya.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const {
  DIR_CSV, muatSpreadsheet, bangunKonteks, muatKodeGs, panggilDoPost,
} = require('./lib/harness.cjs');

const SECRET_UJI = 'kunci-uji-lokal-yang-panjangnya-lebih-dari-32-karakter';


// ---------------------------------------------------------------------------
// Kerangka pengujian
// ---------------------------------------------------------------------------

let lulus = 0, gagal = 0;
const kegagalan = [];

function uji(judul, fn) {
  try {
    fn();
    console.log(`  LULUS  ${judul}`);
    lulus++;
  } catch (e) {
    console.log(`  GAGAL  ${judul}`);
    console.log(`         ${e.message}`);
    kegagalan.push(judul);
    gagal++;
  }
}

function harus(kondisi, pesan) {
  if (!kondisi) throw new Error(pesan);
}

function harusSama(aktual, diharapkan, label) {
  if (aktual !== diharapkan) {
    throw new Error(`${label}: dapat ${JSON.stringify(aktual)}, ` +
                    `harusnya ${JSON.stringify(diharapkan)}`);
  }
}

function panggil(konteks, action, payload, token) {
  return JSON.parse(panggilDoPost(konteks, JSON.stringify({ action, payload, token })));
}

/** Selisih hari antara dua tanggal ISO, untuk memeriksa jatuh tempo. */
function selisihHariUji(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

function siapkanKonteks(secret = SECRET_UJI) {
  const ss = muatSpreadsheet(DIR_CSV);
  const konteks = bangunKonteks(ss, { SPREADSHEET_ID: 'ID_UJI', SECRET_KEY: secret });
  muatKodeGs(konteks);
  return { ss, konteks };
}


// ---------------------------------------------------------------------------

function main() {
  console.log('='.repeat(72));
  console.log('UJI LOKAL APPS SCRIPT — AZAMA');
  console.log('='.repeat(72));

  let ss, konteks;
  try {
    ({ ss, konteks } = siapkanKonteks());
  } catch (e) {
    console.error('\n' + e.message + '\n');
    process.exit(1);
  }

  console.log(`\nTab dimuat : ${ss.getSheets().length}`);

  // Kredensial diambil dari berkas yang ditulis skrip migrasi, supaya
  // pengujian selalu memakai hash yang benar-benar ada di users.csv.
  const jalurKredensial = path.join(DIR_CSV, 'KREDENSIAL_AWAL.txt');
  if (!fs.existsSync(jalurKredensial)) {
    console.error('\nKREDENSIAL_AWAL.txt tidak ada. Jalankan ulang migrate_excel.py\n');
    process.exit(1);
  }
  const kredensial = {};
  for (const [, u, p] of fs.readFileSync(jalurKredensial, 'utf8')
       .matchAll(/^(\S+)\s+(\S+)\s+\((\w+)\)$/gm)) {
    kredensial[u] = p;
  }

  let tokenAdmin = null;
  let tokenSales = null;

  console.log('\n--- Router & kesehatan ---');

  uji('ping berhasil tanpa token', () => {
    const r = panggil(konteks, 'ping', {});
    harus(r.ok, 'ping harus berhasil');
    harusSama(r.data.service, 'AZAMA API', 'nama layanan');
  });

  uji('action tak dikenal ditolak dengan UNKNOWN_ACTION', () => {
    const r = panggil(konteks, 'sales.hapusSemua', {});
    harus(!r.ok, 'harus gagal');
    harusSama(r.error.code, 'UNKNOWN_ACTION', 'kode error');
  });

  uji('action yang belum dibangun tidak diam-diam lolos', () => {
    // Rute Fase 2 ke atas belum ada. Yang penting: ditolak sebagai action
    // tak dikenal, bukan gagal dengan error internal yang membingungkan.
    ['payment.create', 'receivable.aging', 'gallon.balance',
     'production.create', 'expense.create', 'user.list', 'stock.current']
      .forEach((aksi) => {
        const r = panggil(konteks, aksi, {}, tokenAdmin);
        harusSama(r.error.code, 'UNKNOWN_ACTION', `${aksi} harus UNKNOWN_ACTION`);
      });
  });

  uji('badan permintaan kosong ditolak rapi', () => {
    const doPost = vm.runInContext('doPost', konteks);
    const r = JSON.parse(doPost({}).getContent());
    harus(!r.ok, 'harus gagal');
    harusSama(r.error.code, 'BAD_REQUEST', 'kode error');
  });

  uji('JSON rusak ditolak tanpa membocorkan stack', () => {
    const r = JSON.parse(panggilDoPost(konteks, '{bukan json'));
    harus(!r.ok, 'harus gagal');
    harusSama(r.error.code, 'BAD_REQUEST', 'kode error');
    harus(!/at |\.gs:/.test(r.error.message), 'pesan tidak boleh memuat stack trace');
  });

  console.log('\n--- Autentikasi ---');

  uji('login dengan password benar mengembalikan token', () => {
    const r = panggil(konteks, 'auth.login',
      { username: 'admin', password: kredensial.admin });
    harus(r.ok, `login gagal: ${r.ok ? '' : r.error.message}`);
    harus(r.data.token && r.data.token.includes('.'), 'token harus berbentuk a.b');
    harusSama(r.data.user.role, 'admin', 'role');
    tokenAdmin = r.data.token;
  });

  uji('login sales berhasil dan membawa sales_person_name', () => {
    const r = panggil(konteks, 'auth.login',
      { username: 'zhulham', password: kredensial.zhulham });
    harus(r.ok, 'login sales gagal');
    harusSama(r.data.user.sales_person_name, 'Zhulham', 'sales_person_name');
    tokenSales = r.data.token;
  });

  uji('username tidak peka huruf besar-kecil', () => {
    const r = panggil(konteks, 'auth.login',
      { username: 'ADMIN', password: kredensial.admin });
    harus(r.ok, 'login dengan huruf besar harus tetap berhasil');
  });

  uji('password salah ditolak', () => {
    const r = panggil(konteks, 'auth.login',
      { username: 'admin', password: 'salah-total' });
    harus(!r.ok, 'harus gagal');
    harusSama(r.error.code, 'UNAUTHORIZED', 'kode error');
  });

  uji('pesan gagal login tidak membocorkan username mana yang nyata', () => {
    const a = panggil(konteks, 'auth.login', { username: 'admin', password: 'x' });
    const b = panggil(konteks, 'auth.login', { username: 'hantu', password: 'x' });
    harusSama(a.error.message, b.error.message, 'pesan harus identik');
  });

  console.log('\n--- Token ---');

  uji('auth.me dengan token sah mengembalikan profil', () => {
    const r = panggil(konteks, 'auth.me', {}, tokenAdmin);
    harus(r.ok, 'auth.me gagal');
    harusSama(r.data.username, 'admin', 'username');
  });

  uji('permintaan tanpa token ditolak', () => {
    const r = panggil(konteks, 'auth.me', {});
    harus(!r.ok, 'harus gagal');
    harusSama(r.error.code, 'UNAUTHORIZED', 'kode error');
  });

  uji('token dengan tanda tangan diubah ditolak', () => {
    const r = panggil(konteks, 'auth.me', {}, tokenAdmin.slice(0, -4) + 'dead');
    harus(!r.ok, 'harus gagal');
    harusSama(r.error.code, 'UNAUTHORIZED', 'kode error');
  });

  uji('payload token yang dipalsukan ditolak (naik role jadi admin)', () => {
    // Skenario nyata: user sales membongkar tokennya, mengganti role jadi
    // admin, lalu memakainya lagi. Tanda tangan harus menggagalkan ini.
    const bagian = tokenSales.split('.');
    const isi = JSON.parse(Buffer.from(
      bagian[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    isi.role = 'admin';
    const palsu = Buffer.from(JSON.stringify(isi), 'utf8').toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_') + '.' + bagian[1];

    const r = panggil(konteks, 'auth.me', {}, palsu);
    harus(!r.ok, 'token palsu harus ditolak');
    harusSama(r.error.code, 'UNAUTHORIZED', 'kode error');
  });

  uji('token kedaluwarsa ditolak dengan TOKEN_EXPIRED', () => {
    const buatToken = vm.runInContext('buatToken_', konteks);
    const asli = Date.now;
    Date.now = () => asli() - 9 * 60 * 60 * 1000;   // mundur 9 jam, berlaku 8 jam
    const tokenLama = buatToken({
      user_id: 'x', username: 'admin', role: 'admin', sales_person_name: ''
    });
    Date.now = asli;

    const r = panggil(konteks, 'auth.me', {}, tokenLama);
    harus(!r.ok, 'harus gagal');
    harusSama(r.error.code, 'TOKEN_EXPIRED', 'kode error');
  });

  uji('token dari SECRET_KEY berbeda ditolak', () => {
    // Membuktikan kerahasiaan benar-benar ada di SECRET_KEY, bukan pada
    // ketidaktahuan penyerang soal bentuk tokennya.
    const lain = siapkanKonteks('kunci-lain-yang-juga-panjangnya-lebih-dari-32-kar');
    const hasil = panggil(lain.konteks, 'auth.login',
      { username: 'admin', password: kredensial.admin });
    harus(hasil.ok, 'login di konteks kedua harus berhasil');

    const r = panggil(konteks, 'auth.me', {}, hasil.data.token);
    harus(!r.ok, 'token dari kunci lain harus ditolak');
    harusSama(r.error.code, 'UNAUTHORIZED', 'kode error');
  });

  console.log('\n--- Hak akses ---');

  uji('admin boleh membuka system.diagnostics', () => {
    const r = panggil(konteks, 'system.diagnostics', {}, tokenAdmin);
    harus(r.ok, 'admin harus boleh');
    harusSama(r.data.jumlah_baris.sales_orders, 111, 'jumlah sales_orders');
    harusSama(r.data.jumlah_baris.customers, 21, 'jumlah customers');
    harusSama(r.data.total_omzet_tercatat, 49020000, 'total omzet');
  });

  uji('sales ditolak membuka system.diagnostics', () => {
    const r = panggil(konteks, 'system.diagnostics', {}, tokenSales);
    harus(!r.ok, 'sales harus ditolak');
    harusSama(r.error.code, 'FORBIDDEN', 'kode error');
  });

  console.log('\n--- Integritas data hasil migrasi ---');

  const bacaTabel = vm.runInContext('bacaTabel', konteks);
  const keAngka = vm.runInContext('keAngka_', konteks);

  uji('seluruh 15 tab terbaca dengan header sesuai skema', () => {
    const skema = vm.runInContext('SKEMA', konteks);
    harusSama(Object.keys(skema).length, 15, 'jumlah tab di skema');
    for (const nama of Object.keys(skema)) {
      const baris = bacaTabel(nama);
      if (baris.length) {
        for (const kolom of skema[nama].header) {
          harus(kolom in baris[0], `kolom "${kolom}" hilang di tab ${nama}`);
        }
      }
    }
  });

  uji('subtotal tiap order sama dengan jumlah line_total itemnya', () => {
    const perOrder = {};
    bacaTabel('sales_order_items').forEach(i => {
      perOrder[i.order_id] = (perOrder[i.order_id] || 0) + keAngka(i.line_total);
    });
    const beda = bacaTabel('sales_orders')
      .filter(o => keAngka(o.subtotal) !== (perOrder[o.order_id] || 0));
    harusSama(beda.length, 0,
      `order dengan subtotal tidak cocok: ${beda.map(o => o.invoice_no).join(', ')}`);
  });

  uji('total omzet sama dengan angka di DASHBOARD Excel lama', () => {
    const total = bacaTabel('sales_orders')
      .reduce((s, o) => s + keAngka(o.subtotal), 0);
    harusSama(total, 49020000, 'total omzet');
  });

  uji('setiap item menunjuk produk yang ada di master', () => {
    const kode = new Set(bacaTabel('products').map(p => p.code));
    const yatim = bacaTabel('sales_order_items').filter(i => !kode.has(i.product_code));
    harusSama(yatim.length, 0, 'item menunjuk produk yang tidak ada');
  });

  uji('setiap order menunjuk customer yang ada di master', () => {
    const kode = new Set(bacaTabel('customers').map(c => c.code));
    const yatim = bacaTabel('sales_orders').filter(o => !kode.has(o.customer_code));
    harusSama(yatim.length, 0, 'order menunjuk customer yang tidak ada');
  });

  uji('nomor invoice tidak ada yang kembar', () => {
    const nomor = bacaTabel('sales_orders').map(o => o.invoice_no);
    harusSama(new Set(nomor).size, nomor.length, 'ada invoice_no kembar');
  });

  uji('due_date sesuai tempo pembayaran customer', () => {
    const tempo = {};
    bacaTabel('customers').forEach(c => { tempo[c.code] = Number(c.payment_term_days); });
    const salah = bacaTabel('sales_orders').filter(o => {
      const selisih = (new Date(o.due_date) - new Date(o.order_date)) / 86400000;
      return Math.round(selisih) !== tempo[o.customer_code];
    });
    harusSama(salah.length, 0,
      `due_date tidak sesuai: ${salah.slice(0, 3).map(o => o.invoice_no).join(', ')}`);
  });

  uji('setiap produk punya baris stok pembuka', () => {
    const pembuka = new Set(bacaTabel('stock_movements')
      .filter(m => m.movement_type === 'opening').map(m => m.item_code));
    const kurang = bacaTabel('products').filter(p => !pembuka.has(p.code));
    harusSama(kurang.length, 0,
      `produk tanpa stok pembuka: ${kurang.map(p => p.code).join(', ')}`);
  });

  uji('harga khusus menunjuk customer dan produk yang ada', () => {
    const kodeCust = new Set(bacaTabel('customers').map(c => c.code));
    const kodeProd = new Set(bacaTabel('products').map(p => p.code));
    const rusak = bacaTabel('customer_prices').filter(
      h => !kodeCust.has(h.customer_code) || !kodeProd.has(h.product_code));
    harusSama(rusak.length, 0, 'ada harga khusus yang menunjuk data tidak ada');
  });

  uji('ledger galon kosong — riwayat lama sengaja tidak dibangkitkan', () => {
    // Galon dari transaksi 2024-2025 secara fisik sudah ditukar berkali-kali.
    // Membangkitkan gallon_out untuk seluruh riwayat akan memunculkan saldo
    // ribuan galon yang tidak pernah ada.
    harusSama(bacaTabel('gallon_ledger').length, 0, 'gallon_ledger harus kosong');
  });

  console.log('\n--- Penulisan data ---');

  uji('ganti password berhasil, lalu password lama tidak berlaku', () => {
    const t = panggil(konteks, 'auth.login',
      { username: 'produksi', password: kredensial.produksi }).data.token;
    const r = panggil(konteks, 'auth.changePassword',
      { password_lama: kredensial.produksi, password_baru: 'PasswordBaru123' }, t);
    harus(r.ok, `ganti password gagal: ${r.ok ? '' : r.error.message}`);

    const lama = panggil(konteks, 'auth.login',
      { username: 'produksi', password: kredensial.produksi });
    harus(!lama.ok, 'password lama harus sudah ditolak');

    const baru = panggil(konteks, 'auth.login',
      { username: 'produksi', password: 'PasswordBaru123' });
    harus(baru.ok, 'password baru harus diterima');
  });

  uji('password baru yang terlalu pendek ditolak', () => {
    const t = panggil(konteks, 'auth.login',
      { username: 'abah', password: kredensial.abah }).data.token;
    const r = panggil(konteks, 'auth.changePassword',
      { password_lama: kredensial.abah, password_baru: 'abc' }, t);
    harus(!r.ok, 'harus ditolak');
    harusSama(r.error.code, 'BAD_REQUEST', 'kode error');
  });

  uji('setiap login tercatat di audit_log', () => {
    const log = bacaTabel('audit_log').filter(l => l.action === 'auth.login');
    harus(log.length > 0, 'audit_log kosong padahal sudah banyak login');
    harus(log.some(l => String(l.result).startsWith('GAGAL')),
      'percobaan login yang gagal juga harus tercatat');
  });

  uji('id yang dibuat berurut dan tidak menabrak id hasil migrasi', () => {
    const idBerikutnya = vm.runInContext('idBerikutnya_', konteks);
    const jumlahOrder = bacaTabel('sales_orders').length;
    harusSama(idBerikutnya('sales_orders', 'order_id', 'ORD'),
      'ORD' + String(jumlahOrder + 1).padStart(5, '0'), 'id order berikutnya');
  });

  console.log('\n--- Master (Fase 1) ---');

  uji('daftar produk memuat saldo mutasi hasil agregasi, bukan kolom tersimpan', () => {
    const r = panggil(konteks, 'master.products.list', {}, tokenAdmin);
    harus(r.ok, 'gagal ambil produk');
    harusSama(r.data.jumlah, 5, 'jumlah produk aktif');

    const gd19 = r.data.daftar.find(p => p.code === 'GD19');
    harusSama(gd19.saldo_mutasi, 50, 'saldo GD19 dari stock_movements');
    harusSama(gd19.margin, 3000, 'margin GD19');
    // Tidak ada lagi penanda stok menipis — model bisnisnya pre-order.
    harusSama(gd19.stok_menipis, undefined, 'penanda alert stok harus sudah hilang');
  });

  uji('admin melihat seluruh 21 customer', () => {
    const r = panggil(konteks, 'master.customers.list', {}, tokenAdmin);
    harusSama(r.data.jumlah, 21, 'jumlah customer');
  });

  uji('sales hanya melihat customer miliknya sendiri', () => {
    const r = panggil(konteks, 'master.customers.list', {}, tokenSales);
    harus(r.ok, 'gagal ambil customer');
    const bukanMiliknya = r.data.daftar.filter(c => c.sales_person !== 'Zhulham');
    harusSama(bukanMiliknya.length, 0,
      `Zhulham melihat customer milik: ${bukanMiliknya.map(c => c.sales_person).join(', ')}`);
    harus(r.data.jumlah > 0 && r.data.jumlah < 21,
      `Zhulham harus melihat sebagian, dapat ${r.data.jumlah} dari 21`);
  });

  uji('invoice berstatus lunas tidak dihitung sebagai piutang', () => {
    // Seluruh 111 invoice historis ditandai lunas saat migrasi, tapi tabel
    // payments kosong. Tanpa penanganan khusus, selisihnya membuat setiap
    // customer lama terlihat menunggak sebesar seluruh transaksinya.
    const c = panggil(konteks, 'master.customers.list', {}, tokenAdmin);
    const menunggak = c.data.daftar.filter((x) => x.piutang > 0);
    harusSama(menunggak.length, 0,
      `customer terlihat menunggak: ${menunggak.map((x) => x.code).join(', ')}`);

    const s = panggil(konteks, 'sales.list', {}, tokenAdmin);
    harusSama(s.data.ringkasan.belum_lunas, 0, 'total belum tertagih');
    harusSama(s.data.ringkasan.nilai, 49020000, 'nilai penjualan tetap utuh');
  });

  uji('sales ditolak mengubah master produk', () => {
    const r = panggil(konteks, 'master.products.upsert',
      { code: 'GD19', name: 'Diubah', price: 99000 }, tokenSales);
    harusSama(r.error.code, 'FORBIDDEN', 'kode error');
  });

  uji('HPP di atas harga jual ditolak', () => {
    const r = panggil(konteks, 'master.products.upsert',
      { code: 'GD19', name: 'Air Demineral', price: 15000, cogs: 20000 }, tokenAdmin);
    harus(!r.ok, 'harus ditolak');
    harusSama(r.error.code, 'BAD_REQUEST', 'kode error');
  });

  console.log('\n--- Penjualan (Fase 1) ---');

  let orderBaru = null;

  uji('penjualan tercipta dengan invoice, tempo, dan subtotal yang benar', () => {
    const r = panggil(konteks, 'sales.create', {
      customer_code: '01C25BLL',
      items: [{ product_code: 'GD19', qty: 10 }, { product_code: 'GD12', qty: 5 }],
    }, tokenAdmin);
    harus(r.ok, `gagal: ${r.ok ? '' : r.error.message}`);

    orderBaru = r.data;
    harus(/^INV\d{7}$/.test(r.data.invoice_no),
      `format invoice salah: ${r.data.invoice_no}`);
    harusSama(r.data.subtotal, 10 * 15000 + 5 * 12000, 'subtotal');
    harusSama(r.data.status, 'unpaid', 'status awal');
    harusSama(r.data.tempo_hari, 30, 'tempo IOU 2020');
    harusSama(selisihHariUji(r.data.order_date, r.data.due_date), 30, 'jarak jatuh tempo');
  });

  uji('mutasi barang keluar tetap dicatat meski stok tidak ditampilkan', () => {
    // Buku besar tetap diisi supaya riwayat barang keluar utuh, dan supaya
    // batch produksi di Fase 4 punya lawan hitung. Yang dihilangkan hanya
    // penyajiannya sebagai "stok tersedia".
    const r = panggil(konteks, 'master.products.list', {}, tokenAdmin);
    harusSama(r.data.daftar.find(p => p.code === 'GD19').saldo_mutasi, 40, 'saldo GD19');
    harusSama(r.data.daftar.find(p => p.code === 'GD12').saldo_mutasi, 15, 'saldo GD12');
  });

  uji('galon tercatat keluar ke customer', () => {
    const bacaT = vm.runInContext('bacaTabel', konteks);
    const baris = bacaT('gallon_ledger')
      .filter(g => g.ref_id === orderBaru.order_id);
    harusSama(baris.length, 2, 'dua produk galon, dua baris ledger');
    harusSama(baris.reduce((s, g) => s + Number(g.qty), 0), 15, 'total galon keluar');
    harus(baris.every(g => g.movement_type === 'gallon_out'), 'jenis mutasi');
  });

  uji('harga khusus Pabrik Bentoel dipakai otomatis', () => {
    // 13C26SGS punya kesepakatan GD05 seharga 20.000, jauh di atas harga
    // master 7.500. Ini disengaja, bukan salah kode produk.
    const r = panggil(konteks, 'sales.create', {
      customer_code: '13C26SGS',
      items: [{ product_code: 'GD05', qty: 4 }],
    }, tokenAdmin);
    harus(r.ok, `gagal: ${r.ok ? '' : r.error.message}`);
    harusSama(r.data.items[0].unit_price, 20000, 'harga khusus terpakai');
    harusSama(r.data.items[0].harga_khusus, true, 'ditandai sebagai harga khusus');
    harusSama(r.data.subtotal, 80000, 'subtotal memakai harga khusus');
  });

  uji('nomor invoice berurut dan tidak kembar', () => {
    const bacaT = vm.runInContext('bacaTabel', konteks);
    const nomor = bacaT('sales_orders').map(o => o.invoice_no);
    harusSama(new Set(nomor).size, nomor.length, 'ada invoice kembar');
  });

  uji('harga tidak bisa disetir dari frontend', () => {
    // Payload menyertakan unit_price yang mencurigakan. Server harus
    // mengabaikannya dan memakai harga master.
    const r = panggil(konteks, 'sales.create', {
      customer_code: '01C25BLL',
      items: [{ product_code: 'GD19', qty: 1, unit_price: 1, line_total: 1 }],
    }, tokenAdmin);
    harus(r.ok, 'penjualan harus tetap dibuat');
    harusSama(r.data.items[0].unit_price, 15000, 'harga dari master, bukan payload');
    harusSama(r.data.subtotal, 15000, 'subtotal dihitung server');
  });

  uji('penjualan tanpa item ditolak', () => {
    const r = panggil(konteks, 'sales.create',
      { customer_code: '01C25BLL', items: [] }, tokenAdmin);
    harusSama(r.error.code, 'BAD_REQUEST', 'kode error');
  });

  uji('jumlah nol atau negatif ditolak', () => {
    const r = panggil(konteks, 'sales.create', {
      customer_code: '01C25BLL',
      items: [{ product_code: 'GD19', qty: 0 }],
    }, tokenAdmin);
    harusSama(r.error.code, 'BAD_REQUEST', 'kode error');
  });

  uji('produk tidak dikenal ditolak', () => {
    const r = panggil(konteks, 'sales.create', {
      customer_code: '01C25BLL',
      items: [{ product_code: 'HANTU', qty: 1 }],
    }, tokenAdmin);
    harusSama(r.error.code, 'NOT_FOUND', 'kode error');
  });

  uji('tanggal di masa depan ditolak', () => {
    const r = panggil(konteks, 'sales.create', {
      customer_code: '01C25BLL',
      order_date: '2099-01-01',
      items: [{ product_code: 'GD19', qty: 1 }],
    }, tokenAdmin);
    harusSama(r.error.code, 'BAD_REQUEST', 'kode error');
  });

  uji('penjualan gagal tidak meninggalkan baris separuh jadi', () => {
    const bacaT = vm.runInContext('bacaTabel', konteks);
    const sebelum = {
      order: bacaT('sales_orders').length,
      item: bacaT('sales_order_items').length,
      mutasi: bacaT('stock_movements').length,
      galon: bacaT('gallon_ledger').length,
    };
    // Baris kedua tidak sah, jadi seluruh transaksi harus ditolak utuh.
    panggil(konteks, 'sales.create', {
      customer_code: '01C25BLL',
      items: [{ product_code: 'GD19', qty: 5 }, { product_code: 'HANTU', qty: 1 }],
    }, tokenAdmin);

    harusSama(bacaT('sales_orders').length, sebelum.order, 'sales_orders bertambah');
    harusSama(bacaT('sales_order_items').length, sebelum.item, 'items bertambah');
    harusSama(bacaT('stock_movements').length, sebelum.mutasi, 'stock_movements bertambah');
    harusSama(bacaT('gallon_ledger').length, sebelum.galon, 'gallon_ledger bertambah');
  });

  uji('sales tidak bisa menjual atas nama customer orang lain', () => {
    // 02C25MLG (Lafayette) adalah customer Abah, bukan Zhulham.
    const r = panggil(konteks, 'sales.create', {
      customer_code: '02C25MLG',
      items: [{ product_code: 'GD19', qty: 1 }],
    }, tokenSales);
    harusSama(r.error.code, 'FORBIDDEN', 'kode error');
  });

  uji('daftar penjualan milik sales hanya berisi customer-nya', () => {
    const r = panggil(konteks, 'sales.list', {}, tokenSales);
    harus(r.ok, 'gagal ambil daftar');
    const asing = r.data.daftar.filter(o => o.sales_person !== 'Zhulham');
    harusSama(asing.length, 0,
      `bocor: ${asing.slice(0, 3).map(o => o.invoice_no).join(', ')}`);
  });

  uji('sales.get menolak invoice milik sales lain', () => {
    const semua = panggil(konteks, 'sales.list', {}, tokenAdmin).data.daftar;
    const punyaAbah = semua.find(o => o.sales_person === 'Abah');
    const r = panggil(konteks, 'sales.get', { order_id: punyaAbah.order_id }, tokenSales);
    harusSama(r.error.code, 'FORBIDDEN', 'kode error');
  });

  uji('sales.get mengembalikan item lengkap dengan margin', () => {
    const r = panggil(konteks, 'sales.get', { order_id: orderBaru.order_id }, tokenAdmin);
    harus(r.ok, 'gagal ambil detail');
    harusSama(r.data.items.length, 2, 'jumlah item');
    harusSama(r.data.sisa, r.data.subtotal, 'belum ada pembayaran');
    harusSama(r.data.items[0].margin, 10 * (15000 - 12000), 'margin baris pertama');
    harusSama(r.data.hpp_lengkap, true, 'HPP kedua produk terisi');
  });

  console.log('\n--- Pembatalan ---');

  uji('pembatalan tanpa alasan ditolak', () => {
    const r = panggil(konteks, 'sales.cancel',
      { order_id: orderBaru.order_id }, tokenAdmin);
    harusSama(r.error.code, 'BAD_REQUEST', 'kode error');
  });

  uji('pembatalan mengembalikan stok dan galon', () => {
    const r = panggil(konteks, 'sales.cancel',
      { order_id: orderBaru.order_id, alasan: 'Salah input customer' }, tokenAdmin);
    harus(r.ok, `gagal: ${r.ok ? '' : r.error.message}`);
    harusSama(r.data.galon_dikembalikan, 15, 'galon kembali');

    const produk = panggil(konteks, 'master.products.list', {}, tokenAdmin).data.daftar;
    // GD19: 50 awal, -10 order ini, -1 uji harga, +10 pembatalan = 49
    harusSama(produk.find(p => p.code === 'GD19').saldo_mutasi, 49, 'saldo GD19 setelah batal');
    harusSama(produk.find(p => p.code === 'GD12').saldo_mutasi, 20, 'saldo GD12 kembali penuh');
  });

  uji('baris asli tidak dihapus, hanya ditambah penyeimbang', () => {
    const bacaT = vm.runInContext('bacaTabel', konteks);
    const jejak = bacaT('stock_movements').filter(m => m.ref_id === orderBaru.order_id);
    harus(jejak.some(m => m.movement_type === 'sale_out'),
      'baris penjualan asli harus tetap ada');
    harus(jejak.some(m => m.movement_type === 'adjustment'),
      'baris penyeimbang harus ada');
  });

  uji('pembatalan kedua kali ditolak', () => {
    const r = panggil(konteks, 'sales.cancel',
      { order_id: orderBaru.order_id, alasan: 'coba lagi' }, tokenAdmin);
    harusSama(r.error.code, 'BAD_REQUEST', 'kode error');
  });

  uji('invoice batal tidak ikut dihitung dalam nilai penjualan', () => {
    const r = panggil(konteks, 'sales.list', {}, tokenAdmin);
    const batal = r.data.daftar.find(o => o.order_id === orderBaru.order_id);
    harusSama(batal.status, 'cancelled', 'status');
    harusSama(batal.terlambat_hari, 0, 'invoice batal tidak boleh terlihat menunggak');
  });

  uji('seluruh aksi tulis tercatat di audit_log', () => {
    const bacaT = vm.runInContext('bacaTabel', konteks);
    const aksi = new Set(bacaT('audit_log').map(l => l.action));
    ['auth.login', 'sales.create', 'sales.cancel'].forEach(a => {
      harus(aksi.has(a), `aksi ${a} tidak tercatat`);
    });
  });

  console.log('\n--- Dashboard (Fase 2) ---');

  uji('ringkasan admin memuat omzet, margin, dan tren bulanan', () => {
    const r = panggil(konteks, 'dashboard.summary', { bulan: 12 }, tokenAdmin);
    harus(r.ok, `gagal: ${r.ok ? '' : r.error.message}`);
    harusSama(r.data.dashboard_penuh, true, 'admin dapat dashboard penuh');
    harusSama(r.data.bulanan.length, 12, 'jumlah titik grafik');
    harus(r.data.ringkasan.margin_total !== null, 'margin harus ada untuk admin');
    harus(r.data.produk_teratas.length > 0, 'produk terlaris kosong');
    harus(r.data.customer_teratas.length > 0, 'customer teratas kosong');
  });

  uji('omzet dashboard cocok dengan total daftar penjualan', () => {
    const d = panggil(konteks, 'dashboard.summary', {}, tokenAdmin).data;
    const s = panggil(konteks, 'sales.list', {}, tokenAdmin).data;
    harusSama(d.ringkasan.omzet_total, s.ringkasan.nilai,
      'dua sumber angka omzet harus sama');
  });

  uji('invoice dibatalkan tidak masuk omzet', () => {
    const d = panggil(konteks, 'dashboard.summary', {}, tokenAdmin).data;
    harus(d.ringkasan.invoice_dibatalkan > 0,
      'uji pembatalan sebelumnya harus tercermin di sini');
    const bacaT = vm.runInContext('bacaTabel', konteks);
    const semua = bacaT('sales_orders')
      .reduce((s, o) => s + (String(o.status).toLowerCase() === 'cancelled'
        ? 0 : keAngka(o.subtotal)), 0);
    harusSama(d.ringkasan.omzet_total, semua, 'omzet tanpa yang dibatalkan');
  });

  uji('sales menerima dashboard terbatas tanpa margin', () => {
    const r = panggil(konteks, 'dashboard.summary', {}, tokenSales);
    harus(r.ok, 'sales harus boleh membuka dashboard');
    harusSama(r.data.dashboard_penuh, false, 'bukan dashboard penuh');
    harusSama(r.data.ringkasan.margin_total, null, 'margin harus disembunyikan');
    harusSama(r.data.ringkasan.hpp_total, null, 'HPP harus disembunyikan');
    harus(r.data.produk_teratas.every((p) => p.margin === null),
      'margin per produk juga harus disembunyikan');
  });

  uji('omzet sales lebih kecil dari omzet admin', () => {
    const a = panggil(konteks, 'dashboard.summary', {}, tokenAdmin).data;
    const s = panggil(konteks, 'dashboard.summary', {}, tokenSales).data;
    harus(s.ringkasan.omzet_total < a.ringkasan.omzet_total,
      'sales tidak boleh melihat omzet seluruh perusahaan');
    harus(s.ringkasan.omzet_total > 0, 'sales harus melihat omzetnya sendiri');
  });

  uji('margin ditandai tidak bisa dipercaya bila ada HPP nol', () => {
    const d = panggil(konteks, 'dashboard.summary', {}, tokenAdmin).data;
    // GTDS019 dan produk lain punya HPP terisi, tapi invoice historis bisa
    // menyimpan unit_cogs nol. Yang diuji: penandanya konsisten dengan data.
    const bacaT = vm.runInContext('bacaTabel', konteks);
    const adaNol = bacaT('sales_order_items').some((it) => keAngka(it.unit_cogs) <= 0);
    harusSama(d.ringkasan.margin_bisa_dipercaya, !adaNol,
      'penanda margin harus mencerminkan ada tidaknya HPP nol');
  });

  uji('saldo galon beredar hanya menghitung yang positif', () => {
    const d = panggil(konteks, 'dashboard.summary', {}, tokenAdmin).data;
    harus(d.galon.customer.every((c) => c.saldo > 0),
      'saldo nol atau minus tidak boleh masuk daftar');
    harusSama(
      d.galon.customer.reduce((s, c) => s + c.saldo, 0) <= d.galon.total_beredar,
      true, 'total harus mencakup seluruh customer');
  });

  console.log('\n--- Pemeriksa integritas ---');

  uji('data hasil migrasi lolos tanpa temuan parah', () => {
    const r = panggil(konteks, 'system.integrity', {}, tokenAdmin);
    harus(r.ok, `gagal: ${r.ok ? '' : r.error.message}`);
    harusSama(r.data.jumlah.parah, 0,
      `temuan parah: ${r.data.temuan.filter((t) => t.tingkat === 'parah')
        .map((t) => t.kode).join(', ')}`);
  });

  uji('sales ditolak menjalankan pemeriksa integritas', () => {
    const r = panggil(konteks, 'system.integrity', {}, tokenSales);
    harusSama(r.error.code, 'FORBIDDEN', 'kode error');
  });

  uji('penjualan yang disisipkan manual terdeteksi', () => {
    // Tiru persis apa yang terjadi kalau baris ditambahkan langsung di
    // spreadsheet: order dan item ada, mutasi barang keluar tidak.
    const tambah = vm.runInContext('tambahBaris', konteks);
    tambah('sales_orders', [{
      order_id: 'ORD90001', invoice_no: 'INV2608900', order_date: '2026-08-05',
      customer_code: '01C25BLL', due_date: '2026-09-04', status: 'unpaid',
      subtotal: 150000, created_by: 'disisipkan_manual', created_at: '2026-08-05 10:00:00',
    }]);
    tambah('sales_order_items', [{
      item_id: 'ITM90001', order_id: 'ORD90001', product_code: 'GD19',
      qty: 10, unit_price: 15000, unit_cogs: 12000, line_total: 150000,
    }]);

    const r = panggil(konteks, 'system.integrity', {}, tokenAdmin);
    const temuan = r.data.temuan.find((t) => t.kode === 'DIBUAT_DI_LUAR_SISTEM');
    harus(temuan, 'penyisipan manual harus terdeteksi');
    harus(temuan.contoh.some((c) => c.includes('INV2608900')),
      `invoice yang disisipkan tidak disebut: ${temuan.contoh.join(', ')}`);
  });

  uji('perbaikan otomatis membuatkan mutasi yang hilang', () => {
    const r = panggil(konteks, 'system.integrity', { perbaiki_stok: true }, tokenAdmin);
    harus(r.ok, 'perbaikan gagal');
    harus(r.data.diperbaiki, 'tidak ada laporan perbaikan');
    harus(r.data.diperbaiki.invoice_diperbaiki.includes('INV2608900'),
      'invoice sisipan tidak ikut diperbaiki');

    // Setelah diperbaiki, temuan yang sama tidak boleh muncul lagi.
    const ulang = panggil(konteks, 'system.integrity', {}, tokenAdmin);
    harus(!ulang.data.temuan.some((t) => t.kode === 'DIBUAT_DI_LUAR_SISTEM'),
      'temuan masih muncul setelah diperbaiki');
  });

  uji('mutasi perbaikan memakai tanggal penjualannya, bukan hari ini', () => {
    const bacaT = vm.runInContext('bacaTabel', konteks);
    const m = bacaT('stock_movements').filter((x) => x.ref_id === 'ORD90001');
    harusSama(m.length, 1, 'jumlah mutasi perbaikan');
    harusSama(String(m[0].moved_at), '2026-08-05',
      'tanggal mutasi harus mengikuti tanggal penjualan agar laporan periode benar');
    harusSama(keAngka(m[0].qty), -10, 'arah mutasi harus keluar');
  });

  uji('ID kembar terdeteksi', () => {
    const tambah = vm.runInContext('tambahBaris', konteks);
    tambah('sales_orders', [{
      order_id: 'ORD90001', invoice_no: 'INV2608901', order_date: '2026-08-05',
      customer_code: '01C25BLL', due_date: '2026-09-04', status: 'unpaid',
      subtotal: 1000, created_by: 'disisipkan_manual', created_at: '2026-08-05 10:00:00',
    }]);
    const r = panggil(konteks, 'system.integrity', {}, tokenAdmin);
    harus(r.data.temuan.some((t) => t.kode === 'ID_KEMBAR'), 'ID kembar tidak terdeteksi');
    harusSama(r.data.jumlah.parah > 0, true, 'harus dinilai parah');
  });

  uji('subtotal yang tidak cocok dengan itemnya terdeteksi', () => {
    const r = panggil(konteks, 'system.integrity', {}, tokenAdmin);
    const t = r.data.temuan.find((x) => x.kode === 'SUBTOTAL_TIDAK_COCOK');
    harus(t, 'selisih subtotal tidak terdeteksi');
    harus(t.contoh.some((c) => c.includes('INV2608901')), 'invoice janggal tidak disebut');
  });

  uji('stok minus tidak dilaporkan sebagai masalah', () => {
    // Pada model pre-order, saldo minus adalah kondisi normal sampai batch
    // produksi dicatat di Fase 4. Melaporkannya akan menyalakan peringatan
    // untuk setiap produk setiap hari.
    const r = panggil(konteks, 'system.integrity', {}, tokenAdmin);
    harus(!r.data.temuan.some((t) => t.kode === 'STOK_NEGATIF'),
      'stok minus tidak boleh jadi temuan pada model pre-order');
  });

  // -------------------------------------------------------------------------

  console.log('\n' + '='.repeat(72));
  console.log(`HASIL: ${lulus} lulus, ${gagal} gagal`);
  if (gagal) {
    console.log('\nYang gagal:');
    kegagalan.forEach(k => console.log('  - ' + k));
  } else {
    console.log('\nBackend sehat. Aman di-push ke Apps Script.');
  }
  console.log('='.repeat(72));
  process.exit(gagal ? 1 : 0);
}

main();
