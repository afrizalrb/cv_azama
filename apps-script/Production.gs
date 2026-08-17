/**
 * Production.gs — catatan batch produksi.
 *
 * Model bisnisnya pre-order: produksi mengikuti pesanan yang masuk, tidak ada
 * penyetokan barang jadi. Karena itu catatan batch di sini bukan alat kelola
 * persediaan, melainkan dua hal lain:
 *
 * 1. Rekam jejak mutu. Nilai pH dan TDS tiap batch adalah janji produk kepada
 *    customer — "TDS 0.003, pH 6" tertulis di nama produknya sendiri. Kalau
 *    suatu saat ada keluhan rasa atau kejernihan, batch mana yang bermasalah
 *    hanya bisa ditelusuri kalau angkanya pernah dicatat.
 *
 * 2. Pasangan hitung buku besar. Sejak Fase 1 setiap penjualan menulis baris
 *    barang keluar, tanpa pernah ada barang masuk. Batch produksi inilah yang
 *    mengimbanginya, sehingga saldo mutasi akhirnya bermakna: mendekati nol
 *    berarti yang diproduksi habis terkirim, persis seperti seharusnya pada
 *    model pre-order.
 */


/**
 * production.create — catat satu batch produksi.
 *
 * payload: {
 *   produced_at:  '2026-08-17',    opsional, default hari ini
 *   product_code: 'GD19',
 *   qty:          200,
 *   ph_value:     6.1,             opsional
 *   tds_value:    0.003,           opsional
 *   pic:          'Nama operator',
 *   notes:        'catatan bebas'  opsional
 * }
 */
function productionCreate(payload, sesi) {
  var p = payload || {};
  var kodeProd = keTeks_(p.product_code).toUpperCase();
  var qty = Math.round(keAngka_(p.qty));
  var pic = keTeks_(p.pic);

  if (!kodeProd) throw errorApp('BAD_REQUEST', 'Produk belum dipilih.');
  if (qty <= 0) throw errorApp('BAD_REQUEST', 'Jumlah produksi harus lebih dari nol.');
  if (qty > 100000) {
    throw errorApp('BAD_REQUEST', 'Jumlah ' + qty + ' tidak wajar untuk satu batch.');
  }
  if (!pic) {
    throw errorApp('BAD_REQUEST',
      'Penanggung jawab batch wajib diisi, supaya bisa ditelusuri bila ada keluhan mutu.');
  }

  var tanggal = p.produced_at
    ? wajibTanggal_(p.produced_at, 'Tanggal produksi')
    : hariIni_();
  if (selisihHari_(hariIni_(), tanggal) > 1) {
    throw errorApp('BAD_REQUEST', 'Tanggal produksi tidak boleh di masa depan.');
  }

  // Nilai mutu diperiksa kewajarannya, bukan sekadar diterima apa adanya.
  // Angka di luar rentang ini hampir selalu salah ketik satuan atau koma.
  var ph = p.ph_value === '' || p.ph_value === undefined || p.ph_value === null
    ? null : keAngka_(p.ph_value);
  if (ph !== null && (ph < 0 || ph > 14)) {
    throw errorApp('BAD_REQUEST', 'Nilai pH harus antara 0 dan 14.');
  }

  var tds = p.tds_value === '' || p.tds_value === undefined || p.tds_value === null
    ? null : keAngka_(p.tds_value);
  if (tds !== null && (tds < 0 || tds > 5000)) {
    throw errorApp('BAD_REQUEST', 'Nilai TDS di luar rentang yang masuk akal.');
  }

  return denganKunci(function () {
    var produk = cariBaris('products', 'code', kodeProd);
    if (!produk) throw errorApp('NOT_FOUND', 'Produk ' + kodeProd + ' tidak ada.');
    if (!keBool_(produk.is_active)) {
      throw errorApp('BAD_REQUEST',
        'Produk ' + keTeks_(produk.name) + ' sudah tidak aktif.');
    }

    var batchId = idBerikutnya_('production_batches', 'batch_id', 'BTC');
    var batchNo = nomorBatchBerikutnya_(tanggal);
    var saatIni = sekarang_();

    var barisBatch = [{
      batch_id: batchId,
      batch_no: batchNo,
      produced_at: tanggal,
      product_code: kodeProd,
      qty: qty,
      ph_value: ph === null ? '' : ph,
      tds_value: tds === null ? '' : tds,
      pic: pic,
      notes: keTeks_(p.notes),
      created_by: sesi.username
    }];

    var barisMutasi = [{
      movement_id: idBerikutnya_('stock_movements', 'movement_id', 'MOV'),
      moved_at: tanggal,
      item_type: 'product',
      item_code: kodeProd,
      qty: qty,                    // positif: barang masuk dari produksi
      movement_type: 'production_in',
      ref_type: 'production_batch',
      ref_id: batchId,
      notes: 'Produksi batch ' + batchNo,
      created_by: sesi.username,
      created_at: saatIni
    }];

    var ditulis = [];
    try {
      tulisDanCatat_(ditulis, 'production_batches', barisBatch);
      tulisDanCatat_(ditulis, 'stock_movements', barisMutasi);
    } catch (e) {
      batalkanPenulisan_(ditulis);
      catatAudit(sesi, 'production.create', { batch_no: batchNo },
        'GAGAL, dibatalkan: ' + e.message);
      throw errorApp('WRITE_FAILED',
        'Batch gagal disimpan dan perubahan sudah dikembalikan. Coba lagi.');
    }

    catatAudit(sesi, 'production.create',
      { batch_no: batchNo, product_code: kodeProd, qty: qty }, 'BERHASIL');

    return {
      batch_id: batchId,
      batch_no: batchNo,
      produced_at: tanggal,
      product_code: kodeProd,
      nama_produk: keTeks_(produk.name),
      qty: qty,
      ph_value: ph,
      tds_value: tds,
      pic: pic,
      // Nilai HPP batch dihitung dari master, bukan disimpan. Angkanya hanya
      // gambaran biaya produksi saat ini, bukan snapshot seperti pada penjualan.
      perkiraan_hpp: qty * keAngka_(produk.cogs)
    };
  });
}


