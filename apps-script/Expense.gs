/**
 * Expense.gs — biaya operasional dan laporan laba rugi.
 *
 * Laba bersih dihitung sebagai omzet dikurangi harga pokok dikurangi biaya
 * operasional. Pembelian bahan sengaja TIDAK ikut dikurangkan, karena biaya
 * bahan sudah terkandung di dalam HPP tiap produk. Menghitungnya dua kali
 * akan membuat perusahaan terlihat merugi padahal tidak.
 */

var KATEGORI_BIAYA = [
  'Gaji & upah',
  'Listrik & air',
  'Transportasi',
  'Perawatan alat',
  'Sewa',
  'Perlengkapan',
  'Administrasi',
  'Lainnya'
];


// ---------------------------------------------------------------------------
// Pencatatan
// ---------------------------------------------------------------------------

/**
 * expense.create
 *
 * payload: {
 *   expense_date: '2026-08-17',   opsional, default hari ini
 *   category:     'Listrik & air',
 *   amount:       500000,
 *   description:  'PLN Agustus'
 * }
 */
function expenseCreate(payload, sesi) {
  var p = payload || {};
  var kategori = keTeks_(p.category);
  var jumlah = Math.round(keAngka_(p.amount));
  var keterangan = keTeks_(p.description);

  if (!kategori) throw errorApp('BAD_REQUEST', 'Kategori biaya belum dipilih.');
  if (KATEGORI_BIAYA.indexOf(kategori) < 0) {
    throw errorApp('BAD_REQUEST',
      'Kategori harus salah satu dari: ' + KATEGORI_BIAYA.join(', ') + '.');
  }
  if (jumlah <= 0) throw errorApp('BAD_REQUEST', 'Nominal harus lebih dari nol.');
  if (!keterangan) {
    throw errorApp('BAD_REQUEST',
      'Keterangan wajib diisi. Tanpa itu, biaya lama tidak bisa ditelusuri lagi ' +
      'saat laporan diperiksa.');
  }

  var tanggal = p.expense_date
    ? wajibTanggal_(p.expense_date, 'Tanggal biaya')
    : hariIni_();
  if (selisihHari_(hariIni_(), tanggal) > 1) {
    throw errorApp('BAD_REQUEST', 'Tanggal biaya tidak boleh di masa depan.');
  }

  return denganKunci(function () {
    var baris = [{
      expense_id: idBerikutnya_('operational_expenses', 'expense_id', 'EXP'),
      expense_date: tanggal,
      category: kategori,
      amount: jumlah,
      description: keterangan,
      created_by: sesi.username
    }];

    tambahBaris('operational_expenses', baris);
    catatAudit(sesi, 'expense.create',
      { category: kategori, amount: jumlah }, 'BERHASIL');

    return {
      expense_id: baris[0].expense_id,
      expense_date: tanggal,
      category: kategori,
      amount: jumlah,
      description: keterangan
    };
  });
}


/**
 * expense.reverse — batalkan satu biaya.
 *
 * Ditulis sebagai baris bernilai negatif, mengikuti pola yang sama dengan
 * pembatalan penjualan dan pembayaran. Laporan bulan berjalan langsung
 * terkoreksi, tapi jejak bahwa biaya itu pernah dicatat tetap ada.
 */
function expenseReverse(payload, sesi) {
  var p = payload || {};
  var id = keTeks_(p.expense_id);
  var alasan = keTeks_(p.alasan);

  if (!id) throw errorApp('BAD_REQUEST', 'expense_id wajib diisi.');
  if (!alasan) throw errorApp('BAD_REQUEST', 'Alasan pembatalan wajib diisi.');

  return denganKunci(function () {
    var biaya = cariBaris('operational_expenses', 'expense_id', id);
    if (!biaya) throw errorApp('NOT_FOUND', 'Biaya ' + id + ' tidak ditemukan.');

    var jumlah = keAngka_(biaya.amount);
    if (jumlah < 0) {
      throw errorApp('BAD_REQUEST',
        'Baris ini sendiri adalah pembatalan, tidak bisa dibatalkan lagi.');
    }

    var sudah = false;
    bacaTabel('operational_expenses').forEach(function (b) {
      if (keTeks_(b.description).indexOf('pembatalan ' + id) === 0) sudah = true;
    });
    if (sudah) throw errorApp('BAD_REQUEST', 'Biaya ' + id + ' sudah dibatalkan.');

    var baris = [{
      expense_id: idBerikutnya_('operational_expenses', 'expense_id', 'EXP'),
      expense_date: hariIni_(),
      category: keTeks_(biaya.category),
      amount: -jumlah,
      description: 'pembatalan ' + id + ' — ' + alasan,
      created_by: sesi.username
    }];

    tambahBaris('operational_expenses', baris);
    catatAudit(sesi, 'expense.reverse',
      { expense_id: id, amount: jumlah, alasan: alasan }, 'BERHASIL');

    return { expense_id_asli: id, expense_id_pembatalan: baris[0].expense_id };
  });
}


