/**
 * Sales.gs — penjualan.
 *
 * Ini bagian paling kritis di seluruh sistem, karena satu penjualan menyentuh
 * empat tab sekaligus: sales_orders, sales_order_items, stock_movements, dan
 * gallon_ledger. Google Sheets tidak punya transaksi, jadi keutuhannya harus
 * dijaga sendiri.
 *
 * Dua kaidah yang menentukan bentuk kode di sini:
 *
 * 1. Validasi seluruhnya di depan, penulisan seluruhnya di belakang.
 *    Tidak ada satu baris pun ditulis sebelum semua pemeriksaan lolos.
 *    Rollback hanya perlu menangani kegagalan penulisan itu sendiri, bukan
 *    data yang ternyata tidak sah di tengah jalan.
 *
 * 2. Harga dan HPP di-snapshot ke baris transaksi.
 *    Mengubah harga di master tidak boleh mengubah laporan bulan lalu.
 *    Inilah kenapa sales_order_items menyimpan unit_price dan unit_cogs
 *    sendiri, bukan menunjuk ke products.
 */


// ---------------------------------------------------------------------------
// Pembuatan penjualan
// ---------------------------------------------------------------------------

/**
 * sales.create — buat satu penjualan beserta seluruh dampaknya.
 *
 * payload: {
 *   customer_code: '01C25BLL',
 *   order_date:    '2026-08-09',          opsional, default hari ini
 *   items: [ { product_code: 'GD19', qty: 10 }, ... ],
 *   notes:         'catatan bebas'         opsional
 * }
 *
 * Harga TIDAK diambil dari payload. Frontend boleh menampilkan perkiraan
 * harga, tapi angka yang tersimpan selalu ditentukan di sini: dari
 * customer_prices bila ada, kalau tidak dari products.price. Konsekuensinya
 * harga negosiasi sesaat tidak bisa diketik langsung di form — kesepakatan
 * harga harus dicatat lebih dulu di customer_prices. Itu memang disengaja:
 * harga yang bisa diketik bebas per transaksi membuat laporan margin tidak
 * bisa dipercaya.
 */
