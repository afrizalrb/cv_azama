/**
 * Payment.gs — pembayaran dan aging piutang.
 *
 * Inilah alasan utama sistem ini dibangun. Seluruh customer bertempo 14 atau
 * 30 hari, tapi selama ini tidak ada satu pun pencatatan pembayaran, sehingga
 * tidak ada yang tahu berapa uang yang belum kembali dan sejak kapan.
 *
 * Dua hal yang menentukan bentuk kode di sini:
 *
 * 1. Pembayaran adalah buku besar, bukan kolom yang ditimpa.
 *    Status 'paid' di sales_orders hanyalah ringkasan yang dihitung ulang
 *    setiap kali ada pembayaran masuk. Yang berwenang adalah jumlah baris
 *    di tab payments. Pembatalan pembayaran ditulis sebagai baris bernilai
 *    negatif, bukan dengan menghapus baris aslinya.
 *
 * 2. Invoice historis berstatus 'paid' tanpa baris pembayaran.
 *    Seluruh 111 invoice hasil migrasi ditandai lunas berdasarkan asumsi,
 *    karena kolom Status di Excel kosong seluruhnya. Aging harus
 *    mengecualikannya, kalau tidak seluruh omzet dua tahun akan muncul
 *    sebagai tunggakan pada hari pertama sistem dipakai.
 */

var METODE_PEMBAYARAN = ['transfer', 'tunai', 'giro', 'lainnya'];


// ---------------------------------------------------------------------------
// Pencatatan pembayaran
// ---------------------------------------------------------------------------

/**
 * payment.create — catat satu pembayaran.
 *
 * payload: {
 *   order_id:     'ORD00123'  atau invoice_no,
 *   payment_date: '2026-08-17',   opsional, default hari ini
 *   amount:       150000,
 *   method:       'transfer',
 *   reference:    'BCA 17/08 a.n. Budi'    opsional
 * }
 *
 * Status order dihitung ulang dari seluruh baris pembayaran, bukan
 * ditambahkan ke nilai sebelumnya. Dengan begitu koreksi atau pembatalan
 * pembayaran otomatis tercermin di status tanpa perlu perhitungan terpisah.
 */
