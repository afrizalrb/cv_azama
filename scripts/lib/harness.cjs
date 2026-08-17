/**
 * harness.cjs — tiruan lingkungan Apps Script untuk dijalankan di komputer.
 *
 * Menyediakan SpreadsheetApp, Utilities, LockService, PropertiesService, dan
 * ContentService versi memori, lalu memuat berkas .gs apa adanya. Dipakai
 * bersama oleh local_test.cjs (pengujian) dan local_server.cjs (server
 * pengembangan).
 *
 * Yang TIDAK ditiru, dan karena itu tidak akan pernah ketahuan di sini:
 *   - batas kuota Apps Script
 *   - perilaku LockService saat dua eksekusi benar-benar bersamaan
 *   - cara Google Sheets diam-diam mengubah tipe kolom saat impor CSV
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const AKAR = path.resolve(__dirname, '..', '..');
const DIR_GS = path.join(AKAR, 'apps-script');
const DIR_CSV = path.join(AKAR, 'data', 'csv');


// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** Pembaca CSV yang tetap benar untuk field ber-koma dan ber-tanda kutip. */
function bacaCsv(isi) {
  const baris = [];
  let field = '';
  let barisIni = [];
  let dalamKutip = false;

  isi = isi.replace(/^﻿/, '');

  for (let i = 0; i < isi.length; i++) {
    const c = isi[i];
    if (dalamKutip) {
      if (c === '"') {
        if (isi[i + 1] === '"') { field += '"'; i++; }
        else dalamKutip = false;
      } else field += c;
    } else if (c === '"') {
      dalamKutip = true;
    } else if (c === ',') {
      barisIni.push(field); field = '';
    } else if (c === '\n') {
      barisIni.push(field); baris.push(barisIni); barisIni = []; field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field !== '' || barisIni.length) { barisIni.push(field); baris.push(barisIni); }
  return baris.filter(r => r.some(v => v !== ''));
}

function tulisCsv(baris) {
  return baris.map(r => r.map(v => {
    const t = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }).join(',')).join('\n') + '\n';
}


// ---------------------------------------------------------------------------
// Tiruan Spreadsheet
// ---------------------------------------------------------------------------

class RangeTiruan {
  constructor(sheet, baris, kolom, jmlBaris, jmlKolom) {
    Object.assign(this, { sheet, baris, kolom, jmlBaris, jmlKolom });
  }
  getValues() {
    const hasil = [];
    for (let r = 0; r < this.jmlBaris; r++) {
      const sumber = this.sheet.data[this.baris - 1 + r] || [];
      const baris = [];
      for (let c = 0; c < this.jmlKolom; c++) {
        const v = sumber[this.kolom - 1 + c];
        baris.push(v === undefined ? '' : v);
      }
      hasil.push(baris);
    }
    return hasil;
  }
  setValues(nilai) {
    nilai.forEach((baris, r) => {
      const idx = this.baris - 1 + r;
      if (!this.sheet.data[idx]) this.sheet.data[idx] = [];
      baris.forEach((v, c) => { this.sheet.data[idx][this.kolom - 1 + c] = v; });
    });
    this.sheet.berubah = true;
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
}

class SheetTiruan {
  constructor(nama, data) {
    this.nama = nama;
    this.data = data || [];
    this.berubah = false;
  }
  getName() { return this.nama; }
  getLastRow() {
    for (let i = this.data.length - 1; i >= 0; i--) {
      if ((this.data[i] || []).some(v => v !== '' && v !== null && v !== undefined)) {
        return i + 1;
      }
    }
    return 0;
  }
  getLastColumn() {
    return this.data.reduce((m, r) => Math.max(m, (r || []).length), 0);
  }
  getMaxRows() { return Math.max(this.data.length, 1000); }
  getMaxColumns() { return Math.max(this.getLastColumn(), 26); }
  getRange(baris, kolom, jmlBaris, jmlKolom) {
    return new RangeTiruan(this, baris, kolom, jmlBaris || 1, jmlKolom || 1);
  }
  setFrozenRows() { return this; }
  deleteRows(mulai, jumlah) {
    this.data.splice(mulai - 1, jumlah); this.berubah = true; return this;
  }
  deleteColumns(mulai, jumlah) {
    this.data.forEach(r => r && r.splice(mulai - 1, jumlah));
    this.berubah = true;
    return this;
  }
}

class SpreadsheetTiruan {
  constructor(nama) { this.sheets = []; this.nama = nama || 'DB_AZAMA_LOKAL'; }
  getSheetByName(n) { return this.sheets.find(s => s.nama === n) || null; }
  getSheets() { return this.sheets.slice(); }
  insertSheet(n) { const s = new SheetTiruan(n); this.sheets.push(s); return s; }
  deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); }
  getName() { return this.nama; }
}


// ---------------------------------------------------------------------------
// Tiruan layanan
// ---------------------------------------------------------------------------