function salesCreate(payload, sesi) {
  var p = payload || {};

  // --- pemeriksaan bentuk payload, sebelum menyentuh spreadsheet ---
  var kodeCust = keTeks_(p.customer_code).toUpperCase();
  if (!kodeCust) {
    throw errorApp('BAD_REQUEST', 'Customer belum dipilih.');
  }

  var itemMasuk = p.items;
  if (!itemMasuk || !itemMasuk.length) {
    throw errorApp('BAD_REQUEST', 'Penjualan harus punya minimal satu produk.');
  }
  if (itemMasuk.length > 50) {
    throw errorApp('BAD_REQUEST', 'Satu invoice maksimal 50 baris produk.');
  }

  var tanggal = p.order_date ? wajibTanggal_(p.order_date, 'Tanggal') : hariIni_();

  // Tanggal masa depan hampir selalu salah ketik tahun, dan efeknya baru
  // ketahuan berbulan-bulan kemudian lewat aging piutang yang aneh.
  if (selisihHari_(hariIni_(), tanggal) > 1) {
    throw errorApp('BAD_REQUEST',
      'Tanggal penjualan tidak boleh di masa depan. Periksa lagi tanggalnya.');
  }

  return denganKunci(function () {
    // --- validasi customer ---
    var customer = cariBaris('customers', 'code', kodeCust);
    if (!customer) {
      throw errorApp('NOT_FOUND', 'Customer ' + kodeCust + ' tidak ada.');
    }
    if (!keBool_(customer.is_active)) {
      throw errorApp('BAD_REQUEST',
        'Customer ' + keTeks_(customer.name) + ' sudah tidak aktif.');
    }
    wajibCustomerMiliknya_(customer, sesi);

    // --- validasi produk & tentukan harga ---
    var petaProduk = petaBerdasarkan('products', 'code');
    var petaHarga = petaHargaKhusus_(kodeCust);

    var itemSiap = [];
    var subtotal = 0;

    for (var i = 0; i < itemMasuk.length; i++) {
      var baris = itemMasuk[i] || {};
      var kodeProd = keTeks_(baris.product_code).toUpperCase();
      var qty = Math.round(keAngka_(baris.qty));

      if (!kodeProd) {
        throw errorApp('BAD_REQUEST', 'Baris ke-' + (i + 1) + ': produk belum dipilih.');
      }
      var produk = petaProduk[kodeProd];
      if (!produk) {
        throw errorApp('NOT_FOUND',
          'Baris ke-' + (i + 1) + ': produk ' + kodeProd + ' tidak ada.');
      }
      if (!keBool_(produk.is_active)) {
        throw errorApp('BAD_REQUEST',
          'Baris ke-' + (i + 1) + ': produk ' + keTeks_(produk.name) +
          ' sudah tidak aktif.');
      }
      if (qty <= 0) {
        throw errorApp('BAD_REQUEST',
          'Baris ke-' + (i + 1) + ': jumlah harus lebih dari nol.');
      }
      if (qty > 100000) {
        throw errorApp('BAD_REQUEST',
          'Baris ke-' + (i + 1) + ': jumlah ' + qty + ' tidak wajar.');
      }

      var harga = petaHarga[kodeProd] !== undefined
        ? petaHarga[kodeProd]
        : keAngka_(produk.price);
      var hpp = keAngka_(produk.cogs);

      itemSiap.push({
        product_code: kodeProd,
        nama_produk: keTeks_(produk.name),
        qty: qty,
        unit_price: harga,
        unit_cogs: hpp,
        line_total: qty * harga,
        is_returnable: keBool_(produk.is_returnable),
        deposit_amount: keAngka_(produk.deposit_amount),
        harga_khusus: petaHarga[kodeProd] !== undefined
      });
      subtotal += qty * harga;
    }

    // --- siapkan seluruh baris di memori ---
    var invoice = nomorInvoiceBerikutnya_(tanggal);
    var orderId = idBerikutnya_('sales_orders', 'order_id', 'ORD');
    var tempo = Math.round(keAngka_(customer.payment_term_days)) || 30;
    var saatIni = sekarang_();
    var catatan = keTeks_(p.notes);

    var barisOrder = [{
      order_id: orderId,
      invoice_no: invoice,
      order_date: tanggal,
      customer_code: kodeCust,
      due_date: tambahHari_(tanggal, tempo),
      status: 'unpaid',
      subtotal: subtotal,
      created_by: sesi.username,
      created_at: saatIni
    }];

    var noItem = nomorAwal_('sales_order_items', 'item_id', 'ITM');
    var noMutasi = nomorAwal_('stock_movements', 'movement_id', 'MOV');
    var noLedger = nomorAwal_('gallon_ledger', 'ledger_id', 'LDG');

    var barisItem = [];
    var barisMutasi = [];
    var barisGalon = [];

    itemSiap.forEach(function (item) {
      barisItem.push({
        item_id: idDari_('ITM', noItem++),
        order_id: orderId,
        product_code: item.product_code,
        qty: item.qty,
        unit_price: item.unit_price,
        unit_cogs: item.unit_cogs,
        line_total: item.line_total
      });

      // Stok berkurang: qty negatif. Tidak pernah ada kolom "stok akhir"
      // yang ditimpa — stok saat ini selalu SUM(qty) dari tab ini.
      barisMutasi.push({
        movement_id: idDari_('MOV', noMutasi++),
        moved_at: tanggal,
        item_type: 'product',
        item_code: item.product_code,
        qty: -item.qty,
        movement_type: 'sale_out',
        ref_type: 'sales_order',
        ref_id: orderId,
        notes: 'Penjualan ' + invoice,
        created_by: sesi.username,
        created_at: saatIni
      });

      // Galon fisik berpindah ke customer. Positif berarti masih dipegang
      // customer dan belum kembali.
      if (item.is_returnable) {
        barisGalon.push({
          ledger_id: idDari_('LDG', noLedger++),
          moved_at: tanggal,
          customer_code: kodeCust,
          product_code: item.product_code,
          qty: item.qty,
          movement_type: 'gallon_out',
          deposit_amount: item.deposit_amount,
          ref_type: 'sales_order',
          ref_id: orderId,
          notes: 'Penjualan ' + invoice,
          created_by: sesi.username
        });
      }
    });

    // --- penulisan, dengan pembatalan bila ada yang gagal di tengah ---
    var sudahDitulis = [];
    try {
      tulisDanCatat_(sudahDitulis, 'sales_orders', barisOrder);
      tulisDanCatat_(sudahDitulis, 'sales_order_items', barisItem);
      tulisDanCatat_(sudahDitulis, 'stock_movements', barisMutasi);
      tulisDanCatat_(sudahDitulis, 'gallon_ledger', barisGalon);
    } catch (e) {
      batalkanPenulisan_(sudahDitulis);
      catatAudit(sesi, 'sales.create', { invoice_no: invoice },
        'GAGAL, seluruh baris dibatalkan: ' + e.message);
      throw errorApp('WRITE_FAILED',
        'Penjualan gagal disimpan dan seluruh perubahan sudah dibatalkan. ' +
        'Silakan coba lagi.');
    }

    catatAudit(sesi, 'sales.create', {
      invoice_no: invoice,
      customer_code: kodeCust,
      jumlah_item: barisItem.length,
      subtotal: subtotal
    }, 'BERHASIL');

    return {
      order_id: orderId,
      invoice_no: invoice,
      order_date: tanggal,
      due_date: barisOrder[0].due_date,
      customer_code: kodeCust,
      customer_name: keTeks_(customer.name),
      status: 'unpaid',
      subtotal: subtotal,
      tempo_hari: tempo,
      items: itemSiap.map(function (it) {
        return {
          product_code: it.product_code,
          nama_produk: it.nama_produk,
          qty: it.qty,
          unit_price: it.unit_price,
          line_total: it.line_total,
          harga_khusus: it.harga_khusus
        };
      }),
      galon_keluar: barisGalon.reduce(function (s, g) { return s + g.qty; }, 0)
    };
  });
}


