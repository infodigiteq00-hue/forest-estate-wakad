// Receives leads from project websites and appends them to the "Leads" tab of
// the spreadsheet this script is attached to. Each site sends its own project
// name; SHEET_BY_PROJECT decides which tab it lands on.
// Deploy: Deploy > New deployment > Web app, Execute as: Me, Who has access: Anyone.

const DEFAULT_SHEET = 'Leads';
// Projects whose name starts with the key go to that tab; everything else goes to DEFAULT_SHEET.
const SHEET_BY_PROJECT = { 'The Industrial Land': 'Sheet1' };
const HEADERS = ['Date & time', 'Project', 'Form', 'Name', 'Mobile', 'Email', 'Configuration', 'Message', 'Location', 'Budget', 'Timeline', 'Site visit', 'Page', 'Lead ID', 'Purpose', 'Current home', 'WhatsApp opt-in', 'WhatsApp consent recorded at', 'Lead event ID', 'QualifiedLead event ID', 'Preferences event ID', 'Budget Lead event ID'];
const LEGACY_COLUMN_COUNT = 13; // Existing sheet/CRM field positions must stay stable.
const META_PIXEL_ID = '1468969448526553';
const META_GRAPH_VERSION = 'v23.0';
// Every new lead is also emailed here. Several addresses: 'a@x.com, b@y.com'
const MOBILE_COL = 5; // column E
const NOTIFY_TO = 'builderumbrella@gmail.com';

// Real Estate CRM: every new (non-duplicate) lead is also sent to its public enquiry endpoint.
// Set CRM_ENABLED = false to pause sending without touching anything else.
const CRM_ENABLED = true;
const CRM_URL = 'https://crm.builderumbrella.com/api/public/enquiries';
const CRM_CAMPAIGN = { 'Lodha Wakad': 'lodha-wakad-living-forest', 'The Industrial Land': 'panoli-industrial-land' };
// Budget label -> rupees [min, max] (null = open ended), matching the options on the forms
const CR = 10000000, LAKH = 100000;
const BUDGET_RANGE = {
  'Under Rs 2 Cr': [null, 2 * CR], 'Rs 2–2.5 Cr': [2 * CR, 2.5 * CR], 'Rs 2.5–3 Cr': [2.5 * CR, 3 * CR], 'Rs 3 Cr+': [3 * CR, null],
  'Below ₹2 Cr': [null, 2 * CR], '₹2 Cr – ₹2.5 Cr': [2 * CR, 2.5 * CR], '₹2.5 Cr – ₹3 Cr': [2.5 * CR, 3 * CR],
  '₹3 Cr – ₹4 Cr': [3 * CR, 4 * CR], 'Above ₹4 Cr': [4 * CR, null],
  'Below ₹50 lakh': [null, 50 * LAKH], '₹50 lakh – ₹1 crore': [50 * LAKH, CR], '₹1 crore – ₹3 crore': [CR, 3 * CR],
  '₹3 crore – ₹5 crore': [3 * CR, 5 * CR], 'Above ₹5 crore': [5 * CR, null]
};

// payload is used by the acknowledged browser transport; raw JSON remains supported
// for older project pages and integrations.
function doPost(e) {
  let d = {}, result, effects;
  try {
    d = JSON.parse(e && e.parameter && e.parameter.payload || e && e.postData && e.postData.contents || '{}');
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      effects = saveLead_(d);
      result = effects.result;
    } finally { lock.releaseLock(); }
    // The sheet has already been flushed. External services cannot undo capture.
    if (effects.newLead) {
      try { emailLead_(effects.row, effects.sheetUrl); } catch (_) { console.error('Lead email failed'); }
    }
    // New leads, and step-2 updates (the CRM matches them by lead_id and updates the same lead)
    if (effects.data && (effects.newLead || d.action === 'qualify')) {
      try { if (CRM_ENABLED) sendToCrm_(effects.data); } catch (_) { console.error('CRM send failed'); }
    }
    (effects.metaEvents || []).forEach(m => {
      try { sendMetaEvent_(m[0], effects.data, m[1]); }
      catch (_) { console.error('Meta CAPI request failed; lead remains saved'); }
    });
  } catch (_) {
    console.error('Lead request failed');
    result = { ok: false, error: 'Could not save your details. Please try again.' };
  }
  if (e && e.parameter && e.parameter.payload) {
    // Apps Script HTML is sandboxed in a Google iframe. top is the landing page;
    // target the requesting origin and include an unpredictable per-request nonce.
    const origin = /^https?:\/\/[^/]+$/.test(String(d.response_origin || '')) ? d.response_origin : 'https://builderumbrella.com';
    const message = JSON.stringify(Object.assign({ type: 'forest-lead-result', request_id: d.request_id }, result)).replace(/</g, '\\u003c');
    return HtmlService.createHtmlOutput('<script>window.top.postMessage(' + message + ',' + JSON.stringify(origin) + ');</script>')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  return ContentService.createTextOutput(result.ok ? (result.duplicate ? 'duplicate' : 'ok') : 'error');
}

