/**
 * User.gs — manajemen pengguna. Admin saja.
 *
 * Password tidak pernah dikembalikan, bahkan hash-nya. Yang keluar dari sini
 * hanya identitas dan hak akses. Saat admin membuat user baru atau mereset
 * password, password polosnya dikembalikan SATU KALI dalam balasan itu saja
 * dan tidak pernah bisa dibaca lagi — sama seperti perilaku skrip migrasi.
 *
 * Dua penjagaan yang mudah terlewat kalau tidak ditulis eksplisit:
 *
 * 1. Admin terakhir tidak boleh dinonaktifkan atau diturunkan rolenya.
 *    Kalau itu terjadi, tidak ada seorang pun yang bisa mengelola user lagi,
 *    dan satu-satunya jalan keluar adalah menyunting spreadsheet langsung.
 *
 * 2. Username tidak bisa diubah setelah dibuat.
 *    Kolom created_by di seluruh tabel transaksi menyimpan username, bukan
 *    user_id. Mengubahnya akan memutus jejak siapa mengerjakan apa.
 */

var ROLE_SAH = ['admin', 'sales', 'produksi'];


/**
 * user.list — daftar pengguna.
 *
 * Ikut menghitung berapa transaksi yang pernah dibuat tiap user, supaya admin
 * tahu konsekuensinya sebelum menonaktifkan seseorang.
 */
function userList(payload, sesi) {
  var p = payload || {};
  var termasukNonaktif = p.termasuk_nonaktif !== false;

  var aktivitas = {};
  function hitung(nama, kolom) {
    bacaTabel(nama).forEach(function (b) {
      var u = keTeks_(b[kolom]).toLowerCase();
      if (!u) return;
      if (!aktivitas[u]) aktivitas[u] = { penjualan: 0, pembayaran: 0, produksi: 0 };
      aktivitas[u][nama === 'sales_orders' ? 'penjualan'
        : nama === 'payments' ? 'pembayaran' : 'produksi']++;
    });
  }
  hitung('sales_orders', 'created_by');
  hitung('payments', 'created_by');
  hitung('production_batches', 'created_by');

  // Nama sales yang benar-benar dipakai di master customer. Dipakai untuk
  // menandai akun sales yang salah ketik namanya — akun seperti itu login
  // dengan normal tapi tidak melihat satu pun customer.
  var salesTerpakai = {};
  bacaTabel('customers').forEach(function (c) {
    var s = keTeks_(c.sales_person).toLowerCase();
    if (s) salesTerpakai[s] = (salesTerpakai[s] || 0) + 1;
  });

  var daftar = [];
  bacaTabel('users').forEach(function (u) {
    var aktif = keBool_(u.is_active);
    if (!aktif && !termasukNonaktif) return;

    var username = keTeks_(u.username);
    var role = keTeks_(u.role);
    var namaSales = keTeks_(u.sales_person_name);
    var akt = aktivitas[username.toLowerCase()] ||
      { penjualan: 0, pembayaran: 0, produksi: 0 };

    daftar.push({
      user_id: keTeks_(u.user_id),
      username: username,
      full_name: keTeks_(u.full_name),
      role: role,
      sales_person_name: namaSales,
      is_active: aktif,
      diri_sendiri: keTeks_(u.user_id) === sesi.user_id,
      aktivitas: akt,
      total_aktivitas: akt.penjualan + akt.pembayaran + akt.produksi,
      jumlah_customer: role === 'sales'
        ? (salesTerpakai[namaSales.toLowerCase()] || 0) : null,
      // Akun sales yang namanya tidak cocok dengan satu pun customer akan
      // bisa login tapi melihat layar kosong. Gejalanya membingungkan, jadi
      // lebih baik ditandai di sini.
      peringatan: role === 'sales' && !namaSales
        ? 'Nama sales belum diisi — akun ini tidak akan melihat satu pun customer.'
        : role === 'sales' && !salesTerpakai[namaSales.toLowerCase()]
          ? 'Nama sales "' + namaSales + '" tidak cocok dengan customer mana pun.'
          : ''
    });
  });

  daftar.sort(function (a, b) {
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
    return a.username < b.username ? -1 : 1;
  });

  return {
    daftar: daftar,
    jumlah: daftar.length,
    jumlah_admin_aktif: daftar.filter(function (u) {
      return u.is_active && u.role === 'admin';
    }).length,
    role_tersedia: ROLE_SAH,
    // Nama sales yang dipakai di master, untuk membantu admin mengisi tanpa
    // salah ketik saat membuat akun sales baru.
    nama_sales_terpakai: Object.keys(salesTerpakai)
  };
}


/**
 * user.upsert — buat atau ubah pengguna.
 *
 * payload: {
 *   user_id:            kosong berarti membuat baru,
 *   username:           wajib saat membuat, diabaikan saat mengubah,
 *   full_name, role, sales_person_name, is_active,
 *   reset_password:     true untuk membangkitkan password baru
 * }
 */
