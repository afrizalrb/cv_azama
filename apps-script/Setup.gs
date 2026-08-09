/**
 * Setup.gs — fungsi sekali jalan, dieksekusi manual dari editor Apps Script.
 *
 * Tidak ada satu pun fungsi di sini yang bisa dipanggil lewat API. Semuanya
 * operasi struktural yang hanya boleh dilakukan pemilik spreadsheet.
 *
 * Urutan pemakaian:
 *   1. cekKonfigurasi()   pastikan Script Properties sudah terisi
 *   2. createAllSheets()  buat seluruh tab beserta header
 *   3. impor CSV hasil migrasi lewat menu File > Import di Google Sheets
 *   4. cekIsiData()       verifikasi hasil impor
 */


/**
 * Periksa Script Properties sebelum apa pun dijalankan.
 *
 * Kesalahan paling sering di tahap awal adalah lupa mengisi SPREADSHEET_ID,
 * yang gejalanya muncul jauh belakangan sebagai error tidak jelas saat login.
 */
function cekKonfigurasi() {
  var props = PropertiesService.getScriptProperties();
  var laporan = [];
  var aman = true;

  var idSheet = props.getProperty('SPREADSHEET_ID');
  if (!idSheet) {
    laporan.push('GAGAL  SPREADSHEET_ID belum diisi.');
    aman = false;
  } else {
    try {
      var nama = SpreadsheetApp.openById(idSheet).getName();
      laporan.push('OK     SPREADSHEET_ID valid, terhubung ke "' + nama + '"');
    } catch (e) {
      laporan.push('GAGAL  SPREADSHEET_ID terisi tapi tidak bisa dibuka: ' + e.message);
      aman = false;
    }
  }

  var kunci = props.getProperty('SECRET_KEY');
  if (!kunci) {
    laporan.push('GAGAL  SECRET_KEY belum diisi.');
    aman = false;
  } else if (kunci.length < 32) {
    laporan.push('GAGAL  SECRET_KEY hanya ' + kunci.length + ' karakter, minimal 32.');
    aman = false;
  } else {
    laporan.push('OK     SECRET_KEY terisi (' + kunci.length + ' karakter)');
  }

  laporan.push('');
  laporan.push(aman
    ? 'Konfigurasi siap. Lanjutkan ke createAllSheets().'
    : 'Perbaiki dulu lewat Project Settings > Script Properties.');

  console.log(laporan.join('\n'));
  return aman;
}


/**
 * Buat seluruh tab beserta headernya.
 *
 * Aman dijalankan berulang kali. Tab yang sudah ada tidak disentuh isinya —
 * hanya headernya yang diperiksa. Ini penting karena fungsi ini kemungkinan
 * besar akan dijalankan lagi setelah data produksi masuk.
 */