function clean_(v) {
  return String(v == null ? '' : v).slice(0, 500).replace(/^[=+\-@]/, "'$&");
}
function validId_(v) { return /^[a-zA-Z0-9-]{16,100}$/.test(String(v || '')); }
function qualified_(d) {
  return ['Rs 2–2.5 Cr', 'Rs 2.5–3 Cr', 'Rs 3 Cr+'].indexOf(d.budget) >= 0 &&
    ['Immediately', '1–3 months', '3–6 months'].indexOf(d.timeline) >= 0;
}
// Lead is what the ads optimise on, so it only fires when step 2 shows a budget of Rs 2 Cr or more.
function budgetFits_(d) { return ['Rs 2–2.5 Cr', 'Rs 2.5–3 Cr', 'Rs 3 Cr+'].indexOf(d.budget) >= 0; }
function saveLead_(d) {
  const modern = d.action === 'capture' || d.action === 'qualify';
  if (d.action && !modern) throw new Error('Unknown action');
  if (modern && (!validId_(d.lead_id) || !validId_(d.event_id) || !/^[6-9]\d{9}$/.test(String(d.phone || '')) || !String(d.name || '').trim())) {
    throw new Error('Invalid lead');
  }
  if (d.action === 'qualify' && !validId_(d.qualified_event_id)) throw new Error('Invalid event ID');
  const ss = SpreadsheetApp.getActiveSpreadsheet(), sh = sheetFor_(ss, d.project);
  const rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, HEADERS.length).getValues() : [];
  const phone = digits_(d.phone);
  const byId = rows.findIndex(r => r[13] === d.lead_id);
  const byPhone = phone ? rows.findIndex(r => digits_(r[4]) === phone) : -1;
  let index = modern && byId >= 0 ? byId : byPhone;
  if (d.action === 'qualify') {
    if (byId < 0 || digits_(rows[byId][4]) !== phone) throw new Error('Unknown lead');
    index = byId;
    const row = rows[index];
    // Replayed requests acknowledge the original event, without repeating side effects.
    if (row[20] === d.event_id) return { result: { ok: true, lead_id: row[13], event_id: row[19] || d.event_id, track_qualified: !!row[19], budget_lead_event_id: row[21] || '' } };
    ['config', 'location', 'budget', 'timeline', 'visit', 'purpose', 'current_home'].forEach((key, i) => {
      row[[6, 8, 9, 10, 11, 14, 15][i]] = clean_(d[key]);
    });
    row[16] = d.whatsapp_opt_in === true;
    row[17] = row[16] ? (row[17] || new Date()) : '';
    const qualifies = qualified_(d), firstQualified = qualifies && !row[19];
    if (firstQualified) row[19] = d.qualified_event_id;
    const firstBudgetLead = budgetFits_(d) && !row[21] && validId_(d.budget_lead_event_id);
    if (firstBudgetLead) row[21] = d.budget_lead_event_id;
    row[20] = d.event_id;
    sh.getRange(index + 2, 1, 1, HEADERS.length).setValues([row]);
    SpreadsheetApp.flush();
    // Use stored identity/source fields, never replace the original name/mobile.
    const data = Object.assign({}, d, { name: String(row[3]).replace(/^'/, ''), phone: digits_(row[4]), project: String(row[1]).replace(/^'/, ''), form: String(row[2]).replace(/^'/, ''), page: String(row[12]).replace(/^'/, '') });
    const metaEvents = [];
    if (firstBudgetLead) metaEvents.push(['Lead', row[21]]);
    if (firstQualified) metaEvents.push(['QualifiedLead', row[19]]);
    return { result: { ok: true, lead_id: row[13], event_id: row[19] || d.event_id, track_qualified: firstQualified, budget_lead_event_id: firstBudgetLead ? row[21] : '' }, data: data, metaEvents: metaEvents };
  }
  if (index >= 0) {
    const row = rows[index];
    if (modern && !row[13]) { row[13] = d.lead_id; sh.getRange(index + 2, 1, 1, HEADERS.length).setValues([row]); SpreadsheetApp.flush(); }
    return { result: { ok: true, duplicate: true, lead_id: row[13], event_id: row[18] || d.event_id, track_lead: modern && row[18] === d.event_id } };
  }
  const row = [new Date(), clean_(d.project), clean_(d.form), clean_(d.name), d.phone ? "'+91 " + phone : '',
    clean_(d.email), clean_(d.config), clean_(d.message), clean_(d.location), clean_(d.budget), clean_(d.timeline), clean_(d.visit), clean_(d.page),
    modern ? d.lead_id : Utilities.getUuid(), clean_(d.purpose), clean_(d.current_home), modern && d.whatsapp_opt_in === true, modern && d.whatsapp_opt_in === true ? new Date() : '', modern ? d.event_id : '', '', '', ''];
  sh.appendRow(row);
  SpreadsheetApp.flush();
  return { result: { ok: true, lead_id: row[13], event_id: d.event_id, track_lead: modern },
    newLead: true, row: row, sheetUrl: ss.getUrl(), data: d, metaEvents: modern ? [['Step1Lead', d.event_id]] : [] };
}

