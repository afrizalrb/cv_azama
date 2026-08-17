/**
 * Gallon.gs — buku besar galon fisik.
 *
 * Galon kosong adalah aset perusahaan yang berada di tangan customer. Setiap
 * penjualan produk berkemasan galon mengeluarkan galon fisik, dan galon itu
 * baru kembali saat customer menukarnya. Selisihnya adalah aset yang sedang
 * berisiko.
 *
 * Ini satu-satunya "persediaan" yang tetap relevan pada model pre-order.
 * Barang jadi memang tidak distok karena produksi mengikuti pesanan, tapi
 * galon kosongnya berputar terus dan bisa hilang.
 *
 * Saldo customer = SUM(qty) dari seluruh barisnya.
 *   qty positif  = galon keluar ke customer
 *   qty negatif  = galon kembali, hilang, atau rusak
 *
 * Tidak ada kolom saldo yang ditimpa, sama seperti seluruh buku besar lain
 * di sistem ini.
 */

// Jenis mutasi yang boleh dicatat lewat menu retur. gallon_out tidak masuk
// daftar karena hanya boleh lahir dari penjualan, bukan diketik manual.
var JENIS_RETUR = {
  gallon_return: 'Kembali',
  lost: 'Hilang',
  damaged: 'Rusak'
};


// ---------------------------------------------------------------------------
// Saldo
// ---------------------------------------------------------------------------

/**
 * gallon.balance — saldo galon per customer.
 *
 * payload: { customer_code: '01C25BLL' }   opsional, untuk satu customer saja
 *
 * Customer bersaldo nol tidak ditampilkan dalam daftar keseluruhan, karena
 * yang dicari adalah galon yang masih di luar. Tapi saat satu customer
 * diminta secara khusus, saldo nol tetap dikembalikan — pertanyaannya beda,
 * jawabannya harus tetap ada.
 */
function gallonBalance(payload, sesi) {
  var p = payload || {};
  var filter = keTeks_(p.customer_code).toUpperCase();

  var petaCust = petaBerdasarkan('customers', 'code');
  var petaProduk = petaBerdasarkan('products', 'code');

  var perCustomer = {};
  var totalBeredar = 0;
  var totalHilang = 0;
  var totalRusak = 0;
  var totalKeluar = 0;
  var totalKembali = 0;

  bacaTabel('gallon_ledger').forEach(function (g) {
    var kode = keTeks_(g.customer_code).toUpperCase();
    if (filter && kode !== filter) return;
    if (!bolehLihatCustomer_(petaCust[kode], sesi)) return;

    var qty = keAngka_(g.qty);
    var jenis = keTeks_(g.movement_type);
    var kodeProd = keTeks_(g.product_code).toUpperCase();

    if (!perCustomer[kode]) {
      var c = petaCust[kode];
      perCustomer[kode] = {
        code: kode,
        nama: c ? keTeks_(c.name) : '(customer terhapus)',
        area: c ? keTeks_(c.area) : '',
        telepon: c ? keTeks_(c.phone) : '',
        sales_person: c ? keTeks_(c.sales_person) : '',
        saldo: 0,
        keluar: 0,
        kembali: 0,
        hilang: 0,
        rusak: 0,
        nilai_deposit: 0,
        terakhir: '',
        per_produk: {}
      };
    }

    var r = perCustomer[kode];
    r.saldo += qty;

    if (jenis === 'gallon_out') { r.keluar += qty; totalKeluar += qty; }
    else if (jenis === 'gallon_return') { r.kembali += -qty; totalKembali += -qty; }
    else if (jenis === 'lost') { r.hilang += -qty; totalHilang += -qty; }
    else if (jenis === 'damaged') { r.rusak += -qty; totalRusak += -qty; }

    r.nilai_deposit += keAngka_(g.deposit_amount);

    var tgl = keTanggalStr_(g.moved_at);
    if (tgl > r.terakhir) r.terakhir = tgl;

    if (kodeProd) {
      r.per_produk[kodeProd] = (r.per_produk[kodeProd] || 0) + qty;
    }
  });

  var daftar = [];
  for (var kode in perCustomer) {
    var r = perCustomer[kode];

    var rincian = [];
    for (var kp in r.per_produk) {
      if (r.per_produk[kp] === 0 && !filter) continue;
      var pr = petaProduk[kp];
      rincian.push({
        product_code: kp,
        nama: pr ? keTeks_(pr.name) : '(produk terhapus)',
        kemasan: pr ? keTeks_(pr.packaging_type) : '',
        saldo: r.per_produk[kp],
        deposit_satuan: pr ? keAngka_(pr.deposit_amount) : 0
      });
    }
    rincian.sort(function (a, b) { return b.saldo - a.saldo; });
    r.per_produk = rincian;

    if (r.saldo > 0) totalBeredar += r.saldo;

    // Tanpa filter, hanya yang masih memegang galon yang ditampilkan.
    if (filter || r.saldo !== 0) daftar.push(r);
  }

  daftar.sort(function (a, b) { return b.saldo - a.saldo; });

  return {
    ringkasan: {
      total_beredar: totalBeredar,
      total_keluar: totalKeluar,
      total_kembali: totalKembali,
      total_hilang: totalHilang,
      total_rusak: totalRusak,
      jumlah_customer: daftar.filter(function (d) { return d.saldo > 0; }).length
    },
    customer: daftar
  };
}


