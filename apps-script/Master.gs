/**
 * Master.gs — data master: produk, customer, dan harga khusus.
 *
 * Pola izin di seluruh berkas ini:
 *   list   — semua role yang sudah login, karena form penjualan
 *            membutuhkannya. Isi yang dikembalikan tetap disaring per role.
 *   upsert — admin saja. Mengubah harga master memengaruhi seluruh penjualan
 *            berikutnya, jadi bukan wewenang sales.
 *
 * Semua penghapusan bersifat lunak lewat kolom is_active. Menghapus baris
 * produk yang pernah terjual akan membuat seluruh invoice lama menunjuk
 * sesuatu yang tidak ada.
 */


// ---------------------------------------------------------------------------
// Produk
// ---------------------------------------------------------------------------

/**
 * master.products.list
 *
 * payload: { termasuk_nonaktif: false }
 *
 * Stok saat ini dihitung dari stock_movements, bukan disimpan di kolom mana
 * pun. Sekali agregasi untuk seluruh produk, bukan sekali per produk.
 */
function masterProductsList(payload, sesi) {
  var p = payload || {};
  var termasukNonaktif = p.termasuk_nonaktif === true;

  var stok = {};
  bacaTabel('stock_movements').forEach(function (m) {
    if (keTeks_(m.item_type) !== 'product') return;
    var kode = keTeks_(m.item_code).toUpperCase();
    stok[kode] = (stok[kode] || 0) + keAngka_(m.qty);
  });

  var daftar = [];
  bacaTabel('products').forEach(function (pr) {
    var aktif = keBool_(pr.is_active);
    if (!aktif && !termasukNonaktif) return;

    var kode = keTeks_(pr.code).toUpperCase();
    var hpp = keAngka_(pr.cogs);
    var harga = keAngka_(pr.price);

    daftar.push({
      code: kode,
      name: keTeks_(pr.name),
      packaging_type: keTeks_(pr.packaging_type),
      volume_ml: keAngka_(pr.volume_ml),
      cogs: hpp,
      price: harga,
      min_stock: keAngka_(pr.min_stock),
      is_returnable: keBool_(pr.is_returnable),
      deposit_amount: keAngka_(pr.deposit_amount),
      is_active: aktif,
      // Saldo mutasi, bukan "stok tersedia".
      //
      // Model bisnisnya pre-order — produksi mengikuti pesanan, tidak ada
      // penyetokan barang jadi. Angka ini tetap dihitung karena buku besar
      // mutasi tetap diisi, dan akan bermakna begitu batch produksi dicatat
      // di Fase 4. Sampai saat itu nilainya wajar minus, dan frontend
      // sengaja tidak menampilkannya.
      saldo_mutasi: stok[kode] || 0,
      margin: harga - hpp,
      margin_persen: harga > 0 ? Math.round((harga - hpp) / harga * 100) : 0,
      hpp_terisi: hpp > 0
    });
  });

  daftar.sort(function (a, b) { return a.code < b.code ? -1 : 1; });
  return { daftar: daftar, jumlah: daftar.length };
}


/**
 * master.products.upsert — admin saja.
 *
 * Kode produk tidak bisa diubah. Mengubahnya akan memutus seluruh baris
 * sales_order_items dan stock_movements yang menunjuk kode lama, tanpa ada
 * cara sistem mengetahui bahwa keduanya sebenarnya barang yang sama.
 */
