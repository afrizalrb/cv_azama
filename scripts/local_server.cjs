/**
 * local_server.cjs — jalankan backend Apps Script sebagai server HTTP lokal.
 *
 *     node scripts/local_server.cjs
 *
 * Menyajikan berkas .gs yang sama persis dengan yang nanti diunggah ke Google,
 * lewat http://localhost:8787. Arahkan frontend ke sini dengan mengisi
 * frontend/.env.local:
 *
 *     VITE_API_URL=http://localhost:8787
 *
 * Gunanya: seluruh rantai — frontend, token, logika bisnis, data — bisa
 * dikembangkan dan diuji tanpa akun Google, tanpa clasp, dan tanpa menunggu
 * siklus push-versi-deploy yang lambat itu.
 *
 * Keadaan data disimpan di data/local_state/ (terpisah dari hasil migrasi
 * yang asli, dan sudah masuk .gitignore). Hapus folder itu untuk kembali
 * ke data awal.
 *
 * BUKAN untuk produksi. Tidak ada TLS, tidak ada pembatasan asal permintaan,
 * dan SECRET_KEY-nya tertulis di berkas ini.
 */

'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const {
  AKAR, DIR_CSV, muatSpreadsheet, simpanSpreadsheet, bangunKonteks,
  muatKodeGs, panggilDoPost,
} = require('./lib/harness.cjs');

const PORT = Number(process.env.PORT || 8787);
const DIR_STATE = path.join(AKAR, 'data', 'local_state');

// Kunci tetap supaya token tetap sah setelah server dijalankan ulang.
// Aman justru karena jelas-jelas bukan rahasia: ini hanya untuk lokal.
const SECRET_LOKAL = 'kunci-pengembangan-lokal-bukan-untuk-produksi-32+';


function siapkanState() {
  if (!fs.existsSync(DIR_STATE)) {
    if (!fs.existsSync(DIR_CSV)) {
      console.error(`\nCSV hasil migrasi belum ada di ${DIR_CSV}`);
      console.error('Jalankan dulu: py scripts/migrate_excel.py\n');
      process.exit(1);
    }
    fs.mkdirSync(DIR_STATE, { recursive: true });
    for (const berkas of fs.readdirSync(DIR_CSV).filter(f => f.endsWith('.csv'))) {
      fs.copyFileSync(path.join(DIR_CSV, berkas), path.join(DIR_STATE, berkas));
    }
    console.log(`Data awal disalin dari ${path.relative(AKAR, DIR_CSV)} ke ` +
                `${path.relative(AKAR, DIR_STATE)}`);
  }
}


function main() {
  siapkanState();

  const ss = muatSpreadsheet(DIR_STATE);
  const konteks = bangunKonteks(ss, {
    SPREADSHEET_ID: 'ID_LOKAL',
    SECRET_KEY: SECRET_LOKAL,
  });
  muatKodeGs(konteks);

  const server = http.createServer((req, res) => {
    // Apps Script yang di-deploy "Anyone" memang mengizinkan asal mana pun.
    // Ditiru di sini supaya perilaku CORS-nya sama dan tidak ada kejutan
    // saat berpindah ke lingkungan asli.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      // Apps Script sesungguhnya TIDAK melayani OPTIONS. Dijawab di sini
      // hanya sebagai jaring pengaman; kalau frontend sampai memicu
      // preflight, itu tanda Content-Type-nya salah dan akan gagal di
      // lingkungan asli. Peringatannya dicetak, bukan disembunyikan.
      console.warn('PERINGATAN  ada permintaan preflight OPTIONS. Apps Script ' +
                   'tidak melayani ini. Pastikan Content-Type: text/plain.');
      res.writeHead(204).end();
      return;
    }

    if (req.method === 'GET') {
      const doGet = require('vm').runInContext('doGet', konteks);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(doGet({}).getContent());
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Gunakan POST.' }
      }));
      return;
    }

    let badan = '';
    req.on('data', c => { badan += c; });
    req.on('end', () => {
      const mulai = Date.now();
      let keluaran;
      try {
        keluaran = panggilDoPost(konteks, badan);
      } catch (e) {
        // Error yang lolos sampai sini berarti ada bug di luar penanganan
        // doPost sendiri. Di lokal, tampilkan lengkap — justru itu gunanya.
        console.error(e);
        keluaran = JSON.stringify({
          ok: false,
          error: { code: 'HARNESS_ERROR', message: e.message }
        });
      }

      let aksi = '?';
      try { aksi = JSON.parse(badan).action || '?'; } catch { /* biarkan */ }

      const hasil = JSON.parse(keluaran);
      const tersimpan = simpanSpreadsheet(ss, DIR_STATE);

      console.log(
        `${hasil.ok ? 'OK   ' : 'GAGAL'} ${aksi.padEnd(24)} ` +
        `${String(Date.now() - mulai).padStart(4)}ms` +
        (tersimpan ? `  (${tersimpan} tab disimpan)` : '') +
        (hasil.ok ? '' : `  ${hasil.error.code}: ${hasil.error.message}`)
      );

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(keluaran);
    });
  });

  server.listen(PORT, () => {
    console.log('');
    console.log('='.repeat(64));
    console.log('  Backend AZAMA — tiruan lokal');
    console.log('='.repeat(64));
    console.log(`  Alamat  : http://localhost:${PORT}`);
    console.log(`  Data    : ${path.relative(AKAR, DIR_STATE)}`);
    console.log(`  Tab     : ${ss.getSheets().length}`);
    console.log('');
    console.log('  Isi frontend/.env.local dengan:');
    console.log(`    VITE_API_URL=http://localhost:${PORT}`);
    console.log('');
    console.log('  Hapus folder data/local_state untuk kembali ke data awal.');
    console.log('  Ctrl+C untuk berhenti.');
    console.log('='.repeat(64));
    console.log('');
  });
}

main();