// ---------------------------------------------------------------------------
// Retur
// ---------------------------------------------------------------------------

/**
 * gallon.return — catat galon yang kembali, hilang, atau rusak.
 *
 * payload: {
 *   customer_code: '01C25BLL',
 *   moved_at:      '2026-08-17',      opsional, default hari ini
 *   jenis:         'gallon_return' | 'lost' | 'damaged',
 *   items: [ { product_code: 'GD19', qty: 10 } ],
 *   notes:         'diambil sopir'
 * }
 *
 * Jumlah yang dikembalikan tidak boleh melebihi yang sedang dipegang
 * customer. Saldo galon negatif berarti perusahaan seolah berutang galon
 * kepada customer, yang tidak mungkin terjadi dan hampir selalu berarti
 * salah pilih customer.
 */
function gallonReturn(payload, sesi) {
  var p = payload || {};
  var kodeCust = keTeks_(p.customer_code).toUpperCase();
  var jenis = keTeks_(p.jenis) || 'gallon_return';
  var daftarItem = p.items;

  if (!kodeCust) throw errorApp('BAD_REQUEST', 'Customer belum dipilih.');
  if (!JENIS_RETUR[jenis]) {
    throw errorApp('BAD_REQUEST',
      'Jenis pencatatan harus salah satu dari: ' +
      Object.keys(JENIS_RETUR).join(', ') + '.');
  }
  if (!daftarItem || !daftarItem.length) {
    throw errorApp('BAD_REQUEST', 'Belum ada galon yang dicatat.');
  }

  var tanggal = p.moved_at ? wajibTanggal_(p.moved_at, 'Tanggal') : hariIni_();
  if (selisihHari_(hariIni_(), tanggal) > 1) {
    throw errorApp('BAD_REQUEST', 'Tanggal tidak boleh di masa depan.');
  }

  return denganKunci(function () {
    var customer = cariBaris('customers', 'code', kodeCust);
    if (!customer) {
      throw errorApp('NOT_FOUND', 'Customer ' + kodeCust + ' tidak ada.');
    }
    wajibCustomerMiliknya_(customer, sesi);

    // Saldo per produk yang sedang dipegang customer ini.
    var saldo = {};
    bacaTabel('gallon_ledger').forEach(function (g) {
      if (keTeks_(g.customer_code).toUpperCase() !== kodeCust) return;
      var kp = keTeks_(g.product_code).toUpperCase();
      saldo[kp] = (saldo[kp] || 0) + keAngka_(g.qty);
    });

    var petaProduk = petaBerdasarkan('products', 'code');
    var siap = [];
    var totalDeposit = 0;

    for (var i = 0; i < daftarItem.length; i++) {
      var it = daftarItem[i] || {};
      var kodeProd = keTeks_(it.product_code).toUpperCase();
      var qty = Math.round(keAngka_(it.qty));

      if (!kodeProd) {
        throw errorApp('BAD_REQUEST', 'Baris ke-' + (i + 1) + ': produk belum dipilih.');
      }
      var produk = petaProduk[kodeProd];
      if (!produk) {
        throw errorApp('NOT_FOUND',
          'Baris ke-' + (i + 1) + ': produk ' + kodeProd + ' tidak ada.');
      }
      if (!keBool_(produk.is_returnable)) {
        throw errorApp('BAD_REQUEST',
          'Baris ke-' + (i + 1) + ': ' + keTeks_(produk.name) +
          ' bukan produk berkemasan galon yang dikembalikan.');
      }
      if (qty <= 0) {
        throw errorApp('BAD_REQUEST',
          'Baris ke-' + (i + 1) + ': jumlah harus lebih dari nol.');
      }

      var dipegang = saldo[kodeProd] || 0;
      if (qty > dipegang) {
        throw errorApp('BAD_REQUEST',
          keTeks_(customer.name) + ' tercatat memegang ' + dipegang + ' ' +
          kodeProd + ', tidak bisa mencatat ' + qty + '. Periksa apakah ' +
          'customer atau produknya sudah benar.');
      }

      // Deposit hanya berpindah saat galon hilang atau rusak. Galon yang
      // kembali utuh tidak memotong deposit apa pun.
      var deposit = (jenis === 'lost' || jenis === 'damaged')
        ? keAngka_(produk.deposit_amount) * qty
        : 0;
      totalDeposit += deposit;

      siap.push({
        product_code: kodeProd,
        nama: keTeks_(produk.name),
        qty: qty,
        deposit: deposit,
        saldo_sebelum: dipegang,
        saldo_sesudah: dipegang - qty
      });
    }

    var nomor = nomorAwal_('gallon_ledger', 'ledger_id', 'LDG');
    var catatan = keTeks_(p.notes);
    var baris = siap.map(function (s) {
      return {
        ledger_id: idDari_('LDG', nomor++),
        moved_at: tanggal,
        customer_code: kodeCust,
        product_code: s.product_code,
        qty: -s.qty,
        movement_type: jenis,
        deposit_amount: s.deposit,
        ref_type: 'manual',
        ref_id: '',
        notes: catatan || JENIS_RETUR[jenis],
        created_by: sesi.username
      };
    });

    tambahBaris('gallon_ledger', baris);

    catatAudit(sesi, 'gallon.return', {
      customer_code: kodeCust,
      jenis: jenis,
      total_qty: siap.reduce(function (s, x) { return s + x.qty; }, 0)
    }, 'BERHASIL');

    var totalQty = siap.reduce(function (s, x) { return s + x.qty; }, 0);
    var saldoAkhir = 0;
    for (var kp in saldo) saldoAkhir += saldo[kp];
    saldoAkhir -= totalQty;

    return {
      customer_code: kodeCust,
      customer_name: keTeks_(customer.name),
      jenis: jenis,
      jenis_label: JENIS_RETUR[jenis],
      moved_at: tanggal,
      total_qty: totalQty,
      total_deposit: totalDeposit,
      saldo_akhir: saldoAkhir,
      items: siap
    };
  });
}