function masterProductsUpsert(payload, sesi) {
  var p = payload || {};
  var kode = keTeks_(p.code).toUpperCase();

  if (!kode) throw errorApp('BAD_REQUEST', 'Kode produk wajib diisi.');
  if (!/^[A-Z0-9]{2,12}$/.test(kode)) {
    throw errorApp('BAD_REQUEST',
      'Kode produk hanya boleh huruf besar dan angka, 2 sampai 12 karakter.');
  }

  var nama = keTeks_(p.name);
  if (!nama) throw errorApp('BAD_REQUEST', 'Nama produk wajib diisi.');

  var harga = Math.round(keAngka_(p.price));
  var hpp = Math.round(keAngka_(p.cogs));
  if (harga < 0 || hpp < 0) {
    throw errorApp('BAD_REQUEST', 'Harga dan HPP tidak boleh negatif.');
  }
  if (hpp > 0 && harga > 0 && hpp > harga) {
    throw errorApp('BAD_REQUEST',
      'HPP (' + hpp.toLocaleString('id-ID') + ') lebih besar dari harga jual (' +
      harga.toLocaleString('id-ID') + '). Periksa lagi angkanya.');
  }

  return denganKunci(function () {
    var ada = cariBaris('products', 'code', kode);

    var nilai = {
      code: kode,
      name: nama,
      packaging_type: keTeks_(p.packaging_type),
      volume_ml: Math.round(keAngka_(p.volume_ml)),
      cogs: hpp,
      price: harga,
      min_stock: Math.round(keAngka_(p.min_stock)),
      is_returnable: p.is_returnable === true || keTeks_(p.is_returnable) === 'TRUE',
      deposit_amount: Math.round(keAngka_(p.deposit_amount)),
      is_active: p.is_active === undefined ? true : p.is_active === true
    };

    if (ada) {
      var perubahan = {};
      for (var k in nilai) {
        if (k !== 'code') perubahan[k] = nilai[k];
      }
      perbaruiBaris('products', 'code', kode, perubahan);
      catatAudit(sesi, 'master.products.upsert', { code: kode }, 'DIPERBARUI');
      return { code: kode, dibuat: false };
    }

    tambahBaris('products', [nilai]);
    catatAudit(sesi, 'master.products.upsert', { code: kode }, 'DIBUAT');
    return { code: kode, dibuat: true };
  });
}


// ---------------------------------------------------------------------------
// Customer
// ---------------------------------------------------------------------------

/**
 * master.customers.list
 *
 * Role sales hanya menerima customer miliknya. Penyaringan dilakukan di sini,
 * bukan dengan menyembunyikan baris di frontend — data yang tidak berhak
 * dilihat tidak boleh sampai terkirim.
 */
function masterCustomersList(payload, sesi) {
  var p = payload || {};
  var termasukNonaktif = p.termasuk_nonaktif === true;
  var cari = keTeks_(p.cari).toLowerCase();

  // Ringkasan transaksi per customer, dihitung sekali untuk semuanya.
  var ringkas = {};
  var bayar = totalBayarPerOrder_();
  bacaTabel('sales_orders').forEach(function (o) {
    if (keTeks_(o.status).toLowerCase() === 'cancelled') return;
    var kode = keTeks_(o.customer_code).toUpperCase();
    if (!ringkas[kode]) {
      ringkas[kode] = { jumlah_invoice: 0, nilai: 0, sisa: 0, terakhir: '' };
    }
    var r = ringkas[kode];
    var subtotal = keAngka_(o.subtotal);
    r.jumlah_invoice++;
    r.nilai += subtotal;

    // Invoice berstatus 'paid' tidak dihitung sebagai piutang meski tabel
    // payments kosong. Seluruh invoice historis ditandai lunas saat migrasi
    // tanpa rincian pembayarannya. Tanpa pengecualian ini, setiap customer
    // lama akan terlihat menunggak sebesar seluruh transaksinya sejak 2024.
    if (keTeks_(o.status).toLowerCase() !== 'paid') {
      r.sisa += subtotal - (bayar[keTeks_(o.order_id)] || 0);
    }

    var tgl = keTanggalStr_(o.order_date);
    if (tgl > r.terakhir) r.terakhir = tgl;
  });

  // Saldo galon: positif berarti masih dipegang customer.
  var galon = {};
  bacaTabel('gallon_ledger').forEach(function (g) {
    var kode = keTeks_(g.customer_code).toUpperCase();
    galon[kode] = (galon[kode] || 0) + keAngka_(g.qty);
  });

  var daftar = [];
  bacaTabel('customers').forEach(function (c) {
    if (!bolehLihatCustomer_(c, sesi)) return;

    var aktif = keBool_(c.is_active);
    if (!aktif && !termasukNonaktif) return;

    var kode = keTeks_(c.code).toUpperCase();
    var nama = keTeks_(c.name);
    if (cari && nama.toLowerCase().indexOf(cari) < 0 &&
        kode.toLowerCase().indexOf(cari) < 0) return;

    var r = ringkas[kode] || { jumlah_invoice: 0, nilai: 0, sisa: 0, terakhir: '' };

    daftar.push({
      code: kode,
      name: nama,
      area: keTeks_(c.area),
      type: keTeks_(c.type),
      payment_term_days: Math.round(keAngka_(c.payment_term_days)) || 30,
      phone: keTeks_(c.phone),
      sales_person: keTeks_(c.sales_person),
      is_active: aktif,
      jumlah_invoice: r.jumlah_invoice,
      nilai_transaksi: r.nilai,
      piutang: r.sisa,
      transaksi_terakhir: r.terakhir,
      saldo_galon: galon[kode] || 0
    });
  });

  daftar.sort(function (a, b) { return a.code < b.code ? -1 : 1; });
  return { daftar: daftar, jumlah: daftar.length };
}