function createAllSheets() {
  var ss = SpreadsheetApp.openById(prop_('SPREADSHEET_ID'));
  var dibuat = [];
  var dilewati = [];
  var bermasalah = [];

  for (var nama in SKEMA) {
    var skema = SKEMA[nama];
    var sh = ss.getSheetByName(nama);

    if (sh) {
      var hasil = periksaHeader_(sh, skema.header);
      if (hasil) bermasalah.push(nama + ': ' + hasil);
      else dilewati.push(nama);
      aturFormatKolom_(sh, skema);
      continue;
    }

    sh = ss.insertSheet(nama);
    siapkanSheet_(sh, skema);
    dibuat.push(nama);
  }

  // Tab bawaan dihapus hanya kalau benar-benar kosong. Menghapus data yang
  // belum sempat diperiksa manusia bukan keputusan yang boleh diambil skrip.
  //
  // Namanya bergantung bahasa antarmuka Google Sheets pemiliknya: "Sheet1"
  // dalam bahasa Inggris, "Lembar1" dalam bahasa Indonesia.
  var namaBawaan = ['Sheet1', 'Sheet 1', 'Lembar1', 'Lembar 1'];
  for (var b = 0; b < namaBawaan.length; b++) {
    var bawaan = ss.getSheetByName(namaBawaan[b]);
    if (bawaan && ss.getSheets().length > 1 && bawaan.getLastRow() === 0) {
      ss.deleteSheet(bawaan);
      dibuat.push('(' + namaBawaan[b] + ' kosong dihapus)');
      break;
    }
  }

  var laporan = [];
  laporan.push('Tab dibuat  : ' + (dibuat.length ? dibuat.join(', ') : 'tidak ada'));
  laporan.push('Sudah ada   : ' + (dilewati.length ? dilewati.join(', ') : 'tidak ada'));
  if (bermasalah.length) {
    laporan.push('');
    laporan.push('HEADER TIDAK COCOK — perbaiki manual sebelum sistem dipakai:');
    bermasalah.forEach(function (b) { laporan.push('  ' + b); });
  }
  laporan.push('');
  laporan.push('Berikutnya: impor CSV hasil migrasi lewat File > Import,');
  laporan.push('pilih "Replace data at selected cell" pada sel A2 tiap tab.');

  console.log(laporan.join('\n'));
  return laporan.join('\n');
}


/** Tulis header, bekukan baris 1, dan pasang format kolom. */
function siapkanSheet_(sh, skema) {
  var header = skema.header;
  sh.getRange(1, 1, 1, header.length).setValues([header]);
  sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
  sh.setFrozenRows(1);
  aturFormatKolom_(sh, skema);

  // Kolom sisa di kanan dibuang supaya rentang getLastColumn() tetap rapat
  // dan pembacaan tidak menyeret ratusan kolom kosong.
  var maksKolom = sh.getMaxColumns();
  if (maksKolom > header.length) {
    sh.deleteColumns(header.length + 1, maksKolom - header.length);
  }
}


/**
 * Paksa kolom tertentu berformat teks polos.
 *
 * Ini bukan urusan tampilan. Tanpa ini Google Sheets akan:
 *   - mengubah "2024-09-30" jadi objek tanggal, sehingga perbandingan
 *     string untuk aging piutang berantakan;
 *   - mengubah hash password 64 karakter jadi notasi ilmiah kalau kebetulan
 *     seluruhnya angka, yang membuat user tidak akan pernah bisa login lagi
 *     dan tidak ada cara memulihkannya;
 *   - membuang nol di depan nomor telepon "0812...".
 */
function aturFormatKolom_(sh, skema) {
  if (!skema.teks || !skema.teks.length) return;
  var jumlahBaris = Math.max(sh.getMaxRows() - 1, 1);

  for (var i = 0; i < skema.teks.length; i++) {
    var idx = skema.header.indexOf(skema.teks[i]);
    if (idx >= 0) {
      sh.getRange(2, idx + 1, jumlahBaris, 1).setNumberFormat('@');
    }
  }
}


/** Bandingkan header sebuah tab dengan skema. Mengembalikan '' bila cocok. */
function periksaHeader_(sh, header) {
  if (sh.getLastColumn() === 0) {
    sh.getRange(1, 1, 1, header.length).setValues([header]);
    sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
    sh.setFrozenRows(1);
    return '';
  }

  var aktual = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim(); })
    .filter(function (h) { return h !== ''; });

  var kurang = header.filter(function (h) { return aktual.indexOf(h) < 0; });
  var asing = aktual.filter(function (h) { return header.indexOf(h) < 0; });

  var masalah = [];
  if (kurang.length) masalah.push('kolom hilang [' + kurang.join(', ') + ']');
  if (asing.length) masalah.push('kolom asing [' + asing.join(', ') + ']');
  if (!masalah.length && aktual.join('|') !== header.join('|')) {
    masalah.push('urutan kolom berbeda dari skema');
  }
  return masalah.join('; ');
}


