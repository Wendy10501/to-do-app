/**
 * Whiteboard sync
 *
 * Sends the WHITEBOARD Google Sheet to Supabase every 10 minutes so the
 * IPMI Whiteboard dashboard can show it to signed-in, approved people:
 * https://wendy10501.github.io/to-do-app/dashboard.html
 *
 * Keep this as its own Apps Script project in Wendy's Google account
 * (script.google.com > New project), not inside the sheet, so nobody
 * else who can edit the sheet can change it. It can read Google Drive
 * files but cannot change or delete anything (see appsscript.json).
 *
 * One-time setup:
 *   1. Run setup. Approve the permissions Google asks for.
 *   2. Copy the "insert into private.whiteboard_tokens ..." line it prints
 *      in the Execution log and run it in the Supabase SQL editor.
 *   3. Run syncWhiteboard. The log should say "Sent the WHITEBOARD to Supabase".
 * After that it runs on its own every 10 minutes. Run stopSync to turn it off.
 */

const WHITEBOARD_ID = '17jb7nTWyDSKr28QwsvM8An9o4ZpqUnzPR2QjvfTSz1Y';
const SUPABASE_URL = 'https://vceuihhxhcaywalnvsxu.supabase.co';
// The publishable key is meant to be public (the same one is in config.js).
// Saving still needs the private token that setup creates.
const SUPABASE_KEY = 'sb_publishable_wfTyRMX1h-b-Dse91HVtbw_oSwEj8vU';
const EVERY_MINUTES = 10; // Google allows 1, 5, 10, 15 or 30

/** Run once: creates the private token, starts the schedule and prints the Supabase line. */
function setup() {
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty('WHITEBOARD_TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('WHITEBOARD_TOKEN', token);
  }

  stopSync();
  ScriptApp.newTrigger('syncWhiteboard').timeBased().everyMinutes(EVERY_MINUTES).create();

  console.log('The WHITEBOARD will be sent to Supabase every ' + EVERY_MINUTES + ' minutes.');
  console.log('Now run this line once in the Supabase SQL editor, then run syncWhiteboard:\n\n' +
    "insert into private.whiteboard_tokens (token_hash) values ('" + sha256Hex_(token) + "') on conflict do nothing;\n");
}

/** Exports the sheet as an .xlsx file and saves it in Supabase. */
function syncWhiteboard() {
  const token = PropertiesService.getScriptProperties().getProperty('WHITEBOARD_TOKEN');
  if (!token) throw new Error('Run setup first.');

  const exported = UrlFetchApp.fetch(
    'https://docs.google.com/spreadsheets/d/' + WHITEBOARD_ID + '/export?format=xlsx',
    { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  const bytes = exported.getContent();
  // An .xlsx file is a zip, which always starts with the letters "PK".
  if (exported.getResponseCode() !== 200 || bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4B) {
    throw new Error('Google could not export the WHITEBOARD (HTTP ' + exported.getResponseCode() +
      '). Check that this Google account can open the sheet.');
  }
  const workbook = Utilities.base64Encode(bytes);

  const saved = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/save_whiteboard', {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: SUPABASE_KEY },
    payload: JSON.stringify({ p_token: token, p_workbook: workbook }),
    muteHttpExceptions: true,
  });
  if (saved.getResponseCode() !== 200) {
    throw new Error('Supabase did not accept the WHITEBOARD (HTTP ' + saved.getResponseCode() + '): ' +
      saved.getContentText().slice(0, 300));
  }
  console.log('Sent the WHITEBOARD to Supabase (' + Math.round(bytes.length / 1024) + ' KB).');
}

/** Turns off the 10-minute schedule. Run setup again to turn it back on. */
function stopSync() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'syncWhiteboard'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
}

function sha256Hex_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); })
    .join('');
}