/** master.customers.upsert — admin saja. */
function masterCustomersUpsert(payload, sesi) {
  var p = payload || {};
  var kode = keTeks_(p.code).toUpperCase();

  if (!kode) throw errorApp('BAD_REQUEST', 'Kode customer wajib diisi.');
  if (!/^[A-Z0-9]{3,16}$/.test(kode)) {
    throw errorApp('BAD_REQUEST',
      'Kode customer hanya boleh huruf besar dan angka, 3 sampai 16 karakter. ' +
      'Contoh: 22C26MLG');
  }

  var nama = keTeks_(p.name);
  if (!nama) throw errorApp('BAD_REQUEST', 'Nama customer wajib diisi.');

  var tempo = Math.round(keAngka_(p.payment_term_days));
  if (tempo < 0 || tempo > 365) {
    throw errorApp('BAD_REQUEST', 'Tempo pembayaran harus antara 0 dan 365 hari.');
  }

  return denganKunci(function () {
    var ada = cariBaris('customers', 'code', kode);

    var nilai = {
      code: kode,
      name: nama,
      area: keTeks_(p.area),
      type: keTeks_(p.type),
      payment_term_days: tempo || 30,
      phone: keTeks_(p.phone),
      sales_person: keTeks_(p.sales_person),
      is_active: p.is_active === undefined ? true : p.is_active === true
    };

    if (ada) {
      var perubahan = {};
      for (var k in nilai) {
        if (k !== 'code') perubahan[k] = nilai[k];
      }
      perbaruiBaris('customers', 'code', kode, perubahan);
      catatAudit(sesi, 'master.customers.upsert', { code: kode }, 'DIPERBARUI');
      return { code: kode, dibuat: false };
    }

    tambahBaris('customers', [nilai]);
    catatAudit(sesi, 'master.customers.upsert', { code: kode }, 'DIBUAT');
    return { code: kode, dibuat: true };
  });
}


// ---------------------------------------------------------------------------
// Harga khusus
// ---------------------------------------------------------------------------

/**
 * master.customerPrices.list
 *
 * Kalau customer_code diisi, hanya harga milik customer itu yang dikembalikan.
 * Form penjualan memakai bentuk ini untuk menampilkan harga yang benar
 * sebelum invoice dibuat — meski angka yang akhirnya tersimpan tetap
 * ditentukan ulang di server.
 */
function masterCustomerPricesList(payload, sesi) {
  var p = payload || {};
  var filter = keTeks_(p.customer_code).toUpperCase();

  var petaProduk = petaBerdasarkan('products', 'code');
  var petaCust = petaBerdasarkan('customers', 'code');

  var daftar = [];
  bacaTabel('customer_prices').forEach(function (h) {
    var kodeCust = keTeks_(h.customer_code).toUpperCase();
    if (filter && kodeCust !== filter) return;
    if (!bolehLihatCustomer_(petaCust[kodeCust], sesi)) return;

    var kodeProd = keTeks_(h.product_code).toUpperCase();
    var produk = petaProduk[kodeProd];
    var khusus = keAngka_(h.special_price);
    var normal = produk ? keAngka_(produk.price) : 0;

    daftar.push({
      customer_code: kodeCust,
      customer_name: petaCust[kodeCust] ? keTeks_(petaCust[kodeCust].name) : '',
      product_code: kodeProd,
      nama_produk: produk ? keTeks_(produk.name) : '(produk terhapus)',
      special_price: khusus,
      harga_normal: normal,
      selisih: khusus - normal
    });
  });

  return { daftar: daftar, jumlah: daftar.length };
}


