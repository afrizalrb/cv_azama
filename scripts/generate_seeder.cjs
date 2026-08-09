/**
 * generate_seeder.cjs — bangkitkan Seed.gs berisi seluruh data hasil migrasi.
 *
 *     node scripts/generate_seeder.cjs
 *
 * Kenapa ada berkas ini:
 *
 * Mengimpor CSV lewat menu File > Import di Google Sheets menuntut tiga
 * pengaturan benar untuk tiap berkas, dan satu di antaranya — "Convert text
 * to numbers, dates, and formulas" — merusak data secara diam-diam kalau
 * salah. Hash password 64 karakter bisa berubah jadi notasi ilmiah, dan
 * tanggal 'YYYY-MM-DD' berubah jadi objek Date. Keduanya tidak bisa
 * dipulihkan tanpa mengulang migrasi.
 *
 * Berkas yang dihasilkan menulis datanya lewat setValues(), yang menyimpan
 * tiap nilai persis seperti yang kita tentukan. Tipe tiap kolom ditentukan
 * dari SKEMA di Sheets.gs, jadi hanya ada satu sumber kebenaran.
 *
 * Keluarannya ditulis ke data/Seed.gs — folder itu sudah masuk .gitignore,
 * karena isinya nama customer, nomor telepon, dan seluruh riwayat omzet.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const {
  AKAR, DIR_CSV, bacaCsv, muatSpreadsheet, bangunKonteks, muatKodeGs,
} = require('./lib/harness.cjs');

const KELUARAN = path.join(AKAR, 'data', 'Seed.gs');


/** Ambil SKEMA langsung dari Sheets.gs supaya definisinya tidak terduplikasi. */
function ambilSkema() {
  const ss = muatSpreadsheet(DIR_CSV);
  const konteks = bangunKonteks(ss, {
    SPREADSHEET_ID: 'x',
    SECRET_KEY: 'y'.repeat(40),
  });
  muatKodeGs(konteks);
  return vm.runInContext('SKEMA', konteks);
}


/**
 * Tentukan tipe satu nilai.
 *
 * Kolom yang terdaftar sebagai `teks` di SKEMA selalu ditulis sebagai string,
 * apa pun isinya. Itu yang menjaga kode customer '01C25BLL', nomor telepon
 * berawalan nol, tanggal ISO, dan hash password tetap utuh.
 *
 * Sisanya ditulis sebagai angka bila memang angka, supaya kolom qty dan harga
 * bisa dijumlahkan dengan formula biasa oleh siapa pun yang membuka
 * spreadsheet secara langsung.
 */
function nilaiUntukSheet(nilai, namaKolom, kolomTeks) {
  if (nilai === '' || nilai === null || nilai === undefined) return '';
  if (kolomTeks.includes(namaKolom)) return String(nilai);
  if (nilai === 'TRUE') return true;
  if (nilai === 'FALSE') return false;
  if (/^-?\d+$/.test(nilai)) return parseInt(nilai, 10);
  if (/^-?\d*\.\d+$/.test(nilai)) return parseFloat(nilai);
  return String(nilai);
}


function main() {
  if (!fs.existsSync(DIR_CSV)) {
    console.error(`\nCSV belum ada di ${DIR_CSV}`);
    console.error('Jalankan dulu: py scripts/migrate_excel.py\n');
    process.exit(1);
  }

  const skema = ambilSkema();
  const data = {};
  const ringkasan = [];

  for (const nama of Object.keys(skema)) {
    const berkas = path.join(DIR_CSV, nama + '.csv');
    if (!fs.existsSync(berkas)) {
      ringkasan.push([nama, 0, 'CSV tidak ada']);
      data[nama] = [];
      continue;
    }

    const semua = bacaCsv(fs.readFileSync(berkas, 'utf8'));
    const header = semua[0].map(h => h.trim());
    const kolomTeks = skema[nama].teks || [];

    // Urutan kolom di CSV dipetakan ulang mengikuti SKEMA, bukan diasumsikan
    // sama. Kalau ada kolom yang tidak dikenal, itu ketahuan di sini.
    const takDikenal = header.filter(h => h && !skema[nama].header.includes(h));
    if (takDikenal.length) {
      console.error(`\n${nama}.csv memuat kolom di luar skema: ${takDikenal.join(', ')}\n`);
      process.exit(1);
    }

    const baris = semua.slice(1).map(r => {
      const objek = {};
      header.forEach((h, i) => { objek[h] = r[i]; });
      return skema[nama].header.map(
        kolom => nilaiUntukSheet(objek[kolom], kolom, kolomTeks));
    });

    data[nama] = baris;
    ringkasan.push([nama, baris.length, '']);
  }

  const isi = bangunBerkasGs(data, skema);
  fs.mkdirSync(path.dirname(KELUARAN), { recursive: true });
  fs.writeFileSync(KELUARAN, isi, 'utf8');

  console.log('Data yang disemai:\n');
  for (const [nama, jumlah, catatan] of ringkasan) {
    console.log(`  ${nama.padEnd(22)} ${String(jumlah).padStart(4)} baris  ${catatan}`);
  }

  const kb = (Buffer.byteLength(isi, 'utf8') / 1024).toFixed(1);
  console.log(`\nDitulis ke ${path.relative(AKAR, KELUARAN)}  (${kb} KB)`);
  console.log('\nLangkah berikutnya:');
  console.log('  1. Buka editor Apps Script, tambah berkas baru bernama "Seed"');
  console.log('  2. Salin seluruh isi data/Seed.gs ke sana, lalu simpan');
  console.log('  3. Jalankan fungsi imporSemuaData()');
  console.log('  4. Jalankan cekIsiData() untuk verifikasi');
  console.log('  5. Hapus berkas Seed dari proyek Apps Script setelah selesai');
  console.log('\nBerkas ini berisi data perusahaan. Folder data/ sudah di-gitignore.');
}


