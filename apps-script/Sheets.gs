/**
 * Sheets.gs — satu-satunya lapisan yang menyentuh SpreadsheetApp.
 *
 * Seluruh file lain WAJIB lewat sini. Alasannya dua:
 *
 * 1. Kuota. Apps Script membatasi jumlah panggilan ke Spreadsheet API.
 *    Semua pembacaan di sini memakai getValues() satu kali untuk seluruh
 *    rentang, lalu diproses di memori. Tidak pernah ada getValue() per sel.
 *
 * 2. Google Sheets bukan basis data. Tidak ada tipe kolom, tidak ada
 *    constraint, dan angka bisa berubah jadi tanggal tanpa diminta.
 *    Semua pembersihan tipe dipusatkan di sini supaya tidak tersebar.
 */

// ---------------------------------------------------------------------------
// SKEMA — sumber kebenaran tunggal untuk struktur seluruh tab.
//
// Setup.gs memakai ini untuk membuat tab. Fungsi baca/tulis memakainya untuk
// memetakan kolom. Kalau skema berubah, ubah di sini saja.
//
//   header : urutan kolom, persis seperti di baris 1
//   teks   : kolom yang dipaksa berformat teks polos.
//            Ini bukan kerapian — ini pencegahan kerusakan data.
//            Tanpa ini Sheets akan mengubah "2024-09-30" jadi objek tanggal
//            dan hash password 64 digit jadi notasi ilmiah.
// ---------------------------------------------------------------------------

var SKEMA = {
  users: {
    header: ['user_id', 'username', 'password_hash', 'salt', 'full_name',
             'role', 'sales_person_name', 'is_active'],
    teks: ['user_id', 'username', 'password_hash', 'salt', 'sales_person_name']
  },
  products: {
    header: ['code', 'name', 'packaging_type', 'volume_ml', 'cogs', 'price',
             'min_stock', 'is_returnable', 'deposit_amount', 'is_active'],
    teks: ['code']
  },
  customers: {
    header: ['code', 'name', 'area', 'type', 'payment_term_days', 'phone',
             'sales_person', 'is_active'],
    teks: ['code', 'phone']
  },
  customer_prices: {
    header: ['customer_code', 'product_code', 'special_price'],
    teks: ['customer_code', 'product_code']
  },
  sales_orders: {
    header: ['order_id', 'invoice_no', 'order_date', 'customer_code',
             'due_date', 'status', 'subtotal', 'created_by', 'created_at'],
    teks: ['order_id', 'invoice_no', 'order_date', 'customer_code',
           'due_date', 'created_at']
  },
  sales_order_items: {
    header: ['item_id', 'order_id', 'product_code', 'qty', 'unit_price',
             'unit_cogs', 'line_total'],
    teks: ['item_id', 'order_id', 'product_code']
  },
  payments: {
    header: ['payment_id', 'order_id', 'payment_date', 'amount', 'method',
             'reference', 'created_by'],
    teks: ['payment_id', 'order_id', 'payment_date', 'reference']
  },
  stock_movements: {
    header: ['movement_id', 'moved_at', 'item_type', 'item_code', 'qty',
             'movement_type', 'ref_type', 'ref_id', 'notes', 'created_by',
             'created_at'],
    teks: ['movement_id', 'moved_at', 'item_code', 'ref_id', 'created_at']
  },
  gallon_ledger: {
    header: ['ledger_id', 'moved_at', 'customer_code', 'product_code', 'qty',
             'movement_type', 'deposit_amount', 'ref_type', 'ref_id', 'notes',
             'created_by'],
    teks: ['ledger_id', 'moved_at', 'customer_code', 'product_code', 'ref_id']
  },
  production_batches: {
    header: ['batch_id', 'batch_no', 'produced_at', 'product_code', 'qty',
             'ph_value', 'tds_value', 'pic', 'notes', 'created_by'],
    teks: ['batch_id', 'batch_no', 'produced_at', 'product_code']
  },
  materials: {
    header: ['code', 'name', 'unit', 'min_stock'],
    teks: ['code']
  },
  suppliers: {
    header: ['code', 'name', 'address', 'phone', 'payment_term_days'],
    teks: ['code', 'phone']
  },
  material_purchases: {
    header: ['purchase_id', 'purchase_date', 'supplier_code', 'material_code',
             'qty', 'unit_price', 'total', 'created_by'],
    teks: ['purchase_id', 'purchase_date', 'supplier_code', 'material_code']
  },
  operational_expenses: {
    header: ['expense_id', 'expense_date', 'category', 'amount', 'description',
             'created_by'],
    teks: ['expense_id', 'expense_date']
  },
  audit_log: {
    header: ['log_id', 'timestamp', 'user_id', 'username', 'action', 'payload',
             'result'],
    teks: ['log_id', 'timestamp', 'user_id', 'payload']
  }
};


