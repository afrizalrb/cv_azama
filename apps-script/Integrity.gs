/**
 * Integrity.gs — pemeriksaan keutuhan data.
 *
 * Google Sheets bisa disunting langsung oleh siapa pun yang punya akses.
 * Itu keunggulannya — tim bisa menambal data tanpa menunggu fitur dibuat —
 * sekaligus kelemahannya, karena penyuntingan manual melewati seluruh
 * validasi dan efek samping yang biasanya dikerjakan Apps Script.
 *
 * Contoh paling sering: baris ditambahkan ke sales_orders dan
 * sales_order_items lewat spreadsheet, tapi stock_movements-nya tidak ikut
 * dibuat. Angka penjualan jadi benar sementara stok terlalu banyak, dan
 * selisihnya tidak akan pernah muncul sendiri.
 *
 * Berkas ini tidak memperbaiki apa pun. Ia hanya melaporkan, karena menebak
 * maksud orang yang menyunting manual jauh lebih berbahaya daripada
 * membiarkan mereka memutuskan sendiri.
 */

var TINGKAT = { PARAH: 'parah', PERINGATAN: 'peringatan', CATATAN: 'catatan' };


/**
 * system.integrity — periksa seluruh tab, laporkan temuan.
 *
 * payload: { perbaiki_stok: false }
 *
 * Bila perbaiki_stok true, order yang tidak punya mutasi stok akan dibuatkan
 * mutasinya. Itu satu-satunya perbaikan otomatis yang disediakan, karena
 * satu-satunya yang maksudnya tidak ambigu: penjualan yang tercatat pasti
 * mengurangi stok. Selebihnya dilaporkan saja.
 */