function paymentCreate(payload, sesi) {
  var p = payload || {};
  var kunci = keTeks_(p.order_id) || keTeks_(p.invoice_no);
  var jumlah = Math.round(keAngka_(p.amount));
  var metode = keTeks_(p.method).toLowerCase();

  if (!kunci) {
    throw errorApp('BAD_REQUEST', 'Invoice yang dibayar belum dipilih.');
  }
  if (jumlah <= 0) {
    throw errorApp('BAD_REQUEST', 'Jumlah pembayaran harus lebih dari nol.');
  }
  if (metode && METODE_PEMBAYARAN.indexOf(metode) < 0) {
    throw errorApp('BAD_REQUEST',
      'Metode pembayaran harus salah satu dari: ' + METODE_PEMBAYARAN.join(', ') + '.');
  }

  var tanggal = p.payment_date
    ? wajibTanggal_(p.payment_date, 'Tanggal pembayaran')
    : hariIni_();

  if (selisihHari_(hariIni_(), tanggal) > 1) {
    throw errorApp('BAD_REQUEST',
      'Tanggal pembayaran tidak boleh di masa depan.');
  }

  return denganKunci(function () {
    var order = cariBaris('sales_orders', 'order_id', kunci) ||
                cariBaris('sales_orders', 'invoice_no', kunci);
    if (!order) {
      throw errorApp('NOT_FOUND', 'Invoice ' + kunci + ' tidak ditemukan.');
    }

    var orderId = keTeks_(order.order_id);
    var invoice = keTeks_(order.invoice_no);
    var status = keTeks_(order.status).toLowerCase();
    var subtotal = keAngka_(order.subtotal);
    var tglOrder = keTanggalStr_(order.order_date);

    if (status === 'cancelled') {
      throw errorApp('BAD_REQUEST',
        'Invoice ' + invoice + ' sudah dibatalkan dan tidak bisa menerima pembayaran.');
    }

    var customer = cariBaris('customers', 'code', keTeks_(order.customer_code));
    wajibCustomerMiliknya_(customer, sesi);

    if (tanggal < tglOrder) {
      throw errorApp('BAD_REQUEST',
        'Tanggal pembayaran (' + tanggal + ') mendahului tanggal invoice (' +
        tglOrder + '). Periksa lagi tanggalnya.');
    }

    var sudahDibayar = totalBayarPerOrder_()[orderId] || 0;

    // Invoice hasil migrasi berstatus lunas tanpa baris pembayaran. Mencatat
    // pembayaran di atasnya hampir pasti kekeliruan, dan kalau dibiarkan
    // akan terlihat sebagai lebih bayar sebesar seluruh nilai invoice.
    if (status === 'paid' && sudahDibayar === 0) {
      throw errorApp('BAD_REQUEST',
        'Invoice ' + invoice + ' sudah ditandai lunas saat migrasi data dari ' +
        'Excel, tanpa rincian pembayaran. Bila ternyata belum dibayar, ubah ' +
        'dulu statusnya di tab sales_orders menjadi unpaid.');
    }

    var sisa = subtotal - sudahDibayar;
    if (jumlah > sisa + 0.5) {
      throw errorApp('BAD_REQUEST',
        'Pembayaran Rp ' + jumlah.toLocaleString('id-ID') + ' melebihi sisa ' +
        'tagihan Rp ' + Math.round(sisa).toLocaleString('id-ID') + '. ' +
        'Catat sebesar sisanya saja, atau periksa apakah ada pembayaran yang ' +
        'terlanjur dicatat dua kali.');
    }

    var totalBaru = sudahDibayar + jumlah;
    var statusBaru = hitungStatus_(totalBaru, subtotal);

    var barisBayar = [{
      payment_id: idBerikutnya_('payments', 'payment_id', 'PAY'),
      order_id: orderId,
      payment_date: tanggal,
      amount: jumlah,
      method: metode || 'lainnya',
      reference: keTeks_(p.reference),
      created_by: sesi.username
    }];

    var ditulis = [];
    try {
      tulisDanCatat_(ditulis, 'payments', barisBayar);
      if (statusBaru !== status) {
        perbaruiBaris('sales_orders', 'order_id', orderId, { status: statusBaru });
      }
    } catch (e) {
      batalkanPenulisan_(ditulis);
      catatAudit(sesi, 'payment.create', { invoice_no: invoice, amount: jumlah },
        'GAGAL, dibatalkan: ' + e.message);
      throw errorApp('WRITE_FAILED',
        'Pembayaran gagal disimpan dan perubahan sudah dikembalikan. Coba lagi.');
    }

    catatAudit(sesi, 'payment.create', {
      invoice_no: invoice, amount: jumlah, method: metode, status_baru: statusBaru
    }, 'BERHASIL');

    return {
      payment_id: barisBayar[0].payment_id,
      order_id: orderId,
      invoice_no: invoice,
      customer_name: customer ? keTeks_(customer.name) : '',
      payment_date: tanggal,
      amount: jumlah,
      total_dibayar: totalBaru,
      sisa: subtotal - totalBaru,
      status_lama: status,
      status: statusBaru,
      lunas: statusBaru === 'paid'
    };
  });
}


/**
 * payment.reverse — batalkan satu pembayaran.
 *
 * Ditulis sebagai baris baru bernilai negatif, bukan dengan menghapus baris
 * aslinya. Alasannya sama seperti pada pembatalan penjualan: menghapus baris
 * membuat angkanya benar tapi menghilangkan jejak bahwa uangnya pernah
 * tercatat masuk — dan justru jejak itulah yang dicari saat ada selisih.
 */
