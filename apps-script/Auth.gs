/**
 * Auth.gs — autentikasi dan penegakan hak akses.
 *
 * Endpoint web app ini di-deploy dengan akses "Anyone", yang berarti URL-nya
 * publik dan siapa pun bisa memanggilnya. Google tidak menyediakan lapisan
 * autentikasi untuk kasus ini, jadi seluruhnya dibangun di file ini.
 *
 * Bentuk token:
 *
 *     base64url(payload) + "." + HMAC-SHA256(base64url(payload), SECRET_KEY)
 *
 * Yang ditandatangani adalah hasil base64-nya, bukan JSON mentahnya. Kalau
 * yang ditandatangani JSON mentah, urutan kunci saat serialisasi ulang bisa
 * berbeda dan tanda tangan yang sah akan ditolak.
 *
 * Batas yang harus disadari: ini bukan keamanan tingkat perbankan. Memadai
 * untuk sistem internal 3-10 pengguna. Begitu sistem menyentuh kanal belanja
 * atau data pihak ketiga, lapisan ini wajib diganti penyedia auth sungguhan.
 */

var TOKEN_BERLAKU_JAM = 8;
var PANJANG_PASSWORD_MINIMAL = 8;


// ---------------------------------------------------------------------------
// Primitif kriptografi
// ---------------------------------------------------------------------------

/** Ubah array byte bertanda dari Utilities menjadi heksadesimal huruf kecil. */
function keHex_(bytes) {
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] + 256) % 256;      // byte Apps Script bertanda (-128..127)
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex;
}

/**
 * SHA-256 dari (password + salt).
 *
 * Rumusnya harus identik dengan scripts/migrate_excel.py, karena hash user
 * hasil migrasi dibuat di sana. Kalau salah satu berubah, seluruh user lama
 * tidak akan bisa login.
 */
function hashPassword_(password, salt) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(password) + String(salt),
    Utilities.Charset.UTF_8
  );
  return keHex_(bytes);
}

function hmacHex_(data, kunci) {
  return keHex_(Utilities.computeHmacSha256Signature(data, kunci));
}

/**
 * Perbandingan yang waktunya tidak bergantung pada isi.
 *
 * Perbandingan string biasa berhenti di karakter pertama yang berbeda,
 * sehingga lamanya proses membocorkan berapa banyak karakter awal yang benar.
 * Untuk membandingkan tanda tangan, seluruh karakter harus selalu diperiksa.
 */
function samaAman_(a, b) {
  var sa = String(a);
  var sb = String(b);
  if (sa.length !== sb.length) return false;
  var beda = 0;
  for (var i = 0; i < sa.length; i++) {
    beda |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
  }
  return beda === 0;
}


// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

function buatToken_(user) {
  var payload = {
    user_id: keTeks_(user.user_id),
    username: keTeks_(user.username),
    role: keTeks_(user.role),
    sales_person_name: keTeks_(user.sales_person_name),
    exp: Date.now() + TOKEN_BERLAKU_JAM * 60 * 60 * 1000
  };

  var b64 = Utilities.base64EncodeWebSafe(
    JSON.stringify(payload), Utilities.Charset.UTF_8
  );
  return b64 + '.' + hmacHex_(b64, prop_('SECRET_KEY'));
}

/**
 * Verifikasi token dan kembalikan isinya.
 *
 * Urutannya penting: tanda tangan diperiksa lebih dulu, baru isinya dibaca.
 * Membaca payload sebelum tanda tangan terbukti sah berarti memproses data
 * yang bisa dikarang siapa saja.
 */
function verifikasiToken_(token) {
  var t = keTeks_(token);
  if (!t) {
    throw errorApp('UNAUTHORIZED', 'Anda belum login.');
  }

  var pisah = t.split('.');
  if (pisah.length !== 2) {
    throw errorApp('UNAUTHORIZED', 'Sesi tidak sah. Silakan login ulang.');
  }

  var harusnya = hmacHex_(pisah[0], prop_('SECRET_KEY'));
  if (!samaAman_(pisah[1], harusnya)) {
    throw errorApp('UNAUTHORIZED', 'Sesi tidak sah. Silakan login ulang.');
  }

  var sesi;
  try {
    sesi = JSON.parse(
      Utilities.newBlob(Utilities.base64DecodeWebSafe(pisah[0])).getDataAsString()
    );
  } catch (e) {
    throw errorApp('UNAUTHORIZED', 'Sesi tidak sah. Silakan login ulang.');
  }

  if (!sesi.exp || Date.now() > sesi.exp) {
    throw errorApp('TOKEN_EXPIRED', 'Sesi Anda sudah berakhir. Silakan login kembali.');
  }

  return sesi;
}

/**
 * Pastikan role pengguna termasuk yang diizinkan.
 *
 * Ini adalah satu-satunya tempat hak akses ditegakkan. Menyembunyikan menu di
 * frontend hanya membuat tampilan rapi — siapa pun bisa memanggil endpoint
 * langsung tanpa lewat antarmuka.
 */
function wajibRole_(sesi, daftarRole) {
  if (daftarRole.indexOf(sesi.role) < 0) {
    throw errorApp('FORBIDDEN',
      'Role "' + sesi.role + '" tidak berhak melakukan tindakan ini.');
  }
  return true;
}


// ---------------------------------------------------------------------------
// Action: auth.*
// ---------------------------------------------------------------------------

/**
 * auth.login — tukar username + password dengan token.
 *
 * Pesan kesalahan sengaja dibuat sama untuk username tidak ada maupun password
 * salah. Membedakan keduanya memberi tahu penyerang username mana yang nyata.
 */