function systemIntegrity(payload, sesi) {
  var p = payload || {};
  var temuan = [];

  function lapor(tingkat, kode, pesan, contoh) {
    temuan.push({
      tingkat: tingkat,
      kode: kode,
      pesan: pesan,
      jumlah: contoh ? contoh.length : 0,
      contoh: contoh ? contoh.slice(0, 10) : []
    });
  }

  var orders = bacaTabel('sales_orders');
  var items = bacaTabel('sales_order_items');
  var mutasi = bacaTabel('stock_movements');
  var galon = bacaTabel('gallon_ledger');
  var produk = bacaTabel('products');
  var customers = bacaTabel('customers');
  var bayar = bacaTabel('payments');

  // --- ID kembar -----------------------------------------------------------
  // Penomoran otomatis membaca nomor tertinggi lalu menambah satu. Kalau ada
  // ID kembar, biasanya karena baris disisipkan manual dengan ID yang sudah
  // dipakai, dan baris berikutnya akan menabraknya lagi.
  [['sales_orders', orders, 'order_id'],
   ['sales_orders', orders, 'invoice_no'],
   ['sales_order_items', items, 'item_id'],
   ['stock_movements', mutasi, 'movement_id'],
   ['gallon_ledger', galon, 'ledger_id'],
   ['products', produk, 'code'],
   ['customers', customers, 'code']].forEach(function (t) {
    var kembar = cariKembar_(t[1], t[2]);
    if (kembar.length) {
      lapor(TINGKAT.PARAH, 'ID_KEMBAR',
        t[0] + ' punya nilai ' + t[2] + ' yang kembar. Penomoran otomatis akan ' +
        'menabraknya lagi pada penulisan berikutnya.', kembar);
    }
  });

  // --- referensi yatim -----------------------------------------------------
  var kodeCust = kumpulan_(customers, 'code');
  var kodeProd = kumpulan_(produk, 'code');
  var idOrder = kumpulan_(orders, 'order_id');

  var orderYatim = orders.filter(function (o) {
    return !kodeCust[keTeks_(o.customer_code).toUpperCase()];
  }).map(function (o) { return keTeks_(o.invoice_no) + ' → ' + keTeks_(o.customer_code); });
  if (orderYatim.length) {
    lapor(TINGKAT.PARAH, 'CUSTOMER_TIDAK_ADA',
      'Ada penjualan yang menunjuk customer tidak terdaftar.', orderYatim);
  }

  var itemYatim = items.filter(function (it) {
    return !idOrder[keTeks_(it.order_id)];
  }).map(function (it) { return keTeks_(it.item_id) + ' → ' + keTeks_(it.order_id); });
  if (itemYatim.length) {
    lapor(TINGKAT.PARAH, 'ORDER_TIDAK_ADA',
      'Ada baris item yang menunjuk order tidak terdaftar. Nilainya ikut ' +
      'terhitung di laporan produk, tapi tidak di laporan penjualan.', itemYatim);
  }

  var produkYatim = items.filter(function (it) {
    return !kodeProd[keTeks_(it.product_code).toUpperCase()];
  }).map(function (it) { return keTeks_(it.item_id) + ' → ' + keTeks_(it.product_code); });
  if (produkYatim.length) {
    lapor(TINGKAT.PARAH, 'PRODUK_TIDAK_ADA',
      'Ada baris item yang menunjuk produk tidak terdaftar.', produkYatim);
  }

  var bayarYatim = bayar.filter(function (b) {
    return !idOrder[keTeks_(b.order_id)];
  }).map(function (b) { return keTeks_(b.payment_id) + ' → ' + keTeks_(b.order_id); });
  if (bayarYatim.length) {
    lapor(TINGKAT.PARAH, 'PEMBAYARAN_YATIM',
      'Ada pembayaran yang menunjuk order tidak terdaftar.', bayarYatim);
  }

  // --- penjualan tanpa mutasi stok ----------------------------------------
  // Inilah yang paling sering terjadi setelah penyuntingan manual.
  var adaMutasi = {};
  mutasi.forEach(function (m) {
    if (keTeks_(m.ref_type) === 'sales_order') {
      adaMutasi[keTeks_(m.ref_id)] = true;
    }
  });

  var tanpaMutasi = orders.filter(function (o) {
    return keTeks_(o.status).toLowerCase() !== 'cancelled' &&
           !adaMutasi[keTeks_(o.order_id)];
  });

  // Order hasil migrasi memang sengaja tidak punya mutasi — stok awalnya
  // sudah memperhitungkan seluruh penjualan lama. Dibedakan lewat created_by.
  var tanpaMutasiBaru = tanpaMutasi.filter(function (o) {
    return keTeks_(o.created_by).toLowerCase() !== 'migration';
  });
  var tanpaMutasiMigrasi = tanpaMutasi.length - tanpaMutasiBaru.length;

  if (tanpaMutasiBaru.length) {
    // Bukan soal stok — model bisnisnya pre-order, jadi angka stok memang
    // tidak dipakai. Yang ditandai di sini adalah gejalanya: penjualan yang
    // masuk tanpa melewati sales.create hampir pasti disisipkan langsung di
    // spreadsheet, dan baris seperti itu juga melewati seluruh validasi lain.
    lapor(TINGKAT.PERINGATAN, 'DIBUAT_DI_LUAR_SISTEM',
      'Ada penjualan yang tidak punya baris mutasi barang keluar. Biasanya ' +
      'berarti barisnya ditambahkan langsung di spreadsheet, bukan lewat menu ' +
      'Penjualan — sehingga tidak melewati validasi harga, jatuh tempo, ' +
      'maupun pencatatan galon.',
      tanpaMutasiBaru.map(function (o) {
        return keTeks_(o.invoice_no) + ' (' + keTeks_(o.created_by) + ')';
      }));
  }

  // --- order tanpa item ----------------------------------------------------
  var punyaItem = {};
  items.forEach(function (it) { punyaItem[keTeks_(it.order_id)] = true; });
  var tanpaItem = orders.filter(function (o) {
    return !punyaItem[keTeks_(o.order_id)];
  }).map(function (o) { return keTeks_(o.invoice_no); });
  if (tanpaItem.length) {
    lapor(TINGKAT.PARAH, 'ORDER_TANPA_ITEM',
      'Ada penjualan tanpa satu pun baris produk. Nilainya masuk laporan ' +
      'penjualan tapi tidak bisa ditelusuri isinya.', tanpaItem);
  }

  // --- subtotal tidak cocok ------------------------------------------------
  var totalItem = {};
  items.forEach(function (it) {
    var id = keTeks_(it.order_id);
    totalItem[id] = (totalItem[id] || 0) + keAngka_(it.line_total);
  });
  var subtotalBeda = orders.filter(function (o) {
    var id = keTeks_(o.order_id);
    if (!punyaItem[id]) return false;
    return Math.abs(keAngka_(o.subtotal) - (totalItem[id] || 0)) > 0.5;
  }).map(function (o) {
    var id = keTeks_(o.order_id);
    return keTeks_(o.invoice_no) + ': header ' +
      Math.round(keAngka_(o.subtotal)).toLocaleString('id-ID') + ' vs item ' +
      Math.round(totalItem[id] || 0).toLocaleString('id-ID');
  });
  if (subtotalBeda.length) {
    lapor(TINGKAT.PARAH, 'SUBTOTAL_TIDAK_COCOK',
      'Subtotal di baris penjualan berbeda dari jumlah item-nya. Laporan omzet ' +
      'dan laporan produk akan menghasilkan angka berbeda.', subtotalBeda);
  }

  // --- line_total tidak cocok qty x harga ----------------------------------
  var lineBeda = items.filter(function (it) {
    var seharusnya = keAngka_(it.qty) * keAngka_(it.unit_price);
    return Math.abs(keAngka_(it.line_total) - seharusnya) > 0.5;
  }).map(function (it) {
    return keTeks_(it.item_id) + ': ' + keAngka_(it.qty) + ' x ' +
      Math.round(keAngka_(it.unit_price)).toLocaleString('id-ID') + ' ≠ ' +
      Math.round(keAngka_(it.line_total)).toLocaleString('id-ID');
  });
  if (lineBeda.length) {
    lapor(TINGKAT.PARAH, 'LINE_TOTAL_SALAH',
      'Ada baris item yang total-nya bukan hasil qty dikali harga satuan.', lineBeda);
  }

  // --- tanggal ------------------------------------------------------------
  var hariIni = hariIni_();
  var tglRusak = [];
  var tglDepan = [];
  var tglTakCocokNomor = [];

  orders.forEach(function (o) {
    var inv = keTeks_(o.invoice_no);
    var tgl = keTanggalStr_(o.order_date);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(tgl)) {
      tglRusak.push(inv + ': "' + tgl + '"');
      return;
    }
    if (tgl > hariIni) tglDepan.push(inv + ': ' + tgl);

    var cocok = inv.match(/^INV(\d{2})(\d{2})\d{3}$/);
    if (cocok && (tgl.substring(2, 4) !== cocok[1] || tgl.substring(5, 7) !== cocok[2])) {
      tglTakCocokNomor.push(inv + ' bertanggal ' + tgl);
    }

    var jatuh = keTanggalStr_(o.due_date);
    if (jatuh && jatuh < tgl) {
      tglRusak.push(inv + ': jatuh tempo ' + jatuh + ' sebelum tanggal order ' + tgl);
    }
  });

  if (tglRusak.length) {
    lapor(TINGKAT.PARAH, 'TANGGAL_RUSAK',
      'Ada tanggal yang bentuknya tidak sah atau tidak masuk akal. Perhitungan ' +
      'aging piutang akan salah pada baris ini.', tglRusak);
  }
  if (tglDepan.length) {
    lapor(TINGKAT.PERINGATAN, 'TANGGAL_MASA_DEPAN',
      'Ada penjualan bertanggal setelah hari ini. Biasanya salah ketik tahun.',
      tglDepan);
  }
  if (tglTakCocokNomor.length) {
    lapor(TINGKAT.PERINGATAN, 'TANGGAL_TIDAK_COCOK_NOMOR',
      'Nomor invoice memuat tahun dan bulannya sendiri, dan tidak cocok dengan ' +
      'kolom tanggal. Yang lebih sering salah adalah tanggalnya.',
      tglTakCocokNomor);
  }

  // Saldo stok minus sengaja TIDAK diperiksa.
  //
  // Model bisnisnya pre-order: produksi mengikuti pesanan yang masuk, tidak
  // ada penyetokan barang jadi. Barang keluar tercatat sejak Fase 1,
  // sedangkan produksi masuk baru dicatat mulai Fase 4. Selama rentang itu
  // saldo setiap produk pasti minus, dan memperingatkannya akan menyalakan
  // alert untuk seluruh produk setiap hari. Peringatan yang selalu menyala
  // adalah peringatan yang berhenti dibaca.

  // --- mutasi menunjuk produk tidak ada ------------------------------------
  var mutasiYatim = mutasi.filter(function (m) {
    return keTeks_(m.item_type) === 'product' &&
           !kodeProd[keTeks_(m.item_code).toUpperCase()];
  }).map(function (m) {
    return keTeks_(m.movement_id) + ' → ' + keTeks_(m.item_code);
  });
  if (mutasiYatim.length) {
    lapor(TINGKAT.PERINGATAN, 'MUTASI_PRODUK_TIDAK_ADA',
      'Ada mutasi stok untuk produk yang tidak terdaftar di master.', mutasiYatim);
  }

  // --- pembayaran melebihi tagihan ----------------------------------------
  var totalBayar = totalBayarPerOrder_();
  var lebihBayar = orders.filter(function (o) {
    return (totalBayar[keTeks_(o.order_id)] || 0) - keAngka_(o.subtotal) > 0.5;
  }).map(function (o) {
    return keTeks_(o.invoice_no) + ': dibayar ' +
      Math.round(totalBayar[keTeks_(o.order_id)]).toLocaleString('id-ID') +
      ' dari tagihan ' + Math.round(keAngka_(o.subtotal)).toLocaleString('id-ID');
  });
  if (lebihBayar.length) {
    lapor(TINGKAT.PERINGATAN, 'LEBIH_BAYAR',
      'Ada invoice yang pembayarannya melebihi tagihan.', lebihBayar);
  }

  // --- status tidak konsisten dengan pembayaran ---------------------------
  // Hanya diperiksa untuk order yang punya baris pembayaran. Order hasil
  // migrasi berstatus lunas tanpa pembayaran memang begitu adanya.
  var statusJanggal = orders.filter(function (o) {
    var dibayar = totalBayar[keTeks_(o.order_id)] || 0;
    if (dibayar <= 0) return false;
    var status = keTeks_(o.status).toLowerCase();
    var subtotal = keAngka_(o.subtotal);
    if (dibayar >= subtotal - 0.5 && status !== 'paid') return true;
    if (dibayar < subtotal - 0.5 && status === 'paid') return true;
    return false;
  }).map(function (o) {
    return keTeks_(o.invoice_no) + ': status ' + keTeks_(o.status) + ', dibayar ' +
      Math.round(totalBayar[keTeks_(o.order_id)]).toLocaleString('id-ID') +
      ' dari ' + Math.round(keAngka_(o.subtotal)).toLocaleString('id-ID');
  });
  if (statusJanggal.length) {
    lapor(TINGKAT.PERINGATAN, 'STATUS_TIDAK_COCOK_PEMBAYARAN',
      'Status invoice tidak sesuai dengan jumlah pembayarannya.', statusJanggal);
  }

  // --- saldo galon negatif -------------------------------------------------
  var saldoGalon = {};
  galon.forEach(function (g) {
    var kode = keTeks_(g.customer_code).toUpperCase();
    saldoGalon[kode] = (saldoGalon[kode] || 0) + keAngka_(g.qty);
  });
  var galonMinus = [];
  for (var kc in saldoGalon) {
    if (saldoGalon[kc] < 0) galonMinus.push(kc + ': ' + saldoGalon[kc]);
  }
  if (galonMinus.length) {
    lapor(TINGKAT.PERINGATAN, 'SALDO_GALON_NEGATIF',
      'Ada customer dengan saldo galon minus, artinya mengembalikan lebih ' +
      'banyak daripada yang pernah dibawa.', galonMinus);
  }

  // --- catatan yang bukan kesalahan ---------------------------------------
  if (tanpaMutasiMigrasi > 0) {
    lapor(TINGKAT.CATATAN, 'MIGRASI_TANPA_MUTASI',
      tanpaMutasiMigrasi + ' penjualan hasil migrasi sengaja tidak punya mutasi ' +
      'stok. Stok awal di stock_movements sudah memperhitungkan seluruh ' +
      'penjualan lama, jadi menuliskannya lagi akan menghitung ganda.', null);
  }

  var hppKosong = produk.filter(function (pr) {
    return keBool_(pr.is_active) && keAngka_(pr.cogs) <= 0;
  }).map(function (pr) { return keTeks_(pr.code); });
  if (hppKosong.length) {
    lapor(TINGKAT.PERINGATAN, 'HPP_KOSONG',
      'Ada produk aktif yang HPP-nya masih nol. Laporan margin untuk produk ' +
      'ini akan terlihat untung 100%.', hppKosong);
  }

  // Stok minimum tidak diperiksa — tidak ada alert stok pada model pre-order.

  // --- perbaikan opsional --------------------------------------------------
  var diperbaiki = null;
  if (p.perbaiki_stok === true && tanpaMutasiBaru.length) {
    diperbaiki = perbaikiMutasiStok_(tanpaMutasiBaru, items, sesi);
  }

  var jumlah = { parah: 0, peringatan: 0, catatan: 0 };
  temuan.forEach(function (t) { jumlah[t.tingkat]++; });

  catatAudit(sesi, 'system.integrity',
    { perbaiki_stok: p.perbaiki_stok === true },
    jumlah.parah + ' parah, ' + jumlah.peringatan + ' peringatan');

  return {
    sehat: jumlah.parah === 0 && jumlah.peringatan === 0,
    jumlah: jumlah,
    temuan: temuan,
    diperbaiki: diperbaiki,
    diperiksa_pada: sekarang_(),
    jumlah_baris: {
      sales_orders: orders.length,
      sales_order_items: items.length,
      stock_movements: mutasi.length,
      gallon_ledger: galon.length,
      payments: bayar.length
    }
  };
}