function paymentReverse(payload, sesi) {
  var p = payload || {};
  var idBayar = keTeks_(p.payment_id);
  var alasan = keTeks_(p.alasan);

  if (!idBayar) throw errorApp('BAD_REQUEST', 'payment_id wajib diisi.');
  if (!alasan) {
    throw errorApp('BAD_REQUEST',
      'Alasan pembatalan wajib diisi, supaya bisa ditelusuri di kemudian hari.');
  }

  return denganKunci(function () {
    var bayar = cariBaris('payments', 'payment_id', idBayar);
    if (!bayar) {
      throw errorApp('NOT_FOUND', 'Pembayaran ' + idBayar + ' tidak ditemukan.');
    }

    var jumlah = keAngka_(bayar.amount);
    if (jumlah < 0) {
      throw errorApp('BAD_REQUEST',
        'Baris ini sendiri adalah pembatalan pembayaran, tidak bisa dibatalkan lagi.');
    }

    var orderId = keTeks_(bayar.order_id);
    var order = cariBaris('sales_orders', 'order_id', orderId);
    if (!order) {
      throw errorApp('NOT_FOUND', 'Invoice untuk pembayaran ini tidak ditemukan.');
    }

    var customer = cariBaris('customers', 'code', keTeks_(order.customer_code));
    wajibCustomerMiliknya_(customer, sesi);

    // Pembayaran yang sudah pernah dibatalkan tidak boleh dibatalkan dua kali.
    var sudahDibatalkan = false;
    bacaTabel('payments').forEach(function (b) {
      if (keTeks_(b.reference).indexOf('pembatalan ' + idBayar) === 0) {
        sudahDibatalkan = true;
      }
    });
    if (sudahDibatalkan) {
      throw errorApp('BAD_REQUEST', 'Pembayaran ' + idBayar + ' sudah dibatalkan.');
    }

    var barisBalik = [{
      payment_id: idBerikutnya_('payments', 'payment_id', 'PAY'),
      order_id: orderId,
      payment_date: hariIni_(),
      amount: -jumlah,
      method: keTeks_(bayar.method),
      reference: 'pembatalan ' + idBayar + ' — ' + alasan,
      created_by: sesi.username
    }];

    tambahBaris('payments', barisBalik);

    var totalBaru = totalBayarPerOrder_()[orderId] || 0;
    var statusBaru = hitungStatus_(totalBaru, keAngka_(order.subtotal));
    if (statusBaru !== keTeks_(order.status).toLowerCase()) {
      perbaruiBaris('sales_orders', 'order_id', orderId, { status: statusBaru });
    }

    catatAudit(sesi, 'payment.reverse',
      { payment_id: idBayar, amount: jumlah, alasan: alasan }, 'BERHASIL');

    return {
      payment_id_asli: idBayar,
      payment_id_pembatalan: barisBalik[0].payment_id,
      invoice_no: keTeks_(order.invoice_no),
      total_dibayar: totalBaru,
      sisa: keAngka_(order.subtotal) - totalBaru,
      status: statusBaru
    };
  });
}