/**
 * production.list — riwayat batch.
 *
 * payload: { dari, sampai, product_code, limit }
 */
function productionList(payload, sesi) {
  var p = payload || {};
  var dari = p.dari ? keTanggalStr_(p.dari) : '';
  var sampai = p.sampai ? keTanggalStr_(p.sampai) : '';
  var filterProd = keTeks_(p.product_code).toUpperCase();
  var batas = Math.min(Math.round(keAngka_(p.limit)) || 200, 1000);

  var petaProduk = petaBerdasarkan('products', 'code');

  var hasil = [];
  var totalQty = 0;
  var perProduk = {};

  bacaTabel('production_batches').forEach(function (b) {
    var tgl = keTanggalStr_(b.produced_at);
    if (dari && tgl < dari) return;
    if (sampai && tgl > sampai) return;

    var kode = keTeks_(b.product_code).toUpperCase();
    if (filterProd && kode !== filterProd) return;

    var qty = keAngka_(b.qty);
    var pr = petaProduk[kode];
    totalQty += qty;
    perProduk[kode] = (perProduk[kode] || 0) + qty;

    hasil.push({
      batch_id: keTeks_(b.batch_id),
      batch_no: keTeks_(b.batch_no),
      produced_at: tgl,
      product_code: kode,
      nama_produk: pr ? keTeks_(pr.name) : '(produk terhapus)',
      kemasan: pr ? keTeks_(pr.packaging_type) : '',
      qty: qty,
      ph_value: keTeks_(b.ph_value),
      tds_value: keTeks_(b.tds_value),
      pic: keTeks_(b.pic),
      notes: keTeks_(b.notes),
      created_by: keTeks_(b.created_by),
      // Batch tanpa catatan mutu tetap sah, tapi frontend perlu bisa
      // menandainya supaya kebiasaan mencatat bisa diperbaiki.
      mutu_lengkap: keTeks_(b.ph_value) !== '' && keTeks_(b.tds_value) !== ''
    });
  });

  hasil.sort(function (a, b) {
    if (a.produced_at !== b.produced_at) return a.produced_at < b.produced_at ? 1 : -1;
    return a.batch_no < b.batch_no ? 1 : -1;
  });

  var ringkasProduk = [];
  for (var kode in perProduk) {
    var pr = petaProduk[kode];
    ringkasProduk.push({
      product_code: kode,
      nama: pr ? keTeks_(pr.name) : '(produk terhapus)',
      qty: perProduk[kode]
    });
  }
  ringkasProduk.sort(function (a, b) { return b.qty - a.qty; });

  return {
    daftar: hasil.slice(0, batas),
    jumlah_total: hasil.length,
    dipotong: hasil.length > batas,
    ringkasan: {
      total_qty: totalQty,
      jumlah_batch: hasil.length,
      tanpa_catatan_mutu: hasil.filter(function (x) { return !x.mutu_lengkap; }).length,
      per_produk: ringkasProduk
    }
  };
}


/**
 * Nomor batch berikutnya, format BTH + YYMM + tiga digit urut.
 *
 * Sengaja mengikuti pola nomor invoice supaya staf tidak perlu menghafal dua
 * sistem penomoran yang berbeda. Selalu dipanggil dari dalam kunci.
 */
function nomorBatchBerikutnya_(tanggal) {
  var t = keTanggalStr_(tanggal);
  var prefiks = 'BTH' + t.substring(2, 4) + t.substring(5, 7);

  var maks = 0;
  bacaTabel('production_batches').forEach(function (b) {
    var no = keTeks_(b.batch_no).toUpperCase();
    if (no.indexOf(prefiks) === 0) {
      var n = parseInt(no.substring(prefiks.length), 10);
      if (!isNaN(n) && n > maks) maks = n;
    }
  });

  if (maks >= 999) {
    throw errorApp('LIMIT_REACHED',
      'Nomor batch bulan ini sudah mencapai 999. Hubungi administrator.');
  }

  var urut = String(maks + 1);
  while (urut.length < 3) urut = '0' + urut;
  return prefiks + urut;
}