// ---------------------------------------------------------------------------
// Pembacaan
// ---------------------------------------------------------------------------

/**
 * sales.list — daftar penjualan.
 *
 * payload: { dari, sampai, status, customer_code, limit }  semuanya opsional
 *
 * Role sales hanya melihat penjualan milik customer-nya sendiri. Penyaringan
 * itu dilakukan di sini, bukan dengan menyembunyikan baris di frontend.
 */
function salesList(payload, sesi) {
  var p = payload || {};
  var dari = p.dari ? keTanggalStr_(p.dari) : '';
  var sampai = p.sampai ? keTanggalStr_(p.sampai) : '';
  var statusFilter = keTeks_(p.status).toLowerCase();
  var custFilter = keTeks_(p.customer_code).toUpperCase();
  var batas = Math.min(Math.round(keAngka_(p.limit)) || 200, 1000);

  var petaCust = petaBerdasarkan('customers', 'code');
  var bayarPerOrder = totalBayarPerOrder_();
  var hariIni = hariIni_();

  var hasil = [];
  var semua = bacaTabel('sales_orders');

  for (var i = 0; i < semua.length; i++) {
    var o = semua[i];
    var kodeCust = keTeks_(o.customer_code).toUpperCase();
    var customer = petaCust[kodeCust];

    if (!bolehLihatCustomer_(customer, sesi)) continue;

    var tgl = keTanggalStr_(o.order_date);
    if (dari && tgl < dari) continue;
    if (sampai && tgl > sampai) continue;
    if (custFilter && kodeCust !== custFilter) continue;

    var status = keTeks_(o.status).toLowerCase() || 'unpaid';
    if (statusFilter && status !== statusFilter) continue;

    var subtotal = keAngka_(o.subtotal);
    var dibayar = bayarPerOrder[keTeks_(o.order_id)] || 0;
    var jatuhTempo = keTanggalStr_(o.due_date);

    hasil.push({
      order_id: keTeks_(o.order_id),
      invoice_no: keTeks_(o.invoice_no),
      order_date: tgl,
      due_date: jatuhTempo,
      customer_code: kodeCust,
      customer_name: customer ? keTeks_(customer.name) : '(customer terhapus)',
      sales_person: customer ? keTeks_(customer.sales_person) : '',
      status: status,
      subtotal: subtotal,
      dibayar: dibayar,
      sisa: subtotal - dibayar,
      // Negatif berarti belum jatuh tempo. Dihitung di server supaya seluruh
      // pengguna melihat angka yang sama, tidak bergantung jam komputernya.
      terlambat_hari: (status === 'paid' || status === 'cancelled')
        ? 0
        : Math.max(0, selisihHari_(jatuhTempo, hariIni))
    });
  }

  // Terbaru di atas. Format tanggal ISO membuat urutan teks sama dengan
  // urutan waktu, jadi tidak perlu mengurai tanggal.
  hasil.sort(function (a, b) {
    if (a.order_date !== b.order_date) return a.order_date < b.order_date ? 1 : -1;
    return a.invoice_no < b.invoice_no ? 1 : -1;
  });

  var dipotong = hasil.length > batas;
  return {
    daftar: hasil.slice(0, batas),
    jumlah_total: hasil.length,
    dipotong: dipotong,
    ringkasan: {
      nilai: hasil.reduce(function (s, o) {
        return s + (o.status === 'cancelled' ? 0 : o.subtotal);
      }, 0),
      // Invoice berstatus 'paid' tidak dihitung sebagai piutang meski tabel
      // payments kosong. Seluruh invoice historis ditandai lunas saat migrasi
      // tanpa rincian pembayarannya, jadi sampai modul pembayaran ada, kolom
      // status-lah yang berwenang. Memakai selisih pembayaran di sini membuat
      // seluruh omzet dua tahun terlihat sebagai piutang.
      belum_lunas: hasil.reduce(function (s, o) {
        if (o.status === 'cancelled' || o.status === 'paid') return s;
        return s + o.sisa;
      }, 0)
    }
  };
}


