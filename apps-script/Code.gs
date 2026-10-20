// Receives leads from project websites and appends them to the "Leads" tab of
// the spreadsheet this script is attached to. Each site sends its own project
// name, so several projects can share one sheet.
// Deploy: Deploy > New deployment > Web app, Execute as: Me, Who has access: Anyone.

const SHEET_NAME = 'Leads';
const HEADERS = ['Date & time', 'Project', 'Form', 'Name', 'Mobile', 'Email', 'Configuration', 'Message', 'Page'];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
    const head = sh.getRange(1, 1, 1, HEADERS.length);
    if (head.getValues()[0].join('|') !== HEADERS.join('|')) {
      head.setValues([HEADERS]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    // Cap length and stop values starting with = + - @ being read as formulas
    const clean = v => String(v == null ? '' : v).slice(0, 500).replace(/^[=+\-@]/, "'$&");
    sh.appendRow([
      new Date(),
      clean(d.project),
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
