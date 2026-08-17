/**
 * Dashboard.gs — angka ringkas untuk halaman depan.
 *
 * Seluruhnya hasil agregasi dari data transaksi. Tidak ada satu pun angka
 * yang disimpan di kolom tersendiri, sehingga tidak ada yang bisa basi.
 * Inilah bedanya dengan Excel lama, yang punya sheet Statistik berisi formula
 * dengan posisi sel hardcode dan angka yang perlahan menyimpang dari
 * kenyataan.
 *
 * Semua dikembalikan dalam SATU panggilan, bukan empat.
 * Setiap permintaan ke Apps Script memakan waktu satu sampai dua detik
 * karena harus melewati redirect googleusercontent. Empat panggilan berarti
 * halaman depan menunggu delapan detik sebelum menampilkan apa pun.
 *
 * Tidak ada isi soal stok. Model bisnisnya pre-order — produksi mengikuti
 * pesanan yang masuk, tidak ada penyetokan barang jadi, sehingga angka stok
 * dan alert stok minimum tidak bermakna.
 */


/**
 * dashboard.summary
 *
 * payload: { bulan: 12 }   jumlah bulan pada grafik tren, default 12
 *
 * Role sales hanya menerima angka dari customer-nya sendiri, dan tidak
 * menerima margin sama sekali. Penyaringan dilakukan di sini, bukan dengan
 * menyembunyikan kartu di frontend.
 */