/** sales.get — satu penjualan lengkap dengan item dan pembayarannya. */
function salesGet(payload, sesi) {
  var p = payload || {};
  var kunci = keTeks_(p.order_id) || keTeks_(p.invoice_no);
  if (!kunci) {
    throw errorApp('BAD_REQUEST', 'order_id atau invoice_no wajib diisi.');
  }

  var order = cariBaris('sales_orders', 'order_id', kunci) ||
              cariBaris('sales_orders', 'invoice_no', kunci);
  if (!order) {
    throw errorApp('NOT_FOUND', 'Penjualan ' + kunci + ' tidak ditemukan.');
  }

  var customer = cariBaris('customers', 'code', keTeks_(order.customer_code));
  wajibCustomerMiliknya_(customer, sesi);

  var orderId = keTeks_(order.order_id);
  var petaProduk = petaBerdasarkan('products', 'code');

  var items = bacaTabel('sales_order_items')
    .filter(function (it) { return keTeks_(it.order_id) === orderId; })
    .map(function (it) {
      var kode = keTeks_(it.product_code);
      var produk = petaProduk[kode.toUpperCase()];
      return {
        item_id: keTeks_(it.item_id),
        product_code: kode,
        nama_produk: produk ? keTeks_(produk.name) : '(produk terhapus)',
        qty: keAngka_(it.qty),
        unit_price: keAngka_(it.unit_price),
        unit_cogs: keAngka_(it.unit_cogs),
        line_total: keAngka_(it.line_total),
        margin: keAngka_(it.line_total) - keAngka_(it.qty) * keAngka_(it.unit_cogs)
      };
    });

  var payments = bacaTabel('payments')
    .filter(function (b) { return keTeks_(b.order_id) === orderId; })
    .map(function (b) {
      return {
        payment_id: keTeks_(b.payment_id),
        payment_date: keTanggalStr_(b.payment_date),
        amount: keAngka_(b.amount),
        method: keTeks_(b.method),
        reference: keTeks_(b.reference)
      };
    });

  var subtotal = keAngka_(order.subtotal);
  var dibayar = payments.reduce(function (s, b) { return s + b.amount; }, 0);

  return {
    order_id: orderId,
    invoice_no: keTeks_(order.invoice_no),
    order_date: keTanggalStr_(order.order_date),
    due_date: keTanggalStr_(order.due_date),
    customer_code: keTeks_(order.customer_code),
    customer_name: customer ? keTeks_(customer.name) : '(customer terhapus)',
    customer_area: customer ? keTeks_(customer.area) : '',
    sales_person: customer ? keTeks_(customer.sales_person) : '',
    status: keTeks_(order.status).toLowerCase(),
    subtotal: subtotal,
    dibayar: dibayar,
    sisa: subtotal - dibayar,
    // Margin hanya bermakna kalau HPP sudah terisi. Angka nol pada unit_cogs
    // membuat margin terlihat 100%, jadi frontend perlu tahu bedanya.
    total_hpp: items.reduce(function (s, it) { return s + it.qty * it.unit_cogs; }, 0),
    hpp_lengkap: items.every(function (it) { return it.unit_cogs > 0; }),
    created_by: keTeks_(order.created_by),
    created_at: keTeks_(order.created_at),
    items: items,
    payments: payments
  };
}