// ---------------------------------------------------------------------------
// Bahan baku
// ---------------------------------------------------------------------------

/**
 * master.materials.list
 *
 * Sengaja tanpa saldo persediaan. Model bisnisnya pre-order, dan STOK_BAHAN
 * di Excel lama pun hanya berisi nama item tanpa satu pun angka — jumlah
 * bahan memang tidak pernah dilacak. Yang berguna sekarang adalah daftar
 * bakunya: nama, satuan, dan pemasoknya, supaya pembelian bisa dicatat
 * dengan istilah yang seragam.
 */
function masterMaterialsList(payload, sesi) {
  var daftar = bacaTabel('materials').map(function (m) {
    return {
      code: keTeks_(m.code).toUpperCase(),
      name: keTeks_(m.name),
      unit: keTeks_(m.unit),
      min_stock: keAngka_(m.min_stock)
    };
  });
  daftar.sort(function (a, b) { return a.code < b.code ? -1 : 1; });
  return { daftar: daftar, jumlah: daftar.length };
}


/** master.materials.upsert — admin saja. */
function masterMaterialsUpsert(payload, sesi) {
  var p = payload || {};
  var kode = keTeks_(p.code).toUpperCase();
  var nama = keTeks_(p.name);

  if (!kode) throw errorApp('BAD_REQUEST', 'Kode bahan wajib diisi.');
  if (!/^[A-Z0-9]{2,12}$/.test(kode)) {
    throw errorApp('BAD_REQUEST',
      'Kode bahan hanya boleh huruf besar dan angka, 2 sampai 12 karakter.');
  }
  if (!nama) throw errorApp('BAD_REQUEST', 'Nama bahan wajib diisi.');

  return denganKunci(function () {
    var nilai = {
      code: kode,
      name: nama,
      unit: keTeks_(p.unit) || 'pcs',
      min_stock: Math.round(keAngka_(p.min_stock))
    };

    if (cariBaris('materials', 'code', kode)) {
      perbaruiBaris('materials', 'code', kode,
        { name: nilai.name, unit: nilai.unit, min_stock: nilai.min_stock });
      catatAudit(sesi, 'master.materials.upsert', { code: kode }, 'DIPERBARUI');
      return { code: kode, dibuat: false };
    }

    tambahBaris('materials', [nilai]);
    catatAudit(sesi, 'master.materials.upsert', { code: kode }, 'DIBUAT');
    return { code: kode, dibuat: true };
  });
}


// ---------------------------------------------------------------------------
// Supplier
// ---------------------------------------------------------------------------

/** master.suppliers.list */
function masterSuppliersList(payload, sesi) {
  var daftar = bacaTabel('suppliers').map(function (s) {
    return {
      code: keTeks_(s.code).toUpperCase(),
      name: keTeks_(s.name),
      address: keTeks_(s.address),
      phone: keTeks_(s.phone),
      payment_term_days: Math.round(keAngka_(s.payment_term_days))
    };
  });
  daftar.sort(function (a, b) { return a.code < b.code ? -1 : 1; });
  return { daftar: daftar, jumlah: daftar.length };
}


