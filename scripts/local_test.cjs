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
    const r = panggil(konteks, 'sales.create', {});
    harus(!r.ok, 'harus gagal');
    harusSama(r.error.code, 'UNKNOWN_ACTION', 'kode error');
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

  // -------------------------------------------------------------------------

  console.log('\n' + '='.repeat(72));
  console.log(`HASIL: ${lulus} lulus, ${gagal} gagal`);
  if (gagal) {
    console.log('\nYang gagal:');
    kegagalan.forEach(k => console.log('  - ' + k));
  } else {
    console.log('\nFondasi Fase 0 sehat. Aman dilanjutkan ke deploy Apps Script.');
  }
  console.log('='.repeat(72));
  process.exit(gagal ? 1 : 0);
}

main();