/**
 * Verifikasi hasil impor CSV.
 *
 * Yang diperiksa bukan cuma jumlah baris, tapi juga hal-hal yang diam-diam
 * rusak saat impor: hash password yang berubah jadi angka, dan tanggal yang
 * berubah jadi objek Date.
 */
function cekIsiData() {
  var laporan = ['ISI SPREADSHEET', ''];

  for (var nama in SKEMA) {
    var jumlah = 0;
    try {
      jumlah = bacaTabel(nama).length;
    } catch (e) {
      laporan.push(padKanan_(nama, 22) + 'TAB BELUM ADA');
      continue;
    }
    laporan.push(padKanan_(nama, 22) + jumlah + ' baris');
  }

  laporan.push('');
  laporan.push('PEMERIKSAAN KERUSAKAN IMPOR');

  // Hash password wajib berupa 64 karakter heksadesimal. Kalau Sheets sempat
  // menafsirkannya sebagai angka, nilainya rusak permanen dan user tidak akan
  // pernah bisa login — jadi lebih baik ketahuan sekarang.
  var users = bacaTabel('users');
  var rusak = [];
  users.forEach(function (u) {
    var h = keTeks_(u.password_hash);
    if (!/^[0-9a-f]{64}$/.test(h)) {
      rusak.push(keTeks_(u.username) + ' (hash: "' + h.substring(0, 24) + '...")');
    }
  });
  laporan.push(rusak.length
    ? 'GAGAL  hash password rusak pada: ' + rusak.join(', ') +
      '\n       Setel kolom password_hash & salt ke format Teks Polos, ' +
      'lalu impor ulang users.csv.'
    : 'OK     ' + users.length + ' hash password berbentuk sah');

  // Tanggal harus tetap string 'YYYY-MM-DD'. Kalau berubah jadi Date, semua
  // perbandingan leksikografis di aging piutang akan salah diam-diam.
  var orders = bacaTabel('sales_orders');
  var tglSalah = orders.filter(function (o) {
    return o.order_date instanceof Date || o.due_date instanceof Date;
  }).length;
  laporan.push(tglSalah
    ? 'PERINGATAN ' + tglSalah + ' baris sales_orders punya tanggal bertipe Date, ' +
      'bukan teks. Sistem masih jalan karena dinormalisasi saat dibaca, ' +
      'tapi sebaiknya kolomnya diformat sebagai Teks Polos.'
    : 'OK     format tanggal sales_orders konsisten');

  // Integritas referensial tidak dijamin Sheets, jadi harus diperiksa sendiri.
  var kodeCust = {};
  bacaTabel('customers').forEach(function (c) { kodeCust[keTeks_(c.code)] = true; });
  var yatim = orders.filter(function (o) {
    return !kodeCust[keTeks_(o.customer_code)];
  }).length;
  laporan.push(yatim
    ? 'GAGAL  ' + yatim + ' sales_orders menunjuk customer yang tidak ada'
    : 'OK     seluruh sales_orders punya customer yang sah');

  console.log(laporan.join('\n'));
  return laporan.join('\n');
}


function padKanan_(teks, panjang) {
  var t = String(teks);
  while (t.length < panjang) t += ' ';
  return t;
}


/**
 * Bangkitkan hash dan salt untuk sebuah password.
 *
 * Dipakai kalau perlu membuat atau mereset user secara manual sebelum menu
 * Users tersedia. Jalankan dari editor, salin hasilnya ke baris di tab users.
 *
 * Ubah nilai di bawah lalu jalankan fungsinya.
 */
function buatHashManual() {
  var password = 'GANTI_PASSWORD_INI';

  var salt = Utilities.getUuid().replace(/-/g, '');
  var hash = hashPassword_(password, salt);

  console.log(
    'password : ' + password + '\n' +
    'salt     : ' + salt + '\n' +
    'hash     : ' + hash + '\n\n' +
    'Salin salt dan hash ke baris user di tab users. Jangan simpan password ' +
    'polos di mana pun.'
  );
}