/** payment.listByOrder — seluruh pembayaran satu invoice. */
function paymentListByOrder(payload, sesi) {
  var p = payload || {};
  var kunci = keTeks_(p.order_id) || keTeks_(p.invoice_no);
  if (!kunci) {
    throw errorApp('BAD_REQUEST', 'order_id atau invoice_no wajib diisi.');
  }

  var order = cariBaris('sales_orders', 'order_id', kunci) ||
              cariBaris('sales_orders', 'invoice_no', kunci);
  if (!order) throw errorApp('NOT_FOUND', 'Invoice ' + kunci + ' tidak ditemukan.');

  var customer = cariBaris('customers', 'code', keTeks_(order.customer_code));
  wajibCustomerMiliknya_(customer, sesi);

  var orderId = keTeks_(order.order_id);
  var daftar = bacaTabel('payments')
    .filter(function (b) { return keTeks_(b.order_id) === orderId; })
    .map(function (b) {
      return {
        payment_id: keTeks_(b.payment_id),
        payment_date: keTanggalStr_(b.payment_date),
        amount: keAngka_(b.amount),
        method: keTeks_(b.method),
        reference: keTeks_(b.reference),
        created_by: keTeks_(b.created_by),
        pembatalan: keAngka_(b.amount) < 0
      };
    });

  daftar.sort(function (a, b) {
    return a.payment_date < b.payment_date ? -1 : 1;
  });

  var total = daftar.reduce(function (s, b) { return s + b.amount; }, 0);
  var subtotal = keAngka_(order.subtotal);

  return {
    order_id: orderId,
    invoice_no: keTeks_(order.invoice_no),
    subtotal: subtotal,
    total_dibayar: total,
    sisa: subtotal - total,
    status: keTeks_(order.status).toLowerCase(),
    daftar: daftar
  };
}


// ---------------------------------------------------------------------------
// Aging piutang
// ---------------------------------------------------------------------------

var EMBER_AGING = [
  { kunci: 'belum_jatuh_tempo', label: 'Belum jatuh tempo', min: -99999, maks: 0 },
  { kunci: 'h1_30', label: '1–30 hari', min: 1, maks: 30 },
  { kunci: 'h31_60', label: '31–60 hari', min: 31, maks: 60 },
  { kunci: 'h61_90', label: '61–90 hari', min: 61, maks: 90 },
  { kunci: 'h90plus', label: 'Lebih dari 90 hari', min: 91, maks: 999999 }
];


/**
 * receivable.aging — piutang dikelompokkan menurut umur keterlambatan.
 *
 * payload: { per_tanggal: '2026-08-17' }   opsional, default hari ini
 *
 * Umur dihitung dari jatuh tempo, bukan dari tanggal invoice. Invoice tempo
 * 30 hari yang dibuat 40 hari lalu berarti terlambat 10 hari, bukan 40.
 *
 * Yang TIDAK masuk hitungan:
 *   - invoice dibatalkan
 *   - invoice berstatus 'paid'
 *
 * Pengecualian kedua penting. Seluruh invoice historis ditandai lunas saat
 * migrasi tanpa baris pembayaran, jadi selisih subtotal dikurangi pembayaran
 * akan memunculkan seluruh omzet dua tahun sebagai tunggakan.
 */