function bangunBerkasGs(data, skema) {
  const bagian = [];

  bagian.push(`/**
 * Seed.gs — DIBANGKITKAN OTOMATIS, JANGAN DIEDIT MANUAL.
 *
 * Dibuat oleh scripts/generate_seeder.cjs pada ${new Date().toISOString()}
 *
 * Berkas ini menulis seluruh data hasil migrasi Excel ke spreadsheet, tanpa
 * melewati dialog File > Import. Setiap nilai ditulis dengan tipe yang sudah
 * ditentukan di SKEMA, sehingga kode customer, nomor telepon, tanggal ISO,
 * dan hash password tidak bisa berubah bentuk secara diam-diam.
 *
 * Cara pakai:
 *   1. Jalankan createAllSheets() lebih dulu — seluruh tab harus sudah ada
 *   2. Jalankan imporSemuaData()
 *   3. Jalankan cekIsiData() untuk verifikasi
 *   4. Hapus berkas ini dari proyek setelah selesai
 *
 * Berkas ini memuat data perusahaan yang sesungguhnya. Jangan pernah
 * di-commit ke repo.
 */

/**
 * Pengaman terhadap penimpaan tidak sengaja.
 *
 * Selama bernilai false, tab yang sudah berisi data akan dilewati, bukan
 * ditimpa. Ubah ke true hanya kalau Anda memang bermaksud mengganti seluruh
 * isi tab dengan data semai.
 */
var TIMPA_DATA_YANG_ADA = false;
`);

  bagian.push('\nfunction imporSemuaData() {');
  bagian.push("  var ss = SpreadsheetApp.openById(prop_('SPREADSHEET_ID'));");
  bagian.push('  var laporan = [];');
  bagian.push('  var data = dataSemai_();\n');
  bagian.push('  for (var nama in data) {');
  bagian.push('    var baris = data[nama];');
  bagian.push('    var sh = ss.getSheetByName(nama);\n');
  bagian.push('    if (!sh) {');
  bagian.push("      laporan.push(padKanan_(nama, 22) + 'DILEWATI — tab belum ada');");
  bagian.push('      continue;');
  bagian.push('    }');
  bagian.push('    if (!baris.length) {');
  bagian.push("      laporan.push(padKanan_(nama, 22) + 'kosong, tidak ada yang disemai');");
  bagian.push('      continue;');
  bagian.push('    }');
  bagian.push('    if (sh.getLastRow() > 1 && !TIMPA_DATA_YANG_ADA) {');
  bagian.push("      laporan.push(padKanan_(nama, 22) + 'DILEWATI — sudah berisi ' +");
  bagian.push("        (sh.getLastRow() - 1) + ' baris. Setel TIMPA_DATA_YANG_ADA = true');");
  bagian.push("      continue;");
  bagian.push('    }\n');
  bagian.push('    // Bersihkan isi lama tanpa menyentuh header di baris 1.');
  bagian.push('    if (sh.getLastRow() > 1) {');
  bagian.push('      sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();');
  bagian.push('    }\n');
  bagian.push('    // Satu setValues() untuk seluruh tab — bukan per baris.');
  bagian.push('    sh.getRange(2, 1, baris.length, baris[0].length).setValues(baris);');
  bagian.push("    laporan.push(padKanan_(nama, 22) + baris.length + ' baris disemai');");
  bagian.push('  }\n');
  bagian.push("  laporan.push('');");
  bagian.push("  laporan.push('Selesai. Jalankan cekIsiData() untuk verifikasi.');");
  bagian.push("  console.log(laporan.join('\\n'));");
  bagian.push("  return laporan.join('\\n');");
  bagian.push('}\n');

  bagian.push('\n/** Data hasil migrasi. Urutan kolom mengikuti SKEMA di Sheets.gs. */');
  bagian.push('function dataSemai_() {');
  bagian.push('  return {');

  const namaTab = Object.keys(skema);
  namaTab.forEach((nama, idx) => {
    const baris = data[nama];
    const koma = idx === namaTab.length - 1 ? '' : ',';

    bagian.push(`    // ${nama} — ${skema[nama].header.join(', ')}`);
    if (!baris.length) {
      bagian.push(`    ${nama}: []${koma}`);
      return;
    }
    bagian.push(`    ${nama}: [`);
    baris.forEach((r, i) => {
      const akhir = i === baris.length - 1 ? '' : ',';
      bagian.push('      ' + JSON.stringify(r) + akhir);
    });
    bagian.push(`    ]${koma}`);
  });

  bagian.push('  };');
  bagian.push('}');

  return bagian.join('\n') + '\n';
}

main();