// ---------------------------------------------------------------------------
// Pembatalan
// ---------------------------------------------------------------------------

/**
 * sales.cancel — batalkan penjualan.
 *
 * Tidak ada baris yang dihapus. Status order diubah menjadi 'cancelled', lalu
 * ditulis baris penyeimbang di stock_movements dan gallon_ledger. Dengan
 * begitu buku besar tetap utuh dan riwayatnya bisa ditelusuri: barang keluar
 * pada tanggal sekian, lalu dikembalikan karena pembatalan.
 *
 * Menghapus baris asli akan membuat stok "benar" tapi menghilangkan jejak
 * bahwa transaksinya pernah ada.
 */
function salesCancel(payload, sesi) {
  var p = payload || {};
  var kunci = keTeks_(p.order_id) || keTeks_(p.invoice_no);
  var alasan = keTeks_(p.alasan);

  if (!kunci) {
    throw errorApp('BAD_REQUEST', 'order_id atau invoice_no wajib diisi.');
  }
  if (!alasan) {
    throw errorApp('BAD_REQUEST',
      'Alasan pembatalan wajib diisi, supaya bisa ditelusuri di kemudian hari.');
  }

  return denganKunci(function () {
    var order = cariBaris('sales_orders', 'order_id', kunci) ||
                cariBaris('sales_orders', 'invoice_no', kunci);
    if (!order) {
      throw errorApp('NOT_FOUND', 'Penjualan ' + kunci + ' tidak ditemukan.');
    }

    var orderId = keTeks_(order.order_id);
    var invoice = keTeks_(order.invoice_no);
    var status = keTeks_(order.status).toLowerCase();

    if (status === 'cancelled') {
      throw errorApp('BAD_REQUEST', 'Invoice ' + invoice + ' sudah dibatalkan.');
    }

    var customer = cariBaris('customers', 'code', keTeks_(order.customer_code));
    wajibCustomerMiliknya_(customer, sesi);

    // Invoice yang sudah menerima uang tidak boleh dibatalkan begitu saja.
    // Uangnya harus diurus lebih dulu, dan itu keputusan manusia.
    var dibayar = totalBayarPerOrder_()[orderId] || 0;
    if (dibayar > 0) {
      throw errorApp('BAD_REQUEST',
        'Invoice ' + invoice + ' sudah menerima pembayaran Rp ' +
        Math.round(dibayar).toLocaleString('id-ID') + '. Hapus dulu pembayarannya, ' +
        'atau catat sebagai retur.');
    }

    var items = bacaTabel('sales_order_items').filter(function (it) {
      return keTeks_(it.order_id) === orderId;
    });
    var petaProduk = petaBerdasarkan('products', 'code');
    var saatIni = sekarang_();
    var hariIni = hariIni_();

    var noMutasi = nomorAwal_('stock_movements', 'movement_id', 'MOV');
    var noLedger = nomorAwal_('gallon_ledger', 'ledger_id', 'LDG');
    var barisMutasi = [];
    var barisGalon = [];

    items.forEach(function (it) {
      var kode = keTeks_(it.product_code).toUpperCase();
      var qty = keAngka_(it.qty);

      barisMutasi.push({
        movement_id: idDari_('MOV', noMutasi++),
        moved_at: hariIni,
        item_type: 'product',
        item_code: kode,
        qty: qty,                      // positif: barang kembali ke gudang
        movement_type: 'adjustment',
        ref_type: 'sales_order_cancel',
        ref_id: orderId,
        notes: 'Pembatalan ' + invoice + ' — ' + alasan,
        created_by: sesi.username,
        created_at: saatIni
      });

      var produk = petaProduk[kode];
      if (produk && keBool_(produk.is_returnable)) {
        // Dicatat sebagai gallon_return karena efeknya memang sama: galon
        // tidak jadi berada di tangan customer. Kosakata movement_type
        // sengaja tidak ditambah demi satu kasus; alasannya ada di notes.
        barisGalon.push({
          ledger_id: idDari_('LDG', noLedger++),
          moved_at: hariIni,
          customer_code: keTeks_(order.customer_code).toUpperCase(),
          product_code: kode,
          qty: -qty,
          movement_type: 'gallon_return',
          deposit_amount: 0,
          ref_type: 'sales_order_cancel',
          ref_id: orderId,
          notes: 'Pembatalan ' + invoice + ' — ' + alasan,
          created_by: sesi.username
        });
      }
    });

    var sudahDitulis = [];
    try {
      tulisDanCatat_(sudahDitulis, 'stock_movements', barisMutasi);
      tulisDanCatat_(sudahDitulis, 'gallon_ledger', barisGalon);
      perbaruiBaris('sales_orders', 'order_id', orderId, { status: 'cancelled' });
    } catch (e) {
      batalkanPenulisan_(sudahDitulis);
      catatAudit(sesi, 'sales.cancel', { invoice_no: invoice },
        'GAGAL, seluruh baris dibatalkan: ' + e.message);
      throw errorApp('WRITE_FAILED',
        'Pembatalan gagal disimpan dan perubahan sudah dikembalikan. Coba lagi.');
    }

    catatAudit(sesi, 'sales.cancel',
      { invoice_no: invoice, alasan: alasan }, 'BERHASIL');

    return {
      order_id: orderId,
      invoice_no: invoice,
      status: 'cancelled',
      stok_dikembalikan: barisMutasi.length,
      galon_dikembalikan: barisGalon.reduce(function (s, g) { return s - g.qty; }, 0)
    };
  });
}