function dashboardSummary(payload, sesi) {
  var p = payload || {};
  var jumlahBulan = Math.min(Math.max(Math.round(keAngka_(p.bulan)) || 12, 3), 24);
  var penuh = sesi.role === 'admin';

  var petaCust = petaBerdasarkan('customers', 'code');
  var petaProduk = petaBerdasarkan('products', 'code');
  var bayarPerOrder = totalBayarPerOrder_();

  var hariIni = hariIni_();
  var bulanIni = hariIni.substring(0, 7);
  var bulanLalu = mundurBulan_(bulanIni, 1);

  // --- kumpulkan order yang boleh dilihat sesi ini ------------------------
  var orderTerpakai = {};
  var ringkas = {
    omzet_total: 0,
    omzet_bulan_ini: 0,
    omzet_bulan_lalu: 0,
    invoice_total: 0,
    invoice_bulan_ini: 0,
    piutang: 0,
    piutang_jatuh_tempo: 0,
    invoice_jatuh_tempo: 0,
    dibatalkan: 0
  };
  var perBulan = {};

  bacaTabel('sales_orders').forEach(function (o) {
    var customer = petaCust[keTeks_(o.customer_code).toUpperCase()];
    if (!bolehLihatCustomer_(customer, sesi)) return;

    var status = keTeks_(o.status).toLowerCase() || 'unpaid';
    var orderId = keTeks_(o.order_id);
    var tgl = keTanggalStr_(o.order_date);
    var subtotal = keAngka_(o.subtotal);

    if (status === 'cancelled') {
      ringkas.dibatalkan++;
      return;
    }

    orderTerpakai[orderId] = true;
    ringkas.omzet_total += subtotal;
    ringkas.invoice_total++;

    var bln = tgl.substring(0, 7);
    if (bln === bulanIni) {
      ringkas.omzet_bulan_ini += subtotal;
      ringkas.invoice_bulan_ini++;
    } else if (bln === bulanLalu) {
      ringkas.omzet_bulan_lalu += subtotal;
    }

    if (!perBulan[bln]) perBulan[bln] = { omzet: 0, invoice: 0, hpp: 0 };
    perBulan[bln].omzet += subtotal;
    perBulan[bln].invoice++;

    // Invoice berstatus 'paid' tidak dihitung sebagai piutang meski tabel
    // payments kosong — seluruh invoice historis ditandai lunas saat migrasi
    // tanpa rincian pembayarannya.
    if (status !== 'paid') {
      var sisa = subtotal - (bayarPerOrder[orderId] || 0);
      if (sisa > 0) {
        ringkas.piutang += sisa;
        if (keTanggalStr_(o.due_date) < hariIni) {
          ringkas.piutang_jatuh_tempo += sisa;
          ringkas.invoice_jatuh_tempo++;
        }
      }
    }
  });

  // --- item: produk terlaris dan HPP --------------------------------------
  var perProduk = {};
  var hppTotal = 0;
  var adaHppKosong = false;

  bacaTabel('sales_order_items').forEach(function (it) {
    var orderId = keTeks_(it.order_id);
    if (!orderTerpakai[orderId]) return;

    var kode = keTeks_(it.product_code).toUpperCase();
    var qty = keAngka_(it.qty);
    var nilai = keAngka_(it.line_total);
    var hpp = keAngka_(it.unit_cogs) * qty;

    if (keAngka_(it.unit_cogs) <= 0) adaHppKosong = true;
    hppTotal += hpp;

    if (!perProduk[kode]) {
      perProduk[kode] = { code: kode, qty: 0, nilai: 0, hpp: 0 };
    }
    perProduk[kode].qty += qty;
    perProduk[kode].nilai += nilai;
    perProduk[kode].hpp += hpp;
  });

  var produkTeratas = [];
  for (var kode in perProduk) {
    var pr = petaProduk[kode];
    produkTeratas.push({
      code: kode,
      nama: pr ? keTeks_(pr.name) : '(produk terhapus)',
      kemasan: pr ? keTeks_(pr.packaging_type) : '',
      qty: perProduk[kode].qty,
      nilai: perProduk[kode].nilai,
      margin: penuh ? perProduk[kode].nilai - perProduk[kode].hpp : null
    });
  }
  produkTeratas.sort(function (a, b) { return b.qty - a.qty; });

  // --- customer teratas ---------------------------------------------------
  var perCustomer = {};
  bacaTabel('sales_orders').forEach(function (o) {
    if (!orderTerpakai[keTeks_(o.order_id)]) return;
    var kode = keTeks_(o.customer_code).toUpperCase();
    if (!perCustomer[kode]) perCustomer[kode] = { nilai: 0, invoice: 0 };
    perCustomer[kode].nilai += keAngka_(o.subtotal);
    perCustomer[kode].invoice++;
  });

  var customerTeratas = [];
  for (var kc in perCustomer) {
    var c = petaCust[kc];
    customerTeratas.push({
      code: kc,
      nama: c ? keTeks_(c.name) : '(customer terhapus)',
      area: c ? keTeks_(c.area) : '',
      nilai: perCustomer[kc].nilai,
      invoice: perCustomer[kc].invoice
    });
  }
  customerTeratas.sort(function (a, b) { return b.nilai - a.nilai; });

  // --- galon beredar ------------------------------------------------------
  // Indikator risiko aset: galon fisik yang sedang berada di tangan customer
  // dan belum kembali. Ini satu-satunya "persediaan" yang tetap relevan pada
  // model pre-order, karena galonnya milik perusahaan dan bisa hilang.
  var saldoGalon = {};
  bacaTabel('gallon_ledger').forEach(function (g) {
    var kode = keTeks_(g.customer_code).toUpperCase();
    if (!bolehLihatCustomer_(petaCust[kode], sesi)) return;
    saldoGalon[kode] = (saldoGalon[kode] || 0) + keAngka_(g.qty);
  });

  var galonBeredar = [];
  var totalGalon = 0;
  for (var kg in saldoGalon) {
    if (saldoGalon[kg] <= 0) continue;
    totalGalon += saldoGalon[kg];
    var cg = petaCust[kg];
    galonBeredar.push({
      code: kg,
      nama: cg ? keTeks_(cg.name) : '(customer terhapus)',
      saldo: saldoGalon[kg]
    });
  }
  galonBeredar.sort(function (a, b) { return b.saldo - a.saldo; });

  // --- tren bulanan -------------------------------------------------------
  // Bulan tanpa transaksi tetap dikeluarkan sebagai nol, supaya grafiknya
  // menunjukkan jeda yang sebenarnya, bukan memampatkannya jadi garis mulus.
  var bulanan = [];
  var kursor = bulanIni;
  for (var i = 0; i < jumlahBulan; i++) {
    var b = perBulan[kursor] || { omzet: 0, invoice: 0 };
    bulanan.unshift({
      bulan: kursor,
      label: labelBulan_(kursor),
      omzet: b.omzet,
      invoice: b.invoice
    });
    kursor = mundurBulan_(kursor, 1);
  }

  var pertumbuhan = ringkas.omzet_bulan_lalu > 0
    ? Math.round((ringkas.omzet_bulan_ini - ringkas.omzet_bulan_lalu) /
                 ringkas.omzet_bulan_lalu * 100)
    : null;

  return {
    role: sesi.role,
    dashboard_penuh: penuh,
    per: hariIni,
    ringkasan: {
      omzet_total: ringkas.omzet_total,
      omzet_bulan_ini: ringkas.omzet_bulan_ini,
      omzet_bulan_lalu: ringkas.omzet_bulan_lalu,
      pertumbuhan_persen: pertumbuhan,
      invoice_total: ringkas.invoice_total,
      invoice_bulan_ini: ringkas.invoice_bulan_ini,
      invoice_dibatalkan: ringkas.dibatalkan,
      piutang: ringkas.piutang,
      piutang_jatuh_tempo: ringkas.piutang_jatuh_tempo,
      invoice_jatuh_tempo: ringkas.invoice_jatuh_tempo,
      // Margin hanya untuk admin. Sales tidak berhak melihat HPP.
      hpp_total: penuh ? hppTotal : null,
      margin_total: penuh ? ringkas.omzet_total - hppTotal : null,
      margin_persen: penuh && ringkas.omzet_total > 0
        ? Math.round((ringkas.omzet_total - hppTotal) / ringkas.omzet_total * 100)
        : null,
      // Frontend perlu tahu bahwa margin dihitung dari data yang belum lengkap,
      // supaya tidak menyajikan angka yang terlihat pasti padahal bukan.
      margin_bisa_dipercaya: penuh && !adaHppKosong
    },
    bulanan: bulanan,
    produk_teratas: produkTeratas.slice(0, 8),
    customer_teratas: customerTeratas.slice(0, 8),
    galon: {
      total_beredar: totalGalon,
      customer: galonBeredar.slice(0, 8)
    }
  };
}


/* --- pembantu tanggal ------------------------------------------------------ */

/** '2026-08' mundur n bulan -> '2026-07' */
function mundurBulan_(bulanStr, n) {
  var thn = parseInt(bulanStr.substring(0, 4), 10);
  var bln = parseInt(bulanStr.substring(5, 7), 10) - n;
  while (bln < 1) { bln += 12; thn--; }
  while (bln > 12) { bln -= 12; thn++; }
  return thn + '-' + (bln < 10 ? '0' + bln : String(bln));
}

var NAMA_BULAN_PENDEK = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
                         'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** '2026-08' -> 'Agu 26' */
function labelBulan_(bulanStr) {
  var bln = parseInt(bulanStr.substring(5, 7), 10);
  return NAMA_BULAN_PENDEK[bln - 1] + ' ' + bulanStr.substring(2, 4);
}