function userUpsert(payload, sesi) {
  var p = payload || {};
  var userId = keTeks_(p.user_id);
  var namaLengkap = keTeks_(p.full_name);
  var role = keTeks_(p.role).toLowerCase();
  var namaSales = keTeks_(p.sales_person_name);
  var aktif = p.is_active === undefined ? true : p.is_active === true;

  if (!namaLengkap) throw errorApp('BAD_REQUEST', 'Nama lengkap wajib diisi.');
  if (ROLE_SAH.indexOf(role) < 0) {
    throw errorApp('BAD_REQUEST',
      'Role harus salah satu dari: ' + ROLE_SAH.join(', ') + '.');
  }
  if (role !== 'sales' && namaSales) {
    throw errorApp('BAD_REQUEST',
      'Nama sales hanya berlaku untuk role sales. Kosongkan untuk role ' + role + '.');
  }

  return denganKunci(function () {
    var semua = bacaTabel('users');
    var adminAktif = semua.filter(function (u) {
      return keBool_(u.is_active) && keTeks_(u.role) === 'admin';
    });

    // --- ubah pengguna yang sudah ada ---
    if (userId) {
      var user = cariBaris('users', 'user_id', userId);
      if (!user) throw errorApp('NOT_FOUND', 'Pengguna tidak ditemukan.');

      var adalahAdmin = keTeks_(user.role) === 'admin' && keBool_(user.is_active);
      var berhentiJadiAdmin = adalahAdmin && (role !== 'admin' || !aktif);
      if (berhentiJadiAdmin && adminAktif.length <= 1) {
        throw errorApp('BAD_REQUEST',
          'Ini satu-satunya admin aktif. Menonaktifkan atau menurunkan rolenya ' +
          'akan membuat tidak ada seorang pun yang bisa mengelola pengguna. ' +
          'Buat admin lain terlebih dahulu.');
      }
      if (keTeks_(user.user_id) === sesi.user_id && !aktif) {
        throw errorApp('BAD_REQUEST',
          'Anda tidak bisa menonaktifkan akun Anda sendiri.');
      }

      var perubahan = {
        full_name: namaLengkap,
        role: role,
        sales_person_name: namaSales,
        is_active: aktif
      };

      var passwordBaru = null;
      if (p.reset_password === true) {
        passwordBaru = buatPasswordAcak_();
        var salt = Utilities.getUuid().replace(/-/g, '');
        perubahan.salt = salt;
        perubahan.password_hash = hashPassword_(passwordBaru, salt);
      }

      perbaruiBaris('users', 'user_id', userId, perubahan);
      catatAudit(sesi, 'user.upsert', {
        user_id: userId, username: keTeks_(user.username),
        role: role, is_active: aktif, reset_password: passwordBaru !== null
      }, 'DIPERBARUI');

      return {
        user_id: userId,
        username: keTeks_(user.username),
        dibuat: false,
        password_baru: passwordBaru
      };
    }

    // --- buat pengguna baru ---
    var username = keTeks_(p.username).toLowerCase();
    if (!username) throw errorApp('BAD_REQUEST', 'Username wajib diisi.');
    if (!/^[a-z0-9._-]{3,20}$/.test(username)) {
      throw errorApp('BAD_REQUEST',
        'Username hanya boleh huruf kecil, angka, titik, garis bawah, dan ' +
        'garis pisah, 3 sampai 20 karakter.');
    }
    for (var i = 0; i < semua.length; i++) {
      if (keTeks_(semua[i].username).toLowerCase() === username) {
        throw errorApp('BAD_REQUEST', 'Username "' + username + '" sudah dipakai.');
      }
    }

    var password = buatPasswordAcak_();
    var saltBaru = Utilities.getUuid().replace(/-/g, '');

    var baris = [{
      user_id: Utilities.getUuid(),
      username: username,
      password_hash: hashPassword_(password, saltBaru),
      salt: saltBaru,
      full_name: namaLengkap,
      role: role,
      sales_person_name: namaSales,
      is_active: aktif
    }];

    tambahBaris('users', baris);
    catatAudit(sesi, 'user.upsert',
      { username: username, role: role }, 'DIBUAT');

    return {
      user_id: baris[0].user_id,
      username: username,
      dibuat: true,
      // Ditampilkan sekali, lalu hilang selamanya. Hanya hash-nya yang tersimpan.
      password_baru: password
    };
  });
}


/**
 * Password acak yang masih bisa dibacakan lewat telepon.
 *
 * Huruf yang mudah tertukar sengaja dibuang: i, l, 1, o, 0. Password yang
 * benar tapi salah dibaca akan menghabiskan waktu dua orang sekaligus.
 */
function buatPasswordAcak_() {
  var abjad = 'abcdefghjkmnpqrstuvwxyz';
  var angka = '23456789';
  var besar = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  var kumpulan = abjad + besar + angka;

  var hasil = '';
  for (var i = 0; i < 10; i++) {
    hasil += kumpulan.charAt(Math.floor(Math.random() * kumpulan.length));
  }
  // Pastikan memuat huruf besar dan angka, supaya selalu lolos aturan apa pun
  // yang mungkin ditambahkan kemudian.
  return hasil.substring(0, 8) +
    besar.charAt(Math.floor(Math.random() * besar.length)) +
    angka.charAt(Math.floor(Math.random() * angka.length));
}