// ---------------------------------------------------------------------------
// Konfigurasi & akses spreadsheet
// ---------------------------------------------------------------------------

/** Ambil nilai dari Script Properties. Rahasia tidak pernah ditulis di kode. */
function prop_(nama) {
  var nilai = PropertiesService.getScriptProperties().getProperty(nama);
  if (!nilai) {
    throw errorApp('CONFIG_MISSING',
      'Script Property "' + nama + '" belum diisi. Buka Project Settings > ' +
      'Script Properties di editor Apps Script.');
  }
  return nilai;
}

var _ss = null;

/** Objek Spreadsheet, dibuka sekali per eksekusi. */
function ss_() {
  if (!_ss) _ss = SpreadsheetApp.openById(prop_('SPREADSHEET_ID'));
  return _ss;
}

/** Ambil sheet berdasarkan nama tab, gagal jelas kalau tabnya belum dibuat. */
function sheet_(nama) {
  var sh = ss_().getSheetByName(nama);
  if (!sh) {
    throw errorApp('SHEET_MISSING',
      'Tab "' + nama + '" tidak ada. Jalankan createAllSheets() dari editor ' +
      'Apps Script terlebih dahulu.');
  }
  return sh;
}


// ---------------------------------------------------------------------------
// Pembersihan tipe
//
// Nilai dari Sheets tidak bisa dipercaya tipenya. Kolom yang sama bisa berisi
// string di satu baris dan angka di baris lain, tergantung bagaimana datanya
// masuk. Empat fungsi di bawah ini adalah gerbangnya.
// ---------------------------------------------------------------------------

function keTeks_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return keTanggalStr_(v);
  return String(v).trim();
}