// ---------------------------------------------------------------------------
// Pembantu
// ---------------------------------------------------------------------------

/**
 * Nomor invoice berikutnya, format INV + YYMM + tiga digit urut.
 *
 * Urutannya per bulan, bukan berlanjut sepanjang tahun. Nomor dicari dengan
 * membaca invoice yang sudah ada berawalan sama, sehingga tidak bisa menabrak
 * data hasil migrasi. Selalu dipanggil dari dalam kunci.
 */
function nomorInvoiceBerikutnya_(tanggal) {
  var t = keTanggalStr_(tanggal);
  var prefiks = 'INV' + t.substring(2, 4) + t.substring(5, 7);

  var maks = 0;
  var semua = bacaTabel('sales_orders');
  for (var i = 0; i < semua.length; i++) {
    var no = keTeks_(semua[i].invoice_no).toUpperCase();
    if (no.indexOf(prefiks) === 0) {
      var n = parseInt(no.substring(prefiks.length), 10);
      if (!isNaN(n) && n > maks) maks = n;
    }
  }

  if (maks >= 999) {
    throw errorApp('LIMIT_REACHED',
      'Nomor invoice bulan ini sudah mencapai 999. Hubungi administrator.');
  }

  var urut = String(maks + 1);
  while (urut.length < 3) urut = '0' + urut;
  return prefiks + urut;
}