function receivableAging(payload, sesi) {
  var p = payload || {};
  var per = p.per_tanggal ? wajibTanggal_(p.per_tanggal, 'Tanggal') : hariIni_();

  var petaCust = petaBerdasarkan('customers', 'code');
  var bayarPerOrder = totalBayarPerOrder_();

  var totalEmber = {};
  EMBER_AGING.forEach(function (e) { totalEmber[e.kunci] = 0; });

  var perCustomer = {};
  var totalPiutang = 0;
  var totalTerlambat = 0;
  var jumlahInvoice = 0;
  var dikecualikan = 0;

  bacaTabel('sales_orders').forEach(function (o) {
    var status = keTeks_(o.status).toLowerCase();
    if (status === 'cancelled') return;

    var kodeCust = keTeks_(o.customer_code).toUpperCase();
    var customer = petaCust[kodeCust];
    if (!bolehLihatCustomer_(customer, sesi)) return;

    var orderId = keTeks_(o.order_id);
    var subtotal = keAngka_(o.subtotal);
    var dibayar = bayarPerOrder[orderId] || 0;

    if (status === 'paid') {
      if (dibayar === 0) dikecualikan++;
      return;
    }

    var sisa = subtotal - dibayar;
    if (sisa <= 0.5) return;

    var jatuhTempo = keTanggalStr_(o.due_date);
    var umur = selisihHari_(jatuhTempo, per);
    var ember = emberUntuk_(umur);

    totalEmber[ember.kunci] += sisa;
    totalPiutang += sisa;
    jumlahInvoice++;
    if (umur > 0) totalTerlambat += sisa;

    if (!perCustomer[kodeCust]) {
      perCustomer[kodeCust] = {
        code: kodeCust,
        nama: customer ? keTeks_(customer.name) : '(customer terhapus)',
        area: customer ? keTeks_(customer.area) : '',
        sales_person: customer ? keTeks_(customer.sales_person) : '',
        telepon: customer ? keTeks_(customer.phone) : '',
        tempo_hari: customer ? Math.round(keAngka_(customer.payment_term_days)) : 30,
        total: 0,
        terlambat: 0,
        umur_tertua: 0,
        ember: {},
        invoice: []
      };
      EMBER_AGING.forEach(function (e) { perCustomer[kodeCust].ember[e.kunci] = 0; });
    }

    var c = perCustomer[kodeCust];
    c.total += sisa;
    c.ember[ember.kunci] += sisa;
    if (umur > 0) c.terlambat += sisa;
    if (umur > c.umur_tertua) c.umur_tertua = umur;

    c.invoice.push({
      order_id: orderId,
      invoice_no: keTeks_(o.invoice_no),
      order_date: keTanggalStr_(o.order_date),
      due_date: jatuhTempo,
      subtotal: subtotal,
      dibayar: dibayar,
      sisa: sisa,
      status: status,
      umur_hari: umur,
      ember: ember.kunci
    });
  });

  var daftar = [];
  for (var kode in perCustomer) {
    var c = perCustomer[kode];
    c.invoice.sort(function (a, b) { return b.umur_hari - a.umur_hari; });
    daftar.push(c);
  }
  // Yang paling lama menunggak lebih dulu — itu yang perlu ditelepon duluan.
  daftar.sort(function (a, b) {
    if (b.umur_tertua !== a.umur_tertua) return b.umur_tertua - a.umur_tertua;
    return b.total - a.total;
  });

  return {
    per_tanggal: per,
    ringkasan: {
      total_piutang: totalPiutang,
      total_terlambat: totalTerlambat,
      jumlah_invoice: jumlahInvoice,
      jumlah_customer: daftar.length
    },
    ember: EMBER_AGING.map(function (e) {
      return {
        kunci: e.kunci,
        label: e.label,
        nilai: totalEmber[e.kunci],
        persen: totalPiutang > 0
          ? Math.round(totalEmber[e.kunci] / totalPiutang * 100) : 0
      };
    }),
    customer: daftar,
    // Frontend perlu menjelaskan angka ini ke pengguna, bukan menyembunyikannya.
    invoice_dikecualikan: dikecualikan,
    catatan_pengecualian: dikecualikan > 0
      ? dikecualikan + ' invoice berstatus lunas tanpa rincian pembayaran ' +
        '(ditandai lunas saat migrasi dari Excel) tidak dihitung sebagai piutang.'
      : ''
  };
}


/* --- pembantu -------------------------------------------------------------- */

function emberUntuk_(umurHari) {
  for (var i = 0; i < EMBER_AGING.length; i++) {
    if (umurHari >= EMBER_AGING[i].min && umurHari <= EMBER_AGING[i].maks) {
      return EMBER_AGING[i];
    }
  }
  return EMBER_AGING[EMBER_AGING.length - 1];
}

/**
 * Tentukan status dari total pembayaran.
 *
 * Ambang setengah rupiah dipakai supaya pembulatan tidak pernah menyisakan
 * invoice berstatus 'partial' dengan sisa nol koma sekian.
 */
function hitungStatus_(totalDibayar, subtotal) {
  if (totalDibayar >= subtotal - 0.5) return 'paid';
  if (totalDibayar > 0.5) return 'partial';
  return 'unpaid';
}