function formatTanggal(tanggal, zona, pola) {
  const b = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona || 'Asia/Jakarta',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(tanggal).reduce((a, p) => (a[p.type] = p.value, a), {});

  return pola
    .replace('yyyy', b.year)
    .replace('MM', b.month)
    .replace('dd', b.day)
    .replace('HH', b.hour === '24' ? '00' : b.hour)
    .replace('mm', b.minute)
    .replace('ss', b.second);
}

function bangunKonteks(spreadsheet, props) {
  const konteks = {
    console,
    Date, JSON, Math, String, Number, Object, Array, Error, RegExp, Boolean,
    parseInt, parseFloat, isNaN,

    SpreadsheetApp: {
      openById: () => spreadsheet,
      getActiveSpreadsheet: () => spreadsheet
    },

    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = v; }
      })
    },

    LockService: {
      getScriptLock: () => ({ waitLock() {}, releaseLock() {} })
    },

    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: teks => ({
        _isi: teks,
        setMimeType() { return this; },
        getContent() { return this._isi; }
      })
    },

    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest: (_alg, data) =>
        Array.from(crypto.createHash('sha256').update(data, 'utf8').digest()),
      computeHmacSha256Signature: (data, kunci) =>
        Array.from(crypto.createHmac('sha256', kunci).update(data, 'utf8').digest()),
      base64EncodeWebSafe: teks =>
        Buffer.from(teks, 'utf8').toString('base64')
          .replace(/\+/g, '-').replace(/\//g, '_'),
      base64DecodeWebSafe: b64 =>
        Array.from(Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
      newBlob: bytes => ({
        getDataAsString: () => Buffer.from(bytes).toString('utf8')
      }),
      formatDate: formatTanggal,
      getUuid: () => crypto.randomUUID(),
      sleep: () => {}
    }
  };

  konteks.globalThis = konteks;
  return vm.createContext(konteks);
}


// ---------------------------------------------------------------------------
// Pemuatan
// ---------------------------------------------------------------------------

/**
 * Muat CSV jadi spreadsheet di memori.
 *
 * @param {string} dir folder sumber; default hasil migrasi (dibaca saja)
 */
function muatSpreadsheet(dir = DIR_CSV) {
  if (!fs.existsSync(dir)) {
    throw new Error(
      `Folder CSV tidak ada: ${dir}\n` +
      'Jalankan dulu: py scripts/migrate_excel.py'
    );
  }
  const ss = new SpreadsheetTiruan();
  for (const berkas of fs.readdirSync(dir).filter(f => f.endsWith('.csv'))) {
    ss.insertSheet(path.basename(berkas, '.csv')).data =
      bacaCsv(fs.readFileSync(path.join(dir, berkas), 'utf8'));
  }
  return ss;
}

/** Simpan kembali tab yang berubah ke folder tujuan. */
function simpanSpreadsheet(ss, dir) {
  fs.mkdirSync(dir, { recursive: true });
  let jumlah = 0;
  for (const sh of ss.getSheets()) {
    if (!sh.berubah) continue;
    fs.writeFileSync(path.join(dir, sh.nama + '.csv'), tulisCsv(sh.data), 'utf8');
    sh.berubah = false;
    jumlah++;
  }
  return jumlah;
}

/**
 * Muat berkas .gs ke dalam konteks.
 *
 * Sheets.gs harus lebih dulu karena berisi SKEMA dan errorApp yang dipakai
 * berkas lain saat dimuat.
 */
function muatKodeGs(konteks) {
  const urutan = ['Sheets.gs', 'Auth.gs', 'Sales.gs', 'Master.gs',
                  'Payment.gs', 'Gallon.gs', 'Dashboard.gs', 'Integrity.gs',
                  'Setup.gs', 'Code.gs'];
  for (const berkas of urutan) {
    const jalur = path.join(DIR_GS, berkas);
    if (!fs.existsSync(jalur)) throw new Error(`Berkas hilang: ${berkas}`);
    vm.runInContext(fs.readFileSync(jalur, 'utf8'), konteks, { filename: berkas });
  }
  return urutan;
}

/** Panggil doPost persis seperti Apps Script memanggilnya. */
function panggilDoPost(konteks, badan) {
  const keluaran = vm.runInContext('doPost', konteks)({
    postData: { contents: badan }
  });
  return keluaran.getContent();
}

/** Rakit lingkungan lengkap dalam satu panggilan. */
function siapkan({ dirCsv = DIR_CSV, secret = 'kunci-uji-lokal-panjang-32-karakter-lebih' } = {}) {
  const ss = muatSpreadsheet(dirCsv);
  const konteks = bangunKonteks(ss, {
    SPREADSHEET_ID: 'ID_LOKAL',
    SECRET_KEY: secret
  });
  muatKodeGs(konteks);
  return { ss, konteks };
}


module.exports = {
  AKAR, DIR_GS, DIR_CSV,
  bacaCsv, tulisCsv,
  SpreadsheetTiruan, SheetTiruan,
  bangunKonteks, muatSpreadsheet, simpanSpreadsheet, muatKodeGs,
  panggilDoPost, siapkan,
};