/**
 * gallon.movements — riwayat mutasi galon.
 *
 * payload: { customer_code, dari, sampai, jenis, limit }
 */
function gallonMovements(payload, sesi) {
  var p = payload || {};
  var filterCust = keTeks_(p.customer_code).toUpperCase();
  var dari = p.dari ? keTanggalStr_(p.dari) : '';
  var sampai = p.sampai ? keTanggalStr_(p.sampai) : '';
  var filterJenis = keTeks_(p.jenis);
  var batas = Math.min(Math.round(keAngka_(p.limit)) || 200, 1000);

  var petaCust = petaBerdasarkan('customers', 'code');
  var petaProduk = petaBerdasarkan('products', 'code');

  var hasil = [];
  bacaTabel('gallon_ledger').forEach(function (g) {
    var kode = keTeks_(g.customer_code).toUpperCase();
    if (!bolehLihatCustomer_(petaCust[kode], sesi)) return;
    if (filterCust && kode !== filterCust) return;

    var tgl = keTanggalStr_(g.moved_at);
    if (dari && tgl < dari) return;
    if (sampai && tgl > sampai) return;

    var jenis = keTeks_(g.movement_type);
    if (filterJenis && jenis !== filterJenis) return;

    var kodeProd = keTeks_(g.product_code).toUpperCase();
    var pr = petaProduk[kodeProd];

    hasil.push({
      ledger_id: keTeks_(g.ledger_id),
      moved_at: tgl,
      customer_code: kode,
      customer_name: petaCust[kode] ? keTeks_(petaCust[kode].name) : '(customer terhapus)',
      product_code: kodeProd,
      nama_produk: pr ? keTeks_(pr.name) : '',
      qty: keAngka_(g.qty),
      movement_type: jenis,
      jenis_label: JENIS_RETUR[jenis] || (jenis === 'gallon_out' ? 'Keluar' : jenis),
      deposit_amount: keAngka_(g.deposit_amount),
      ref_type: keTeks_(g.ref_type),
      ref_id: keTeks_(g.ref_id),
      notes: keTeks_(g.notes),
      created_by: keTeks_(g.created_by)
    });
  });

  hasil.sort(function (a, b) {
    if (a.moved_at !== b.moved_at) return a.moved_at < b.moved_at ? 1 : -1;
    return a.ledger_id < b.ledger_id ? 1 : -1;
  });

  return {
    daftar: hasil.slice(0, batas),
    jumlah_total: hasil.length,
    dipotong: hasil.length > batas
  };
}
