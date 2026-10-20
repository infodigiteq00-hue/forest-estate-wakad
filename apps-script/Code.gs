// Receives leads from the Forest Estate Wakad website and appends them to the
// "Leads" tab of the spreadsheet this script is attached to.
// Deploy: Deploy > New deployment > Web app, Execute as: Me, Who has access: Anyone.

const SHEET_NAME = 'Leads';
const HEADERS = ['Date & time', 'Form', 'Name', 'Mobile', 'Email', 'Configuration', 'Message', 'Page'];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
    if (sh.getLastRow() === 0) {
      sh.appendRow(HEADERS);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    }
    // Cap length and stop values starting with = + - @ being read as formulas
    const clean = v => String(v == null ? '' : v).slice(0, 500).replace(/^[=+\-@]/, "'$&");
    sh.appendRow([
      new Date(),
      clean(d.form),
      clean(d.name),
      d.phone ? "'+91 " + clean(d.phone) : '',
      clean(d.email),
      clean(d.config),
      clean(d.message),
      clean(d.page)
    ]);
    return ContentService.createTextOutput('ok');
  } finally {
    lock.releaseLock();
  }
}