/** expense.list — daftar biaya beserta ringkasan per kategori. */
function expenseList(payload, sesi) {
  var p = payload || {};
  var dari = p.dari ? keTanggalStr_(p.dari) : '';
  var sampai = p.sampai ? keTanggalStr_(p.sampai) : '';
  var filterKategori = keTeks_(p.category);
  var batas = Math.min(Math.round(keAngka_(p.limit)) || 300, 1000);

  var hasil = [];
  var perKategori = {};
  var perBulan = {};
  var total = 0;

  bacaTabel('operational_expenses').forEach(function (b) {
    var tgl = keTanggalStr_(b.expense_date);
    if (dari && tgl < dari) return;
    if (sampai && tgl > sampai) return;

    var kategori = keTeks_(b.category);
    if (filterKategori && kategori !== filterKategori) return;

    var jumlah = keAngka_(b.amount);
    total += jumlah;
    perKategori[kategori] = (perKategori[kategori] || 0) + jumlah;

    var bln = tgl.substring(0, 7);
    perBulan[bln] = (perBulan[bln] || 0) + jumlah;

    hasil.push({
      expense_id: keTeks_(b.expense_id),
      expense_date: tgl,
      category: kategori,
      amount: jumlah,
      description: keTeks_(b.description),
      created_by: keTeks_(b.created_by),
      pembatalan: jumlah < 0
    });
  });

  hasil.sort(function (a, b) {
    if (a.expense_date !== b.expense_date) return a.expense_date < b.expense_date ? 1 : -1;
    return a.expense_id < b.expense_id ? 1 : -1;
  });

  var kategori = [];
  for (var k in perKategori) {
    kategori.push({
      category: k,
      nilai: perKategori[k],
      persen: total > 0 ? Math.round(perKategori[k] / total * 100) : 0
    });
  }
  kategori.sort(function (a, b) { return b.nilai - a.nilai; });

  return {
    daftar: hasil.slice(0, batas),
    jumlah_total: hasil.length,
    dipotong: hasil.length > batas,
    total: total,
    per_kategori: kategori,
    kategori_tersedia: KATEGORI_BIAYA
  };
}


// ---------------------------------------------------------------------------
// Laporan laba rugi
// ---------------------------------------------------------------------------

/**
 * report.profitLoss — laba rugi per bulan. Admin saja.
 *
 * payload: { bulan: 12 }
 *
 *   Omzet          penjualan yang tidak dibatalkan
 *   HPP            unit_cogs yang di-snapshot ke tiap baris item
 *   Laba kotor     omzet dikurangi HPP
 *   Biaya          operational_expenses
 *   Laba bersih    laba kotor dikurangi biaya
 *
 * Yang perlu diingat saat membaca angkanya: HPP diambil dari nilai yang
 * tersimpan di baris transaksi, bukan dari master saat ini. Itu memang
 * disengaja — mengubah HPP di master hari ini tidak boleh mengubah laporan
 * bulan lalu. Konsekuensinya, transaksi lama yang HPP-nya sempat nol akan
 * terlihat berlaba penuh, dan laporan menandainya secara terbuka.
 */
