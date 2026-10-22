/**
 * FMD Microplan – Google Apps Script
 * Reads columns A, B, D, E, J. Edits columns D, E, J only.
 *
 * Setup: open the Google Sheet → Extensions → Apps Script → paste this file
 * → Deploy → New deployment → Web app → Execute as: Me → Access: Anyone.
 */

// Leave '' to use the FIRST tab of the spreadsheet, or put the exact tab name.
var SHEET_NAME = '';

// Optional passcode. If set, the web page will ask for it. '' = no passcode.
// (Recommended: the sheet contains Aadhaar numbers.)
var ACCESS_CODE = '';

var FIRST_DATA_ROW = 13;

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (ACCESS_CODE && String(body.code || '') !== ACCESS_CODE) {
      return json_({ error: 'AUTH' });
    }
    var sheet = getSheet_(body.sheetName);
    if (!sheet) return json_({ error: 'Sheet tab not found' });

    if (body.action === 'list') return json_({ data: listRows_(sheet) });
    if (body.action === 'update') return json_(updateRow_(sheet, body));
    if (body.action === 'addTag') return json_(addTag_(sheet, body));
    return json_({ error: 'Unknown action: ' + body.action });
  } catch (err) {
    return json_({ error: String(err) });
  }
}

function doGet() {
  return json_({ status: 'ok', message: 'FMD API running. Use POST.' });
}

function getSheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var n = name || SHEET_NAME;
  return n ? ss.getSheetByName(n) : ss.getSheets()[0];
}

function s_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);      // avoids 8.0E+11 display
  return String(v).trim();
}

/** A real data row = owner row (number + name) or an animal row (ear tag digits). */
function listRows_(sheet) {
  var last = sheet.getLastRow();
  if (last < FIRST_DATA_ROW) return [];
  var n = last - FIRST_DATA_ROW + 1;
  var vals = sheet.getRange(FIRST_DATA_ROW, 1, n, 10).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var r = vals[i];
    var a = s_(r[0]), b = s_(r[1]), d = s_(r[3]), e = s_(r[4]), j = s_(r[9]);
    var isOwner = /^\d+(\.0)?$/.test(a) && b !== '' && !/^\d+(\.0)?$/.test(b);
    var isTag = /^\d{8,}$/.test(j);
    if (!isOwner && !isTag) continue;          // skips repeated page headers / totals
    out.push({
      row: FIRST_DATA_ROW + i,
      sl: isOwner ? a.replace(/\.0$/, '') : '',
      name: isOwner ? b : '',
      aadhaar: isOwner ? d : '',
      mobile: isOwner ? e : '',
      tag: j
    });
  }
  return out;
}

function updateRow_(sheet, body) {
  var row = Number(body.row);
  var item = body.item || {};
  var old = body.old || {};
  if (!(row >= FIRST_DATA_ROW && row <= sheet.getLastRow())) {
    return { error: 'Row out of range' };
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    // Conflict check: refuse if someone changed the row since it was loaded
    var cur = sheet.getRange(row, 1, 1, 10).getValues()[0];
    if (s_(cur[3]) !== String(old.aadhaar || '') ||
        s_(cur[4]) !== String(old.mobile || '') ||
        s_(cur[9]) !== String(old.tag || '')) {
      return { error: 'This row was changed by someone else. Please refresh and try again.' };
    }
    if (body.ownerRow) {
      sheet.getRange(row, 4).setValue(String(item.aadhaar || '').trim());
      sheet.getRange(row, 5).setValue(String(item.mobile || '').trim());
    }
    sheet.getRange(row, 10).setValue(String(item.tag || '').trim());
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/** Adds a new ear tag under an owner: fills the owner's empty tag cell, or inserts a new row after their last tag row. */
function addTag_(sheet, body) {
  var ownerRow = Number(body.ownerRow);
  var tag = String(body.tag || '').trim();
  if (!/^\d{8,}$/.test(tag)) return { error: 'Ear tag must be at least 8 digits' };
  if (!(ownerRow >= FIRST_DATA_ROW && ownerRow <= sheet.getLastRow())) return { error: 'Row out of range' };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var last = sheet.getLastRow();
    // Duplicate ear tag anywhere in the sheet?
    var jvals = sheet.getRange(FIRST_DATA_ROW, 10, last - FIRST_DATA_ROW + 1, 1).getValues();
    for (var i = 0; i < jvals.length; i++) {
      if (s_(jvals[i][0]) === tag) return { error: 'Ear tag already exists (sheet row ' + (FIRST_DATA_ROW + i) + ')' };
    }
    // Confirm the owner row is still the same person
    var o = sheet.getRange(ownerRow, 1, 1, 10).getValues()[0];
    if (s_(o[1]) !== String(body.ownerName || '')) {
      return { error: 'Sheet changed since loading. Please refresh and try again.' };
    }
    // Find the owner's last animal row
    var lastRow = ownerRow;
    for (var r = ownerRow + 1; r <= last; r++) {
      var v = sheet.getRange(r, 1, 1, 10).getValues()[0];
      var isOwner = /^\d+(\.0)?$/.test(s_(v[0])) && s_(v[1]) !== '' && !/^\d+(\.0)?$/.test(s_(v[1]));
      if (isOwner || s_(v[1]) !== '' || !/^\d{8,}$/.test(s_(v[9]))) break;
      lastRow = r;
    }
    // Owner has no tag yet: use the owner row itself
    if (lastRow === ownerRow && s_(o[9]) === '') {
      sheet.getRange(ownerRow, 10).setValue(tag);
      return { ok: true, mode: 'filled' };
    }
    sheet.insertRowAfter(lastRow);
    var newRow = lastRow + 1;
    sheet.getRange(newRow, 10).setValue(tag);
    if (body.copyCounts) {   // copy cattle/buffalo/calf count (F:I) from the previous tag row
      var src = sheet.getRange(lastRow, 6, 1, 4);
      var f = src.getFormulas()[0], vals = src.getValues()[0];
      for (var c = 0; c < 4; c++) {
        if (!f[c] && vals[c] !== '') sheet.getRange(newRow, 6 + c).setValue(vals[c]);
      }
    }
    return { ok: true, mode: 'inserted', row: newRow };
  } finally {
    lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