function keAngka_(v) {
  if (typeof v === 'number') return v;
  if (v === null || v === undefined || v === '') return 0;
  var n = parseFloat(String(v).replace(/[^\d.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}

/** Sheets menyimpan boolean sebagai TRUE/FALSE, string, atau boolean asli. */
function keBool_(v) {
  if (typeof v === 'boolean') return v;
  var t = keTeks_(v).toUpperCase();
  return t === 'TRUE' || t === 'YA' || t === '1';
}

/**
 * Normalisasi tanggal ke 'YYYY-MM-DD'.
 *
 * Menerima objek Date (kalau Sheets terlanjur mengonversi) maupun string.
 * Bentuk string ISO dipilih karena bisa diurutkan dan dibandingkan secara
 * leksikografis, sehingga perhitungan aging piutang tidak perlu parsing.
 */
function keTanggalStr_(v) {
  if (!v) return '';
  if (v instanceof Date) {
    return Utilities.formatDate(v, 'Asia/Jakarta', 'yyyy-MM-dd');
  }
  var t = String(v).trim();
  var cocok = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return cocok ? cocok[0] : t;
}

/** Cap waktu sekarang dalam zona Jakarta, untuk kolom *_at. */
function sekarang_() {
  return Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm:ss');
}

/** Tanggal hari ini, untuk kolom *_date. */
function hariIni_() {
  return Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd');
}


// ---------------------------------------------------------------------------
// Baca
// ---------------------------------------------------------------------------

var _cacheTabel = {};

/**
 * Baca seluruh isi satu tab sebagai array objek.
 *
 * Satu panggilan getValues() untuk seluruh rentang, lalu dipetakan di memori.
 * Hasilnya di-cache selama eksekusi berlangsung, jadi memanggil bacaTabel()
 * berkali-kali dalam satu request tidak menambah beban kuota.
 *
 * @param {string} nama nama tab
 * @return {Array<Object>} baris data, tanpa baris header
 */
function bacaTabel(nama) {
  if (_cacheTabel[nama]) return _cacheTabel[nama];

  var sh = sheet_(nama);
  var jumlahBaris = sh.getLastRow();
  var jumlahKolom = sh.getLastColumn();

  if (jumlahBaris < 2 || jumlahKolom < 1) {
    _cacheTabel[nama] = [];
    return [];
  }

  var nilai = sh.getRange(1, 1, jumlahBaris, jumlahKolom).getValues();
  var header = nilai[0].map(function (h) { return keTeks_(h); });

  var hasil = [];
  for (var i = 1; i < nilai.length; i++) {
    var baris = nilai[i];

    // Baris kosong di tengah tabel diabaikan, bukan dianggap data rusak.
    var adaIsi = false;
    for (var k = 0; k < baris.length; k++) {
      if (baris[k] !== '' && baris[k] !== null) { adaIsi = true; break; }
    }
    if (!adaIsi) continue;

    var obj = { _row: i + 1 };   // nomor baris asli, dipakai saat memperbarui
    for (var j = 0; j < header.length; j++) {
      if (header[j]) obj[header[j]] = baris[j];
    }
    hasil.push(obj);
  }

  _cacheTabel[nama] = hasil;
  return hasil;
}

/** Buang cache satu tab supaya pembacaan berikutnya mengambil data segar. */
function batalkanCache_(nama) {
  if (nama) delete _cacheTabel[nama];
  else _cacheTabel = {};
}

/** Cari satu baris berdasarkan nilai sebuah kolom. Mengembalikan null bila tidak ada. */
function cariBaris(nama, kolom, nilai) {
  var target = keTeks_(nilai).toUpperCase();
  var baris = bacaTabel(nama);
  for (var i = 0; i < baris.length; i++) {
    if (keTeks_(baris[i][kolom]).toUpperCase() === target) return baris[i];
  }
  return null;
}

/** Bentuk peta kode -> baris, untuk validasi referensial tanpa loop bersarang. */
function petaBerdasarkan(nama, kolom) {
  var peta = {};
  var baris = bacaTabel(nama);
  for (var i = 0; i < baris.length; i++) {
    peta[keTeks_(baris[i][kolom]).toUpperCase()] = baris[i];
  }
  return peta;
}


// ---------------------------------------------------------------------------
// Tulis
// ---------------------------------------------------------------------------

/** Susun objek jadi array sesuai urutan kolom di skema. */
function keArrayBaris_(nama, obj) {
  var header = SKEMA[nama].header;
  var baris = [];
  for (var i = 0; i < header.length; i++) {
    var v = obj[header[i]];
    baris.push(v === undefined || v === null ? '' : v);
  }
  return baris;
}

/**
 * Tambah banyak baris sekaligus dengan satu setValues().
 *
 * Menambah baris satu per satu adalah cara tercepat menghabiskan kuota.
 * Semua penulisan di sistem ini melewati fungsi ini.
 *
 * @return {number} nomor baris pertama yang ditulis, dipakai untuk rollback
 */
function tambahBaris(nama, daftarObj) {
  if (!daftarObj || !daftarObj.length) return 0;

  var sh = sheet_(nama);
  var mulai = sh.getLastRow() + 1;
  var data = daftarObj.map(function (o) { return keArrayBaris_(nama, o); });

  sh.getRange(mulai, 1, data.length, SKEMA[nama].header.length).setValues(data);
  batalkanCache_(nama);
  return mulai;
}

/** Perbarui sebagian kolom pada satu baris yang sudah ada. */
function perbaruiBaris(nama, kolomKunci, nilaiKunci, perubahan) {
  var baris = cariBaris(nama, kolomKunci, nilaiKunci);
  if (!baris) {
    throw errorApp('NOT_FOUND',
      'Baris dengan ' + kolomKunci + ' = ' + nilaiKunci + ' tidak ditemukan di ' + nama);
  }

  var sh = sheet_(nama);
  var header = SKEMA[nama].header;

  for (var kolom in perubahan) {
    var idx = header.indexOf(kolom);
    if (idx < 0) {
      throw errorApp('INTERNAL', 'Kolom "' + kolom + '" tidak ada di tab ' + nama);
    }
    sh.getRange(baris._row, idx + 1).setValue(perubahan[kolom]);
  }

  batalkanCache_(nama);
  return baris;
}

/**
 * Hapus baris yang baru saja ditulis, dipakai saat rollback.
 *
 * Dihapus dari bawah ke atas supaya nomor baris di atasnya tidak bergeser.
 * Hanya untuk membatalkan penulisan dalam eksekusi yang sama — bukan untuk
 * menghapus data lama. Data lama memakai soft delete.
 */
function hapusBarisSejak_(nama, barisMulai) {
  if (!barisMulai) return;
  var sh = sheet_(nama);
  var terakhir = sh.getLastRow();
  if (terakhir >= barisMulai) {
    sh.deleteRows(barisMulai, terakhir - barisMulai + 1);
  }
  batalkanCache_(nama);
}


// ---------------------------------------------------------------------------
// Penomoran
// ---------------------------------------------------------------------------

/**
 * Buat ID urut berikutnya, contoh: ORD00001, MOV00042.
 *
 * Membaca seluruh kolom lalu mengambil angka tertinggi. Cara ini aman untuk
 * volume seratusan baris per tahun dan tidak akan menabrak ID hasil migrasi.
 * Selalu dipanggil dari dalam lock, sehingga dua request bersamaan tidak
 * bisa mendapat nomor yang sama.
 */
function idBerikutnya_(nama, kolom, prefiks) {
  var baris = bacaTabel(nama);
  var maks = 0;
  for (var i = 0; i < baris.length; i++) {
    var t = keTeks_(baris[i][kolom]);
    if (t.indexOf(prefiks) === 0) {
      var n = parseInt(t.substring(prefiks.length), 10);
      if (!isNaN(n) && n > maks) maks = n;
    }
  }
  var urut = String(maks + 1);
  while (urut.length < 5) urut = '0' + urut;
  return prefiks + urut;
}


// ---------------------------------------------------------------------------
// Penguncian
// ---------------------------------------------------------------------------

/**
 * Bungkus operasi tulis dengan kunci skrip.
 *
 * Google Sheets tidak punya transaksi. Kalau dua penjualan disimpan pada detik
 * yang sama tanpa kunci, keduanya bisa membaca nomor invoice terakhir yang
 * sama dan menghasilkan nomor kembar. Kunci ini yang mencegahnya.
 *
 * Cache dibuang setelah kunci didapat, karena data bisa saja berubah oleh
 * eksekusi lain selama kita menunggu.
 */
function denganKunci(fn) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (e) {
    throw errorApp('BUSY',
      'Sistem sedang memproses transaksi lain. Coba lagi beberapa detik.');
  }
  try {
    batalkanCache_();
    return fn();
  } finally {
    lock.releaseLock();
  }
}


// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

/**
 * Catat setiap operasi tulis.
 *
 * Sengaja tidak pernah melempar error. Kegagalan mencatat log tidak boleh
 * membatalkan transaksi yang sudah tersimpan — itu justru menyebabkan
 * kerusakan yang lebih parah daripada log yang bolong.
 */
function catatAudit(sesi, aksi, payload, hasil) {
  try {
    var ringkas = JSON.stringify(payload || {});
    if (ringkas.length > 900) ringkas = ringkas.substring(0, 900) + '...(dipotong)';

    tambahBaris('audit_log', [{
      log_id: idBerikutnya_('audit_log', 'log_id', 'LOG'),
      timestamp: sekarang_(),
      user_id: sesi ? sesi.user_id : '',
      username: sesi ? sesi.username : '(anonim)',
      action: aksi,
      payload: ringkas,
      result: hasil
    }]);
  } catch (e) {
    console.error('Gagal menulis audit_log: ' + e.message);
  }
}


// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

/**
 * Error dengan kode yang bisa dibaca frontend.
 *
 * Kode dipakai program untuk mengambil keputusan, message dipakai manusia.
 * Pesan ditulis untuk staf administrasi, bukan untuk programmer.
 */
function errorApp(kode, pesan) {
  var e = new Error(pesan);
  e.kodeApp = kode;
  return e;
}