/** Harga khusus customer, sebagai peta kode produk -> harga. */
function petaHargaKhusus_(kodeCustomer) {
  var peta = {};
  var target = keTeks_(kodeCustomer).toUpperCase();
  bacaTabel('customer_prices').forEach(function (h) {
    if (keTeks_(h.customer_code).toUpperCase() === target) {
      var harga = keAngka_(h.special_price);
      // Harga nol hampir pasti baris yang belum diisi, bukan kesepakatan
      // menggratiskan barang. Diabaikan supaya harga master yang dipakai.
      if (harga > 0) peta[keTeks_(h.product_code).toUpperCase()] = harga;
    }
  });
  return peta;
}


/** Total pembayaran per order, dihitung sekali untuk seluruh daftar. */
function totalBayarPerOrder_() {
  var peta = {};
  bacaTabel('payments').forEach(function (b) {
    var id = keTeks_(b.order_id);
    peta[id] = (peta[id] || 0) + keAngka_(b.amount);
  });
  return peta;
}


/** Nomor urut berikutnya sebagai angka, untuk membuat ID berurut di memori. */
function nomorAwal_(nama, kolom, prefiks) {
  return parseInt(idBerikutnya_(nama, kolom, prefiks).substring(prefiks.length), 10);
}

function idDari_(prefiks, nomor) {
  var s = String(nomor);
  while (s.length < 5) s = '0' + s;
  return prefiks + s;
}


/** Tulis baris sambil mencatat posisinya, supaya bisa dibatalkan. */
function tulisDanCatat_(daftarCatatan, nama, baris) {
  if (!baris || !baris.length) return;
  var mulai = tambahBaris(nama, baris);
  daftarCatatan.push({ nama: nama, mulai: mulai });
}

/** Batalkan penulisan dari yang terakhir ke yang pertama. */
function batalkanPenulisan_(daftarCatatan) {
  for (var i = daftarCatatan.length - 1; i >= 0; i--) {
    try {
      hapusBarisSejak_(daftarCatatan[i].nama, daftarCatatan[i].mulai);
    } catch (e) {
      // Kegagalan membatalkan jauh lebih serius daripada kegagalan menulis,
      // karena menyisakan data separuh jadi. Dicatat sekeras mungkin.
      console.error('ROLLBACK GAGAL pada tab ' + daftarCatatan[i].nama +
        ' mulai baris ' + daftarCatatan[i].mulai + ': ' + e.message);
    }
  }
}


/**
 * Apakah sesi ini boleh melihat customer tersebut.
 *
 * Admin melihat semuanya. Role sales hanya melihat customer yang kolom
 * sales_person-nya cocok dengan namanya. Sengaja gagal tertutup: sales tanpa
 * sales_person_name tidak melihat apa pun, bukan melihat segalanya.
 */
function bolehLihatCustomer_(customer, sesi) {
  if (sesi.role === 'admin') return true;
  if (sesi.role !== 'sales') return false;
  if (!customer) return false;

  var milik = keTeks_(sesi.sales_person_name);
  if (!milik) return false;
  return keTeks_(customer.sales_person).toLowerCase() === milik.toLowerCase();
}

function wajibCustomerMiliknya_(customer, sesi) {
  if (!bolehLihatCustomer_(customer, sesi)) {
    throw errorApp('FORBIDDEN',
      'Customer ini bukan tanggung jawab Anda. Hubungi administrator bila ' +
      'seharusnya bisa diakses.');
  }
  return true;
}