/** master.suppliers.upsert — admin saja. */
function masterSuppliersUpsert(payload, sesi) {
  var p = payload || {};
  var kode = keTeks_(p.code).toUpperCase();
  var nama = keTeks_(p.name);

  if (!kode) throw errorApp('BAD_REQUEST', 'Kode supplier wajib diisi.');
  if (!/^[A-Z0-9]{2,16}$/.test(kode)) {
    throw errorApp('BAD_REQUEST',
      'Kode supplier hanya boleh huruf besar dan angka, 2 sampai 16 karakter.');
  }
  if (!nama) throw errorApp('BAD_REQUEST', 'Nama supplier wajib diisi.');

  var tempo = Math.round(keAngka_(p.payment_term_days));
  if (tempo < 0 || tempo > 365) {
    throw errorApp('BAD_REQUEST', 'Tempo pembayaran harus antara 0 dan 365 hari.');
  }

  return denganKunci(function () {
    var nilai = {
      code: kode,
      name: nama,
      address: keTeks_(p.address),
      phone: keTeks_(p.phone),
      payment_term_days: tempo
    };

    if (cariBaris('suppliers', 'code', kode)) {
      perbaruiBaris('suppliers', 'code', kode, {
        name: nilai.name, address: nilai.address,
        phone: nilai.phone, payment_term_days: nilai.payment_term_days
      });
      catatAudit(sesi, 'master.suppliers.upsert', { code: kode }, 'DIPERBARUI');
      return { code: kode, dibuat: false };
    }

    tambahBaris('suppliers', [nilai]);
    catatAudit(sesi, 'master.suppliers.upsert', { code: kode }, 'DIBUAT');
    return { code: kode, dibuat: true };
  });
}


/** master.customerPrices.upsert — admin saja. */
function masterCustomerPricesUpsert(payload, sesi) {
  var p = payload || {};
  var kodeCust = keTeks_(p.customer_code).toUpperCase();
  var kodeProd = keTeks_(p.product_code).toUpperCase();
  var harga = Math.round(keAngka_(p.special_price));

  if (!kodeCust || !kodeProd) {
    throw errorApp('BAD_REQUEST', 'Customer dan produk wajib dipilih.');
  }
  if (harga <= 0) {
    throw errorApp('BAD_REQUEST',
      'Harga khusus harus lebih dari nol. Untuk menghapus kesepakatan harga, ' +
      'hapus barisnya langsung di spreadsheet.');
  }

  return denganKunci(function () {
    if (!cariBaris('customers', 'code', kodeCust)) {
      throw errorApp('NOT_FOUND', 'Customer ' + kodeCust + ' tidak ada.');
    }
    var produk = cariBaris('products', 'code', kodeProd);
    if (!produk) {
      throw errorApp('NOT_FOUND', 'Produk ' + kodeProd + ' tidak ada.');
    }

    var hpp = keAngka_(produk.cogs);
    if (hpp > 0 && harga < hpp) {
      throw errorApp('BAD_REQUEST',
        'Harga khusus Rp ' + harga.toLocaleString('id-ID') + ' di bawah HPP Rp ' +
        Math.round(hpp).toLocaleString('id-ID') + '. Penjualan akan rugi.');
    }

    // Sheets tidak punya kunci gabungan, jadi keunikan pasangan
    // customer + produk diperiksa manual.
    var adaBaris = null;
    bacaTabel('customer_prices').forEach(function (h) {
      if (keTeks_(h.customer_code).toUpperCase() === kodeCust &&
          keTeks_(h.product_code).toUpperCase() === kodeProd) {
        adaBaris = h;
      }
    });

    if (adaBaris) {
      var sh = sheet_('customer_prices');
      var idx = SKEMA.customer_prices.header.indexOf('special_price');
      sh.getRange(adaBaris._row, idx + 1).setValue(harga);
      batalkanCache_('customer_prices');
      catatAudit(sesi, 'master.customerPrices.upsert',
        { customer_code: kodeCust, product_code: kodeProd, harga: harga },
        'DIPERBARUI');
      return { dibuat: false, special_price: harga };
    }

    tambahBaris('customer_prices', [{
      customer_code: kodeCust,
      product_code: kodeProd,
      special_price: harga
    }]);
    catatAudit(sesi, 'master.customerPrices.upsert',
      { customer_code: kodeCust, product_code: kodeProd, harga: harga }, 'DIBUAT');
    return { dibuat: true, special_price: harga };
  });
}