// Only hashes leave Apps Script. Tokens are read at runtime, never stored in code.
function hashMeta_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)
    .map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('');
}
function sendMetaEvent_(eventName, d, eventId) {
  const props = PropertiesService.getScriptProperties(), token = props.getProperty('META_CAPI_TOKEN');
  if (!token) return;
  const user = { ph: [hashMeta_('91' + digits_(d.phone))] };
  const names = String(d.name || '').trim().toLowerCase().split(/\s+/);
  const normalize = v => v.normalize('NFKC').replace(/[\p{P}\p{S}\d\s]/gu, '');
  const first = normalize(names[0] || ''), last = normalize(names.length > 1 ? names[names.length - 1] : '');
  if (first) user.fn = [hashMeta_(first)];
  if (last) user.ln = [hashMeta_(last)];
  if (d.fbp) user.fbp = String(d.fbp).slice(0, 500);
  if (d.fbc) user.fbc = String(d.fbc).slice(0, 500);
  if (d.user_agent) user.client_user_agent = String(d.user_agent).slice(0, 1000);
  const payload = { data: [{ event_name: eventName, event_time: Math.floor(Date.now() / 1000), event_id: eventId,
    event_source_url: String(d.page || ''), action_source: 'website', user_data: user }] };
  const testCode = props.getProperty('META_TEST_EVENT_CODE');
  if (testCode) payload.test_event_code = testCode;
  const response = UrlFetchApp.fetch('https://graph.facebook.com/' + META_GRAPH_VERSION + '/' + META_PIXEL_ID + '/events', {
    method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  // Never log response bodies or exceptions: they may contain credentials/PII.
  if (response.getResponseCode() >= 300) console.error('Meta CAPI HTTP ' + response.getResponseCode());
}

function emailLead_(row, sheetUrl) {
  const esc = v => String(v).replace(/^'/, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const time = Utilities.formatDate(row[0], 'Asia/Kolkata', 'dd MMM yyyy, h:mm a');
  const phone = esc(row[4]);
  const cells = HEADERS.map((h, i) => {
    if (!row[i]) return '';
    let v = i === 0 ? time : esc(row[i]);
    if (i === 4) v = '<a href="tel:' + phone.replace(/\s/g, '') + '">' + phone + '</a>';
    return '<tr><td style="padding:6px 12px 6px 0;color:#666">' + h + '</td><td style="padding:6px 0"><b>' + v + '</b></td></tr>';
  }).join('');
  const name = String(row[3]).replace(/^'/, '') || 'No name';
  const project = String(row[1]).replace(/^'/, '');
  const options = {
    name: 'Website Leads',
    htmlBody: '<table style="font:14px Arial,sans-serif;border-collapse:collapse">' + cells + '</table>' +
      '<p style="font:13px Arial,sans-serif"><a href="' + sheetUrl + '">Open the leads sheet</a></p>'
  };
  if (row[5]) options.replyTo = String(row[5]).replace(/^'/, '');
  MailApp.sendEmail(NOTIFY_TO, 'New lead: ' + name + (project ? ' – ' + project : ''),
    HEADERS.map((h, i) => row[i] ? h + ': ' + (i === 0 ? time : String(row[i]).replace(/^'/, '')) : '').filter(String).join('\n'),
    options);
}

// Run once from the editor (select it, click Run) to grant the "send email"
// permission before deploying the new version, and to see a sample email.
function testLeadEmail() {
  emailLead_([new Date(), 'Test project', 'Enquire', 'Test Lead', "'+91 9999999999", '', '2 BHK', 'This is a test', ''],
    SpreadsheetApp.getActiveSpreadsheet().getUrl());
}

function tabFor_(project) {
  const p = String(project || '');
  const key = Object.keys(SHEET_BY_PROJECT).find(k => p.indexOf(k) === 0);
  return key ? SHEET_BY_PROJECT[key] : DEFAULT_SHEET;
}

function sheetFor_(ss, project) {
  const name = tabFor_(project);
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getMaxColumns() < HEADERS.length) sh.insertColumnsAfter(sh.getMaxColumns(), HEADERS.length - sh.getMaxColumns());
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else {
    const existing = sh.getRange(1, 1, 1, HEADERS.length).getValues()[0];
    if (!HEADERS.slice(0, LEGACY_COLUMN_COUNT).every((h, i) => existing[i] === h)) throw new Error('Unexpected sheet headings; migrate Page column first');
    // Only append missing headers. Never overwrite existing columns or lead data.
    for (let i = LEGACY_COLUMN_COUNT; i < HEADERS.length; i++) {
      if (existing[i] && existing[i] !== HEADERS[i]) throw new Error('Conflicting sheet heading');
      if (!existing[i]) sh.getRange(1, i + 1).setValue(HEADERS[i]);
    }
  }
  return sh;
}

// Last 10 digits, so "+91 98765 43210" and "9876543210" count as the same number
function digits_(v) {
  return String(v == null ? '' : v).replace(/\D/g, '').slice(-10);
}

// One-off clean-up: run from the editor. Moves each project's rows to its own tab,
// then deletes repeat entries (same mobile number in the same tab), keeping the oldest.
function tidyLeads() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let moved = 0, removed = 0;
  ss.getSheets().forEach(sh => {
    const rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, HEADERS.length).getValues() : [];
    const out = {};
    for (let i = rows.length - 1; i >= 0; i--) {
      const target = tabFor_(rows[i][1]);
      if (rows[i][1] && target !== sh.getName()) {
        (out[rows[i][1]] = out[rows[i][1]] || []).unshift(rows[i]); // keep oldest first
        sh.deleteRow(i + 2);
        moved++;
      }
    }
    Object.keys(out).forEach(project => {
      const dest = sheetFor_(ss, project);
      const at = dest.getLastRow() + 1;
      dest.getRange(at, MOBILE_COL, out[project].length, 1).setNumberFormat('@');
      dest.getRange(at, 1, out[project].length, HEADERS.length).setValues(out[project]);
    });
  });
  [DEFAULT_SHEET].concat(Object.keys(SHEET_BY_PROJECT).map(k => SHEET_BY_PROJECT[k])).forEach(name => {
    const sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return;
    const phones = sh.getRange(2, MOBILE_COL, sh.getLastRow() - 1, 1).getValues().map(r => digits_(r[0]));
    const seen = {};
    const drop = [];
    phones.forEach((ph, i) => { if (ph && seen[ph]) drop.push(i + 2); else if (ph) seen[ph] = true; });
    drop.reverse().forEach(r => { sh.deleteRow(r); removed++; });
  });
  console.log('Moved ' + moved + ' rows, removed ' + removed + ' duplicates');
}

// One-off: run ONCE from the editor, BEFORE deploying the version that puts Page last.
// Moves the Page column (I) to the end in every tab and rewrites the headings to match.
function movePageColumnLast() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.getSheets().forEach(sh => {
    if (sh.getLastRow() < 1) return;
    if (String(sh.getRange(1, 9).getValue()) !== 'Page') return; // already moved
    sh.moveColumns(sh.getRange(1, 9), LEGACY_COLUMN_COUNT + 1);
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    console.log('Moved Page to the end in ' + sh.getName());
  });
}

// Sends one lead to the CRM. Never throws into doPost: the sheet row and email come first.
function sendToCrm_(d) {
  const range = BUDGET_RANGE[d.budget] || [null, null];
  const key = Object.keys(CRM_CAMPAIGN).find(k => String(d.project || '').indexOf(k) === 0);
  const payload = {
    name: d.name, phone: digits_(d.phone), email: d.email,
    project: d.project, project_name: d.project, location: d.location, message: d.message,
    budget_min: range[0], budget_max: range[1], budget_text: d.budget,
    requirement: d.config, timeline: d.timeline, site_visit: d.visit,
    form: d.form, page: d.page,
    lead_id: d.lead_id, purpose: d.purpose, current_home: d.current_home, whatsapp_opt_in: d.whatsapp_opt_in === true,
    campaign: key ? CRM_CAMPAIGN[key] : 'website-form'
  };
  const res = UrlFetchApp.fetch(CRM_URL, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) console.error('CRM answered ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
}

// Run once from the editor so Google asks you to allow the script to contact the CRM.
function authorizeCrm() {
  console.log('CRM reachable: HTTP ' + UrlFetchApp.fetch('https://crm.builderumbrella.com/', { muteHttpExceptions: true }).getResponseCode());
}