/**
 * Buatkan mutasi stok untuk penjualan yang belum punya.
 *
 * Satu-satunya perbaikan otomatis yang disediakan, karena maksudnya tidak
 * ambigu: penjualan yang tercatat pasti mengurangi stok. Tanggal mutasi
 * mengikuti tanggal penjualannya, bukan hari ini, supaya laporan per periode
 * tetap benar.
 */
function perbaikiMutasiStok_(orderTanpaMutasi, semuaItem, sesi) {
  return denganKunci(function () {
    var perOrder = {};
    semuaItem.forEach(function (it) {
      var id = keTeks_(it.order_id);
      if (!perOrder[id]) perOrder[id] = [];
      perOrder[id].push(it);
    });

    var nomor = nomorAwal_('stock_movements', 'movement_id', 'MOV');
    var saatIni = sekarang_();
    var baris = [];
    var invoice = [];

    orderTanpaMutasi.forEach(function (o) {
      var id = keTeks_(o.order_id);
      var daftarItem = perOrder[id] || [];
      if (!daftarItem.length) return;

      invoice.push(keTeks_(o.invoice_no));
      daftarItem.forEach(function (it) {
        baris.push({
          movement_id: idDari_('MOV', nomor++),
          moved_at: keTanggalStr_(o.order_date),
          item_type: 'product',
          item_code: keTeks_(it.product_code).toUpperCase(),
          qty: -keAngka_(it.qty),
          movement_type: 'sale_out',
          ref_type: 'sales_order',
          ref_id: id,
          notes: 'Ditambahkan oleh pemeriksa integritas — penjualan ' +
                 keTeks_(o.invoice_no) + ' sebelumnya tidak punya mutasi stok',
          created_by: sesi.username,
          created_at: saatIni
        });
      });
    });

    if (baris.length) tambahBaris('stock_movements', baris);

    catatAudit(sesi, 'system.integrity.perbaiki',
      { invoice: invoice, baris: baris.length }, 'BERHASIL');

    return {
      invoice_diperbaiki: invoice,
      baris_mutasi_ditambahkan: baris.length
    };
  });
}


/* --- pembantu -------------------------------------------------------------- */

function cariKembar_(baris, kolom) {
  var hitung = {};
  baris.forEach(function (b) {
    var v = keTeks_(b[kolom]).toUpperCase();
    if (!v) return;
    hitung[v] = (hitung[v] || 0) + 1;
  });
  var hasil = [];
  for (var v in hitung) {
    if (hitung[v] > 1) hasil.push(v + ' (' + hitung[v] + ' baris)');
  }
  return hasil;
}

function kumpulan_(baris, kolom) {
  var set = {};
  baris.forEach(function (b) {
    var v = keTeks_(b[kolom]).toUpperCase();
    if (v) set[v] = true;
  });
  return set;
}