function reportProfitLoss(payload, sesi) {
  var p = payload || {};
  var jumlahBulan = Math.min(Math.max(Math.round(keAngka_(p.bulan)) || 12, 3), 36);

  var orderDipakai = {};
  var bulanOrder = {};

  bacaTabel('sales_orders').forEach(function (o) {
    if (keTeks_(o.status).toLowerCase() === 'cancelled') return;
    var id = keTeks_(o.order_id);
    orderDipakai[id] = true;
    bulanOrder[id] = keTanggalStr_(o.order_date).substring(0, 7);
  });

  var perBulan = {};
  function ember(bln) {
    if (!perBulan[bln]) {
      perBulan[bln] = { omzet: 0, hpp: 0, biaya: 0, invoice: 0, hpp_kosong: 0 };
    }
    return perBulan[bln];
  }

  bacaTabel('sales_orders').forEach(function (o) {
    if (keTeks_(o.status).toLowerCase() === 'cancelled') return;
    var e = ember(keTanggalStr_(o.order_date).substring(0, 7));
    e.omzet += keAngka_(o.subtotal);
    e.invoice++;
  });

  bacaTabel('sales_order_items').forEach(function (it) {
    var id = keTeks_(it.order_id);
    if (!orderDipakai[id]) return;
    var e = ember(bulanOrder[id]);
    var hpp = keAngka_(it.unit_cogs);
    e.hpp += hpp * keAngka_(it.qty);
    if (hpp <= 0) e.hpp_kosong++;
  });

  bacaTabel('operational_expenses').forEach(function (b) {
    var e = ember(keTanggalStr_(b.expense_date).substring(0, 7));
    e.biaya += keAngka_(b.amount);
  });

  // Total seluruh bulan, termasuk yang di luar jendela laporan. Dipakai untuk
  // menyatakan selisihnya secara terbuka — laporan yang totalnya diam-diam
  // berbeda dari Dashboard akan membuat orang meragukan keduanya.
  var omzetSemuaBulan = 0;
  var biayaSemuaBulan = 0;
  for (var b in perBulan) {
    omzetSemuaBulan += perBulan[b].omzet;
    biayaSemuaBulan += perBulan[b].biaya;
  }

  var bulanan = [];
  var kursor = hariIni_().substring(0, 7);
  var total = { omzet: 0, hpp: 0, biaya: 0, invoice: 0, hpp_kosong: 0 };

  for (var i = 0; i < jumlahBulan; i++) {
    var e = perBulan[kursor] || { omzet: 0, hpp: 0, biaya: 0, invoice: 0, hpp_kosong: 0 };
    var labaKotor = e.omzet - e.hpp;

    bulanan.unshift({
      bulan: kursor,
      label: labelBulan_(kursor),
      omzet: e.omzet,
      hpp: e.hpp,
      laba_kotor: labaKotor,
      biaya: e.biaya,
      laba_bersih: labaKotor - e.biaya,
      invoice: e.invoice,
      margin_persen: e.omzet > 0 ? Math.round(labaKotor / e.omzet * 100) : 0,
      hpp_kosong: e.hpp_kosong
    });

    total.omzet += e.omzet;
    total.hpp += e.hpp;
    total.biaya += e.biaya;
    total.invoice += e.invoice;
    total.hpp_kosong += e.hpp_kosong;

    kursor = mundurBulan_(kursor, 1);
  }

  var labaKotorTotal = total.omzet - total.hpp;

  return {
    periode_bulan: jumlahBulan,
    bulanan: bulanan,
    total: {
      omzet: total.omzet,
      hpp: total.hpp,
      laba_kotor: labaKotorTotal,
      biaya: total.biaya,
      laba_bersih: labaKotorTotal - total.biaya,
      invoice: total.invoice,
      margin_kotor_persen: total.omzet > 0
        ? Math.round(labaKotorTotal / total.omzet * 100) : 0,
      margin_bersih_persen: total.omzet > 0
        ? Math.round((labaKotorTotal - total.biaya) / total.omzet * 100) : 0
    },
    // Penanda kejujuran, supaya angka di atas tidak dibaca lebih pasti
    // daripada yang sebenarnya bisa dijamin datanya.
    hpp_lengkap: total.hpp_kosong === 0,
    baris_tanpa_hpp: total.hpp_kosong,
    ada_biaya_tercatat: total.biaya !== 0,

    // Transaksi bertanggal di luar jendela laporan — biasanya salah ketik
    // tahun sehingga tanggalnya jatuh di masa depan. Dinyatakan terbuka
    // supaya selisih dengan Dashboard tidak terlihat seperti kesalahan hitung.
    omzet_di_luar_periode: omzetSemuaBulan - total.omzet,
    biaya_di_luar_periode: biayaSemuaBulan - total.biaya,

    catatan: total.biaya === 0
      ? 'Belum ada biaya operasional yang dicatat, sehingga laba bersih masih ' +
        'sama dengan laba kotor. Angka ini belum menggambarkan keuntungan ' +
        'perusahaan yang sesungguhnya.'
      : ''
  };
}
