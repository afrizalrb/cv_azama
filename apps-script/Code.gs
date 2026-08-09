/**
 * Code.gs — pintu masuk tunggal seluruh sistem.
 *
 * Semua permintaan masuk lewat satu endpoint POST. Yang menentukan apa yang
 * dikerjakan adalah field `action` di dalam badan permintaan, bukan URL.
 *
 * Bentuk permintaan (Content-Type: text/plain):
 *
 *     { "action": "sales.create", "token": "<token>", "payload": { ... } }
 *
 * Bentuk balasan:
 *
 *     { "ok": true,  "data": { ... } }
 *     { "ok": false, "error": { "code": "FORBIDDEN", "message": "..." } }
 *
 * Kenapa text/plain dan bukan application/json:
 * application/json memicu preflight OPTIONS dari browser, dan Apps Script
 * tidak melayani OPTIONS. Permintaannya akan gagal di CORS sebelum sempat
 * sampai ke kode ini. Dengan text/plain, browser menganggapnya permintaan
 * sederhana dan mengirim langsung. Isinya tetap JSON, hanya labelnya berbeda.
 */


// ---------------------------------------------------------------------------
// TABEL RUTE
//
// Satu baris per action. Kolom `roles` adalah penegakan hak akses yang
// sesungguhnya — bukan menu yang disembunyikan di frontend.
//
//   publik : true  -> tidak perlu token sama sekali
//   roles  : []    -> perlu token, role apa pun boleh
//   roles  : [...] -> perlu token, hanya role yang disebut
// ---------------------------------------------------------------------------

var RUTE = {
  'ping':                 { fn: aksiPing,          publik: true },
  'auth.login':           { fn: authLogin,         publik: true },
  'auth.me':              { fn: authMe,            roles: [] },
  'auth.logout':          { fn: authLogout,        roles: [] },
  'auth.changePassword':  { fn: authChangePassword, roles: [] },
  'system.diagnostics':   { fn: aksiDiagnostics,   roles: ['admin'] }
};


// ---------------------------------------------------------------------------
// Titik masuk
// ---------------------------------------------------------------------------

function doPost(e) {
  var aksi = '(belum terbaca)';
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return balas_(false, null, 'BAD_REQUEST',
        'Permintaan kosong. Badan permintaan harus berisi JSON.');
    }

    var req;
    try {
      req = JSON.parse(e.postData.contents);
    } catch (err) {
      return balas_(false, null, 'BAD_REQUEST',
        'Badan permintaan bukan JSON yang sah.');
    }

    aksi = keTeks_(req.action);
    return jalankanAksi_(aksi, req.payload || {}, keTeks_(req.token));

  } catch (err) {
    // Jaring pengaman terakhir. Kalau sampai ke sini, ada yang salah di luar
    // dugaan — dicatat lengkap di log Apps Script, tapi yang dikirim ke
    // pengguna hanya pesan umum.
    console.error('doPost gagal total pada aksi "' + aksi + '": ' +
                  err.message + '\n' + (err.stack || ''));
    return balas_(false, null, 'INTERNAL', 'Terjadi kesalahan pada sistem.');
  }
}


/**
 * doGet — hanya untuk memastikan web app hidup.
 *
 * Berguna karena bisa dibuka langsung di browser, tanpa curl. Kalau URL /exec
 * dibuka dan muncul JSON di bawah ini, artinya deployment sudah benar.
 * Tidak ada satu pun data bisnis yang bisa diambil lewat sini.
 */
function doGet(e) {
  return balas_(true, {
    service: 'AZAMA API',
    status: 'aktif',
    waktu_server: sekarang_(),
    catatan: 'Seluruh operasi memakai POST dengan Content-Type text/plain.'
  });
}


/**
 * Cari rute, tegakkan hak akses, jalankan handler.
 *
 * Token diverifikasi sebelum handler dipanggil, tanpa kecuali. Tidak ada
 * handler yang boleh menerima permintaan yang belum lolos pemeriksaan.
 */
function jalankanAksi_(aksi, payload, token) {
  var rute = RUTE[aksi];

  if (!rute) {
    return balas_(false, null, 'UNKNOWN_ACTION',
      'Action "' + aksi + '" tidak dikenal. Action yang tersedia: ' +
      Object.keys(RUTE).sort().join(', '));
  }

  var sesi = null;
  try {
    if (!rute.publik) {
      sesi = verifikasiToken_(token);
      if (rute.roles && rute.roles.length) {
        wajibRole_(sesi, rute.roles);
      }
    }
    return balas_(true, rute.fn(payload, sesi));

  } catch (err) {
    var kode = err.kodeApp || 'INTERNAL';

    if (kode === 'INTERNAL') {
      // Error tak terduga: catat lengkap untuk kita, sembunyikan dari pengguna.
      // Pesan error mentah sering membocorkan struktur data dan nama kolom.
      console.error('Aksi "' + aksi + '" gagal: ' + err.message +
                    '\n' + (err.stack || ''));
      catatAudit(sesi, aksi, payload, 'ERROR: ' + err.message);
      return balas_(false, null, 'INTERNAL',
        'Terjadi kesalahan saat memproses permintaan. Hubungi administrator ' +
        'bila berulang.');
    }

    return balas_(false, null, kode, err.message);
  }
}


/** Susun balasan JSON. Satu-satunya tempat respons dibentuk. */
function balas_(ok, data, kode, pesan) {
  var isi = ok
    ? { ok: true, data: data === undefined ? null : data }
    : { ok: false, error: { code: kode, message: pesan } };

  return ContentService
    .createTextOutput(JSON.stringify(isi))
    .setMimeType(ContentService.MimeType.JSON);
}


// ---------------------------------------------------------------------------
// Action bawaan
// ---------------------------------------------------------------------------

/**
 * ping — uji hidup tanpa perlu token.
 *
 * Sengaja tidak menyentuh spreadsheet, supaya bisa membedakan dua kegagalan
 * yang berbeda: web app tidak ter-deploy, atau SPREADSHEET_ID salah.
 */
function aksiPing(payload) {
  return {
    service: 'AZAMA API',
    status: 'aktif',
    waktu_server: sekarang_(),
    versi_skema: Object.keys(SKEMA).length + ' tab'
  };
}


/**
 * system.diagnostics — potret kondisi data, khusus admin.
 *
 * Dipakai saat memastikan impor CSV berhasil dan angkanya masuk akal,
 * tanpa perlu membuka spreadsheet.
 */
function aksiDiagnostics(payload, sesi) {
  var jumlah = {};
  var gagal = [];

  for (var nama in SKEMA) {
    try {
      jumlah[nama] = bacaTabel(nama).length;
    } catch (e) {
      jumlah[nama] = null;
      gagal.push(nama);
    }
  }

  var omzet = 0;
  bacaTabel('sales_orders').forEach(function (o) {
    if (keTeks_(o.status) !== 'cancelled') omzet += keAngka_(o.subtotal);
  });

  return {
    jumlah_baris: jumlah,
    tab_bermasalah: gagal,
    total_omzet_tercatat: omzet,
    waktu_server: sekarang_(),
    diperiksa_oleh: sesi.username
  };
}