function authLogin(payload) {
  var username = keTeks_(payload && payload.username).toLowerCase();
  var password = String((payload && payload.password) || '');

  if (!username || !password) {
    throw errorApp('BAD_REQUEST', 'Username dan password wajib diisi.');
  }

  var user = null;
  var daftar = bacaTabel('users');
  for (var i = 0; i < daftar.length; i++) {
    if (keTeks_(daftar[i].username).toLowerCase() === username) {
      user = daftar[i];
      break;
    }
  }

  if (!user || !samaAman_(hashPassword_(password, keTeks_(user.salt)),
                          keTeks_(user.password_hash))) {
    catatAudit(null, 'auth.login', { username: username }, 'GAGAL: kredensial salah');
    throw errorApp('UNAUTHORIZED', 'Username atau password salah.');
  }

  if (!keBool_(user.is_active)) {
    catatAudit(null, 'auth.login', { username: username }, 'GAGAL: akun nonaktif');
    throw errorApp('FORBIDDEN',
      'Akun ini sudah dinonaktifkan. Hubungi administrator.');
  }

  catatAudit(
    { user_id: keTeks_(user.user_id), username: keTeks_(user.username) },
    'auth.login', { username: username }, 'BERHASIL'
  );

  return {
    token: buatToken_(user),
    user: {
      user_id: keTeks_(user.user_id),
      username: keTeks_(user.username),
      full_name: keTeks_(user.full_name),
      role: keTeks_(user.role),
      sales_person_name: keTeks_(user.sales_person_name)
    },
    expires_in_hours: TOKEN_BERLAKU_JAM
  };
}


/**
 * auth.me — kembalikan profil pengguna dari sheet, bukan dari token.
 *
 * Isi token dibekukan saat login. Kalau admin mengubah role seseorang di
 * tengah sesi, token lamanya masih menyebut role lama. Karena itu data
 * profil selalu dibaca ulang dari tab users.
 */
function authMe(payload, sesi) {
  var user = cariBaris('users', 'user_id', sesi.user_id);
  if (!user) {
    throw errorApp('UNAUTHORIZED', 'Akun tidak ditemukan. Silakan login ulang.');
  }
  if (!keBool_(user.is_active)) {
    throw errorApp('FORBIDDEN', 'Akun ini sudah dinonaktifkan.');
  }

  return {
    user_id: keTeks_(user.user_id),
    username: keTeks_(user.username),
    full_name: keTeks_(user.full_name),
    role: keTeks_(user.role),
    sales_person_name: keTeks_(user.sales_person_name),
    // Role di token bisa tertinggal kalau baru saja diubah admin. Frontend
    // memakai selisih ini untuk memaksa login ulang.
    role_pada_token: keTeks_(sesi.role),
    token_kedaluwarsa_pada: Utilities.formatDate(
      new Date(sesi.exp), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm:ss')
  };
}


/**
 * auth.logout
 *
 * Token ini tanpa status di sisi server, jadi tidak ada yang bisa dibatalkan.
 * Yang benar-benar terjadi: frontend membuang token dari sessionStorage.
 * Token itu sendiri tetap sah sampai kedaluwarsa.
 *
 * Konsekuensinya nyata: token yang sempat bocor tidak bisa dicabut sebelum
 * 8 jam berlalu. Untuk mencabut lebih cepat, ganti SECRET_KEY di Script
 * Properties — itu langsung membatalkan seluruh token yang beredar.
 */
function authLogout(payload, sesi) {
  catatAudit(sesi, 'auth.logout', {}, 'BERHASIL');
  return { pesan: 'Berhasil keluar. Token akan kedaluwarsa dengan sendirinya.' };
}


/**
 * auth.changePassword — mengganti password diri sendiri.
 *
 * Hanya untuk akun yang sedang login. Reset password orang lain adalah
 * wewenang admin dan ditangani terpisah lewat user.upsert.
 */
function authChangePassword(payload, sesi) {
  var lama = String((payload && payload.password_lama) || '');
  var baru = String((payload && payload.password_baru) || '');

  if (!lama || !baru) {
    throw errorApp('BAD_REQUEST', 'Password lama dan password baru wajib diisi.');
  }
  if (baru.length < PANJANG_PASSWORD_MINIMAL) {
    throw errorApp('BAD_REQUEST',
      'Password baru minimal ' + PANJANG_PASSWORD_MINIMAL + ' karakter.');
  }
  if (baru === lama) {
    throw errorApp('BAD_REQUEST', 'Password baru harus berbeda dari yang lama.');
  }

  return denganKunci(function () {
    var user = cariBaris('users', 'user_id', sesi.user_id);
    if (!user) throw errorApp('NOT_FOUND', 'Akun tidak ditemukan.');

    if (!samaAman_(hashPassword_(lama, keTeks_(user.salt)),
                   keTeks_(user.password_hash))) {
      catatAudit(sesi, 'auth.changePassword', {}, 'GAGAL: password lama salah');
      throw errorApp('UNAUTHORIZED', 'Password lama salah.');
    }

    // Salt ikut diganti supaya hash lama yang mungkin sempat bocor tidak
    // bisa dipakai untuk menebak apa pun tentang password baru.
    var saltBaru = Utilities.getUuid().replace(/-/g, '');
    perbaruiBaris('users', 'user_id', sesi.user_id, {
      salt: saltBaru,
      password_hash: hashPassword_(baru, saltBaru)
    });

    catatAudit(sesi, 'auth.changePassword', {}, 'BERHASIL');
    return { pesan: 'Password berhasil diganti. Gunakan password baru saat login berikutnya.' };
  });
}
