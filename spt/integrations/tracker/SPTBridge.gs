/* SPT -> existing Park Tracker bridge. No external calls and no source-data reads
 * from SPT. Requires the existing PTModel and pkHash_ pure helpers.
 * All Tracker/legacy mutation entrypoints must use the same ScriptLock.
 * SPB_SHARED_KEY belongs in Script Properties, never in this source file.
 */
var SPB_CONFIG = Object.freeze({
  protocol: 'spt-sheet-bridge/1',
  spreadsheetId: '1R8DoOOo5yg3M1hgHPA0Vuqp3Ng-K5bQgxdiy5dEeXOg',
  // Explicitly admitted existing paired-backend owner; not a SIWC alias.
  nativeOwnerKey: 'native-0bd025d0-62c4-420a-92b5-594833dd692e',
  main: '박경찬', profiles: '박경찬_02_학생진도',
  books: '박경찬_DB_교재', units: '박경찬_DB_단원',
  assignments: '박경찬_DB_배정', events: '박경찬_DB_트래커',
  attendance: '박경찬_DB_출결', maxRequestBytes: 150000,
  maxRows: 50000, clockWindowMs: 300000
});

function spbError_(code, message) {
  var e = new Error(message); e.spbCode = code; throw e;
}
function spbRequire_(condition, code, message) {
  if (!condition) spbError_(code, message);
}
function spbObject_(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function spbString_(value, max, required) {
  spbRequire_(typeof value === 'string' && value.length <= max && (!required || !!value.trim()), 'INVALID', '연동할 입력 항목을 확인해 주세요.');
  return value;
}
function spbDate_(value) {
  spbRequire_(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'INVALID', '수업일과 숙제 기한을 확인해 주세요.');
  var d = new Date(value + 'T12:00:00Z');
  spbRequire_(Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value, 'INVALID', '수업일과 숙제 기한을 확인해 주세요.');
  return value;
}
function spbTimestamp_(value) {
  if (value === '') return '';
  spbRequire_(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value), 'INVALID', '귀가 표시 시각을 확인해 주세요.');
  var d = new Date(value);
  spbRequire_(Number.isFinite(d.getTime()) && d.toISOString().slice(0, 19) === value.slice(0, 19), 'INVALID', '귀가 표시 시각을 확인해 주세요.');
  return d.toISOString();
}
function spbHex_(bytes) {
  return bytes.map(function (b) { return (b & 255).toString(16).padStart(2, '0'); }).join('');
}
function spbEqual_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  var diff = 0; for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function spbVerify_(input) {
  spbRequire_(spbObject_(input) && input.protocol === SPB_CONFIG.protocol, 'AUTH', '연동 요청을 인증하지 못했습니다.');
  spbRequire_(Number.isSafeInteger(input.sentAt) && Math.abs(Date.now() - input.sentAt) <= SPB_CONFIG.clockWindowMs, 'AUTH', '연동 요청 시간이 지났습니다. 앱에서 다시 시도해 주세요.');
  spbRequire_(typeof input.nonce === 'string' && /^[A-Za-z0-9_-]{16,100}$/.test(input.nonce), 'AUTH', '연동 요청을 인증하지 못했습니다.');
  spbRequire_(['snapshot', 'commitCloseout', 'catalogUpdate', 'catalogSource'].indexOf(input.action) >= 0 && spbObject_(input.payload), 'INVALID', '지원하는 연동 요청이 아닙니다.');
  var key = PropertiesService.getScriptProperties().getProperty('SPB_SHARED_KEY');
  spbRequire_(typeof key === 'string' && key.length >= 32 && typeof input.signature === 'string' && /^[a-f0-9]{64}$/.test(input.signature), 'AUTH', '연동 설정과 인증을 확인해 주세요.');
  var message = JSON.stringify({protocol: input.protocol, sentAt: input.sentAt, nonce: input.nonce, action: input.action, payload: input.payload});
  var expected = spbHex_(Utilities.computeHmacSha256Signature(message, key, Utilities.Charset.UTF_8));
  spbRequire_(spbEqual_(input.signature, expected), 'AUTH', '연동 요청을 인증하지 못했습니다.');
  var actor = input.payload.actorKey;
  var nativeBound = typeof SPB_CONFIG.nativeOwnerKey === 'string' && /^native-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(SPB_CONFIG.nativeOwnerKey) && actor === SPB_CONFIG.nativeOwnerKey;
  spbRequire_(typeof actor === 'string' && (/^siwc-[a-f0-9]{64}$/.test(actor) || nativeBound), 'AUTH', '앱의 로그인 주체를 확인해 주세요.');
  spbRequire_((input.action !== 'catalogUpdate' && input.action !== 'catalogSource') || nativeBound, 'AUTH', '목차 원본 수정은 지정한 운영 주체에서만 가능합니다.');
  // A captured signed request expires after five minutes. Commit replays within
  // that window are safe because requestId + canonical body is persisted and
  // checked below. A transient nonce cache is not treated as durable security.
  return input;
}
function spbJson_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
function doPost(e) {
  try {
    var raw = e && e.postData && e.postData.contents;
    spbRequire_(typeof raw === 'string' && raw.length <= SPB_CONFIG.maxRequestBytes, 'INVALID', '연동 요청 크기와 형식을 확인해 주세요.');
    var parsed; try { parsed = JSON.parse(raw); } catch (_) { spbError_('INVALID', '연동 요청 형식을 확인해 주세요.'); }
    var input = spbVerify_(parsed), lock = LockService.getScriptLock();
    spbRequire_(lock.tryLock(10000), 'CONFLICT', '다른 화면에서 저장 중입니다. 입력을 유지한 채 다시 시도해 주세요.');
    try {
      var ss = SpreadsheetApp.openById(SPB_CONFIG.spreadsheetId);
      spbRequire_(ss.getId() === SPB_CONFIG.spreadsheetId, 'AUTH', '연결할 원본 파일을 확인해 주세요.');
      return spbJson_(input.action === 'snapshot' ? spbSnapshot_(ss, input.payload) : input.action === 'catalogUpdate' ? spbCatalogUpdate_(ss, input.payload) : input.action === 'catalogSource' ? {ok:true,books:spbRows_(ss,SPB_CONFIG.books,12),units:spbRows_(ss,SPB_CONFIG.units,11)} : spbCommit_(ss, input.payload));
    } finally { lock.releaseLock(); }
  } catch (error) {
    var known = error && ['AUTH', 'INVALID', 'CONFLICT'].indexOf(error.spbCode) >= 0;
    return spbJson_({ok: false, code: known ? error.spbCode : 'INVALID', error: known ? error.message : '연동 처리 결과를 확인하지 못했습니다. 입력을 보관한 채 다시 시도해 주세요.'});
  }
}

function spbSheet_(ss, name) {
  var allowed = [SPB_CONFIG.main, SPB_CONFIG.profiles, SPB_CONFIG.books, SPB_CONFIG.units, SPB_CONFIG.assignments, SPB_CONFIG.events, SPB_CONFIG.attendance];
  spbRequire_(allowed.indexOf(name) >= 0, 'INVALID', '허용된 연동 표가 아닙니다.');
  var sheet = ss.getSheetByName(name);
  spbRequire_(!!sheet, 'INVALID', '연동에 필요한 박경찬 원본 표를 찾을 수 없습니다.');
  return sheet;
}
function spbRows_(ss, name, width) {
  var sheet = spbSheet_(ss, name), last = sheet.getLastRow();
  spbRequire_(last <= SPB_CONFIG.maxRows, 'INVALID', '연동 표가 커져 범위 점검이 필요합니다. 기존 기록은 유지됩니다.');
  return last > 1 ? sheet.getRange(2, 1, last - 1, width).getValues() : [];
}
function spbIso_(value, timezone) {
  return value instanceof Date ? Utilities.formatDate(value, timezone, 'yyyy-MM-dd') : String(value || '');
}
function spbStoredAt_(value) { return value instanceof Date ? value.toISOString() : String(value || ''); }
function spbRawCell_(value, timezone) {
  if (value instanceof Date) return {type: 'date', iso: value.toISOString(), localDate: spbIso_(value, timezone)};
  if (value === '' || value === null || value === undefined) return {type: 'empty', value: ''};
  return {type: typeof value, value: value};
}
function spbGrid_(sheet, row, count, width) {
  var range = sheet.getRange(row, 1, count, width), values = range.getValues(), formulas = range.getFormulas(), display = range.getDisplayValues();
  spbRequire_(pkHash_([values, formulas]) === pkHash_([range.getValues(), range.getFormulas()]), 'CONFLICT', '기초정보를 읽는 동안 값이 바뀌었습니다. 다시 대조해 주세요.');
  return {values: values, formulas: formulas, display: display};
}
function spbCells_(row, values, formulas, display, fields, timezone) {
  return values.map(function (value, i) {
    return {field: fields[i] || ('column_' + String.fromCharCode(65 + i)), a1: String.fromCharCode(65 + i) + row, raw: spbRawCell_(value, timezone), display: String(display[i] || ''), formula: String(formulas[i] || '')};
  });
}
function spbProfiles_(ss, withCells) {
  var sheet = spbSheet_(ss, SPB_CONFIG.profiles), grid = spbGrid_(sheet, 14, 100, 21), timezone = ss.getSpreadsheetTimeZone(), seen = {};
  var fields = ['id', 'status', 'name', 'school', 'grade', 'className', 'part', 'days', 'time', 'firstDate', 'book1', 'book2', 'column_M', 'targetDate', 'column_O', 'stage', 'nextAction', 'column_R', 'column_S', 'column_T', 'note'];
  return grid.values.map(function (r, index) {
    if (!r[0] && !r[2]) return null;
    spbRequire_(!!r[0] && !!r[2] && !seen[String(r[0])], 'CONFLICT', '학생 ID와 이름의 누락·중복을 원본에서 확인해 주세요.');
    seen[String(r[0])] = true;
    var p = {id: String(r[0]), status: String(r[1] || ''), name: String(r[2]), school: String(r[3] || ''), grade: String(r[4] || ''), className: String(r[5] || ''), part: String(r[6] || ''), days: String(r[7] || ''), time: String(r[8] || ''), firstDate: spbIso_(r[9], timezone), book1: String(r[10] || ''), book2: String(r[11] || ''), targetDate: spbIso_(r[13], timezone), stage: String(r[15] || ''), nextAction: String(r[16] || ''), note: String(r[20] || ''), revision: pkHash_(r), sourceRevision: pkHash_([r, grid.formulas[index]]), sourceRow: index + 14};
    if (withCells) p.cells = spbCells_(index + 14, r, grid.formulas[index], grid.display[index], fields, timezone);
    return p;
  }).filter(function (p) { return p !== null; });
}
function spbState_(ss) {
  var timezone = ss.getSpreadsheetTimeZone();
  var books = spbRows_(ss, SPB_CONFIG.books, 12).filter(function (r) { return r[0]; }).map(function (r) { return {id: String(r[0]), name: String(r[1]), code: String(r[2] || ''), start: r[3] ? Number(r[3]) : null, end: r[4] ? Number(r[4]) : null, excluded: PTModel.pages(r[5]), basis: String(r[8] || ''), source: String(r[9] || ''), version: String(r[10] || '1')}; });
  var units = spbRows_(ss, SPB_CONFIG.units, 11).filter(function (r) { return r[0]; }).map(function (r) { return {id: String(r[0]), bookId: String(r[1]), parentId: String(r[2] || ''), level: Number(r[3]), kind: String(r[4]), name: String(r[5]), start: r[6] ? Number(r[6]) : null, end: r[7] ? Number(r[7]) : null, order: Number(r[8] || 0), source: String(r[9] || ''), notation: String(r[10] || '')}; });
  var assignments = spbRows_(ss, SPB_CONFIG.assignments, 10).filter(function (r) { return r[0] && r[2]; }).map(function (r) { return {studentId: String(r[0]), slot: Number(r[1]), bookId: String(r[2]), baseline: String(r[3] || '미확인'), focusUnitId: String(r[4] || ''), focusPage: r[5] ? Number(r[5]) : null, focusDetail: String(r[6] || ''), focusDate: spbIso_(r[7], timezone), note: String(r[8] || '')}; });
  var eventRows = spbRows_(ss, SPB_CONFIG.events, 13).filter(function (r) { return r[0]; }), seen = {};
  var events = eventRows.map(function (r) {
    spbRequire_(!seen[String(r[0])], 'CONFLICT', 'Tracker 원본에 같은 기록 ID가 둘 이상 있습니다.'); seen[String(r[0])] = true;
    var body; try { body = JSON.parse(String(r[7])); } catch (_) { spbError_('CONFLICT', 'Tracker 기록 본문을 확인해 주세요.'); }
    spbRequire_(String(r[12]) === pkHash_(body), 'CONFLICT', 'Tracker 기록의 원본 검증에 실패했습니다.');
    return {id: String(r[0]), created: spbIso_(r[1], timezone), actor: String(r[2]), type: String(r[3]), studentId: String(r[4] || ''), bookId: String(r[5] || ''), date: spbIso_(r[6], timezone), data: body};
  });
  return {raw: {books: books, units: units, assignments: assignments}, events: events, eventRows: eventRows};
}
function spbCatalog_(state) {
  var catalog = PTModel.catalog(state.raw, state.events);
  return {books: catalog.books, units: catalog.units, assignments: state.raw.assignments,
    revision: pkHash_([catalog, state.raw.assignments])};
}
function spbStudentVersion_(state, id) { return pkHash_([state.raw, state.events.filter(function (e) { return e.type !== 'REVIEW_TEST' && (e.studentId === id || !e.studentId); })]); }
function spbFactsBasis_(state, id, day) { return pkHash_([state.raw, state.events.filter(function (e) { return e.studentId === id && e.type === 'PROGRESS' && e.date === day || e.type === 'SUBUNIT' || e.type === 'EXCLUSIONS'; })]); }
function spbLatestReview_(state, id, day, testMode) { var found = state.events.filter(function (e) { return e.type === (testMode ? 'REVIEW_TEST' : 'REVIEW') && e.studentId === id && e.date === day; }); return found.length ? found[found.length - 1] : null; }
function spbAttendance_(ss, day) { var timezone = ss.getSpreadsheetTimeZone(); return spbRows_(ss, SPB_CONFIG.attendance, 14).filter(function (r) { return r[0] && spbIso_(r[2], timezone) === day; }).map(function (r) { return {id: String(r[0]), studentId: String(r[3]), date: spbIso_(r[2], timezone), status: String(r[5])}; }); }

// Read existing occurrence/cancellation and confirmed-makeup owners only.
function spbSchedule_(ss) {
  var lessonsSheet = ss.getSheetByName('박경찬_DB_수업'), makeupsSheet = ss.getSheetByName('박경찬_DB_보강');
  if (!lessonsSheet || !makeupsSheet) return null; // Existing installs can still read their catalog.
  var timezone = ss.getSpreadsheetTimeZone();
  function rows(sheet, headers) {
    var last = sheet.getLastRow();
    spbRequire_(last >= 1 && last <= 1000, 'INVALID', '일정 원본의 조회 범위를 확인하세요.');
    var grid = spbGrid_(sheet, 1, last, headers.length).values;
    spbRequire_(headers.every(function(header,i) { return String(grid[0][i]) === header; }), 'INVALID', '일정 원본의 열 구조를 확인하세요.');
    return grid.slice(1).filter(function(r) { return r[0]; });
  }
  var lessons = rows(lessonsSheet, ['수업ID','수업일','요일','수업반','부','시작','종료','상태']).map(function(r) { return {id:String(r[0]), date:spbIso_(r[1],timezone), className:String(r[3]||''), part:String(r[4]||''), status:String(r[7]||'')}; });
  var makeups = rows(makeupsSheet, ['보강ID','결석ID','학생ID','학생명','보강일','시작','종료','진행상태','확정상태']).map(function(r) { return {id:String(r[0]), studentId:String(r[2]||''), date:spbIso_(r[4],timezone), status:String(r[7]||''), confirmation:String(r[8]||'')}; });
  return {revision:pkHash_([lessons,makeups]), lessons:lessons, makeups:makeups};
}

function spbSnapshot_(ss, payload) {
  var day = spbDate_(payload.date), profiles = spbProfiles_(ss, true), main = spbSheet_(ss, SPB_CONFIG.main), last = Math.max(3, main.getLastRow());
  spbRequire_(last <= 1000, 'INVALID', '메인 학생표의 대조 범위를 확인해 주세요.');
  var mainGrid = spbGrid_(main, 1, last, 18), timezone = ss.getSpreadsheetTimeZone();
  var fields = ['teacher', 'grade', 'name', 'lcad', 'previousAdvanceBook', 'previousAdvancePeriod', 'previousAdvanceEvaluationDate', 'previousAdvanceScore', 'previousAdvancedBook', 'previousAdvancedPeriod', 'previousAdvancedEvaluationDate', 'previousAdvancedScore', 'currentAdvanceBook', 'currentAdvanceStart', 'currentAdvanceEnd', 'currentAdvancedBook', 'currentAdvancedStart', 'currentAdvancedEnd'];
  var rows = mainGrid.values.map(function (r, i) { return i < 3 || !r[2] ? null : {sourceRow: i + 1, name: String(r[2]), grade: String(r[1] || ''), sourceRevision: pkHash_([r, mainGrid.formulas[i]]), cells: spbCells_(i + 1, r, mainGrid.formulas[i], mainGrid.display[i], fields, timezone)}; }).filter(function (r) { return r !== null; });
  var state = spbState_(ss);
  return {ok: true, protocol: SPB_CONFIG.protocol, action: 'snapshot', snapshot: {schema: 1, spreadsheetId: SPB_CONFIG.spreadsheetId, mainSheetId: main.getSheetId(), timezone: timezone, readAt: new Date().toISOString(), date: day, schedule:spbSchedule_(ss), profileSource: {sheetName: SPB_CONFIG.profiles, range: 'A14:U113', profiles: profiles}, mainSource: {sheetName: SPB_CONFIG.main, range: 'A1:R' + last, rows: rows}, tracker: {version: typeof PT_CONFIG !== 'undefined' ? PT_CONFIG.version : '', catalog: state.raw, resolvedCatalog: spbCatalog_(state), events: state.events.filter(function(e){return e.type !== 'REVIEW_TEST';}), testEvents: state.events.filter(function(e){return e.type === 'REVIEW_TEST';}), students: profiles.map(function (p) { var latest = spbLatestReview_(state, p.id, day), raw = latest && state.eventRows.find(function (r) { return String(r[0]) === latest.id; }); return {studentId: p.id, revision: spbStudentVersion_(state, p.id), factsBasis: spbFactsBasis_(state, p.id, day), latestReview: latest ? {id: latest.id, data: latest.data, date: latest.date, createdAt: spbStoredAt_(raw[1])} : null, latestTestReview: spbLatestReview_(state, p.id, day, true)}; }), attendance: spbAttendance_(ss, day)}}};
}

function spbCloseout_(value, day) {
  spbRequire_(spbObject_(value) && value.confirmed === true && typeof value.noHomework === 'boolean', 'INVALID', '앱에서 진도·숙제를 교사가 먼저 확정해 주세요.');
  spbRequire_(value.test === undefined || typeof value.test === 'boolean', 'INVALID', '테스트 구분을 확인해 주세요.');
  var progress = spbString_(value.progress, 12000, true).trim(), homework = spbString_(value.homework, 12000, false).trim(), next = spbString_(value.next, 12000, false).trim();
  var due = spbString_(value.due, 10, false), departedAt = spbTimestamp_(spbString_(value.departedAt, 40, false));
  if (!value.noHomework) { spbRequire_(!!homework && spbDate_(due) >= day, 'INVALID', '다음 숙제의 실제 범위와 기한을 확인해 주세요.'); }
  var cleaned = {progress: progress, homework: value.noHomework ? '' : homework, due: value.noHomework ? '' : due, noHomework: value.noHomework, next: next, confirmed: true, departedAt: departedAt};if(value.diary!==undefined)cleaned.diary=PTModel.diary(value.diary);if(value.test === true)cleaned.test=true;return cleaned;
}
function spbReviewBody_(closeout, sourceId, sourceSignature, parent, facts) {
  var data = {progress: closeout.progress, homework: closeout.homework, due: closeout.due, noHomework: closeout.noHomework, next: closeout.next, confirmed: true, departedAt: closeout.departedAt, parent: parent || '', reportChecked: false, transferredAt: '', sourceId: sourceId, sourceSignature: sourceSignature, evidenceBasis: facts};if(closeout.diary!==undefined)data.diary=PTModel.diary(closeout.diary);if(closeout.test === true)data.test=true;return data;
}
function spbReceipt_(state, row, duplicate) {
  var data = JSON.parse(String(row[7])), id = String(row[0]), studentId = String(row[4]);
  var event = state.events.find(function (e) { return e.id === id; }), day = event.date, latest = spbLatestReview_(state, studentId, day, String(row[3]) === 'REVIEW_TEST');
  var currentVersion = spbStudentVersion_(state, studentId), savedVersion = currentVersion;
  if (duplicate) {
    // Never present the latest state as a lost acknowledgement's original CAS
    // baseline. Reconstruct only when the stored pre-write hash proves that
    // today's catalog and the preceding relevant events still match exactly.
    var index = state.events.findIndex(function (e) { return e.id === id; });
    var before = {raw: state.raw, events: state.events.slice(0, index)};
    savedVersion = spbStudentVersion_(before, studentId) === String(row[8]) ? spbStudentVersion_({raw: state.raw, events: state.events.slice(0, index + 1)}, studentId) : null;
  }
  return {ok: true, protocol: SPB_CONFIG.protocol, action: 'commitCloseout', saved: true, duplicate: duplicate, requestId: id, sourceId: data.sourceId, remoteId: id, currentRemoteId: latest ? latest.id : '', trackerRevision: savedVersion, currentTrackerRevision: currentVersion, requiresFreshReview: savedVersion === null || savedVersion !== currentVersion || !latest || latest.id !== id, factsBasis: data.evidenceBasis, currentFactsBasis: spbFactsBasis_(state, studentId, day), receipt: {studentId: studentId, date: day, sourceId: data.sourceId, sourceSignature: data.sourceSignature, remoteId: id, bodyHash: String(row[12]), savedAt: spbStoredAt_(row[1])}};
}
function spbCommit_(ss, payload) {
  var id = spbString_(payload.requestId, 80, true), day = spbDate_(payload.date), studentId = spbString_(payload.studentId, 40, true);
  spbRequire_(/^REQ-SPT-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id), 'INVALID', '연동 요청 ID를 확인해 주세요.');
  var sourceId = spbString_(payload.sourceId, 200, true), sourceSignature = spbString_(payload.sourceSignature, 200, true);
  spbRequire_(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sourceId), 'INVALID', '앱의 원본 수정본 ID를 확인해 주세요.');
  var expectedRemoteId = spbString_(payload.expectedRemoteId, 80, false), expectedVersion = spbString_(payload.expectedTrackerRevision, 200, true), closeout = spbCloseout_(payload.closeout, day), actor = 'SPT:' + payload.actorKey;
  var testMode = closeout.test === true, recordType = testMode ? 'REVIEW_TEST' : 'REVIEW';
  var state = spbState_(ss), prior = state.eventRows.find(function (r) { return String(r[0]) === id; });
  if (prior) {
    var stored = JSON.parse(String(prior[7]));
    var sameBody = spbReviewBody_(closeout, sourceId, sourceSignature, stored.parent, stored.evidenceBasis);
    spbRequire_(String(prior[2]) === actor && String(prior[3]) === recordType && String(prior[4]) === studentId && String(prior[5] || '') === '' && spbIso_(prior[6], ss.getSpreadsheetTimeZone()) === day && JSON.stringify(sameBody) === String(prior[7]), 'CONFLICT', '같은 연동 요청에 서로 다른 내용이 있습니다. 원본과 입력을 대조해 주세요.');
    return spbReceipt_(state, prior, true);
  }
  var profiles = spbProfiles_(ss, false);
  spbRequire_(profiles.some(function (p) { return p.id === studentId; }), 'CONFLICT', '대조한 학생 ID를 원본에서 다시 확인해 주세요.');
  var latest = spbLatestReview_(state, studentId, day, testMode);
  spbRequire_((latest ? latest.id : '') === expectedRemoteId && spbStudentVersion_(state, studentId) === expectedVersion, 'CONFLICT', 'Tracker에서 기록이 바뀌었습니다. 앱 입력을 보존한 채 두 내용을 대조해 주세요.');
  spbRequire_(!spbAttendance_(ss, day).some(function (a) { return a.studentId === studentId && a.status === '결석'; }), 'CONFLICT', '같은 날짜에 결석 기록이 있습니다. 출결과 수업일을 먼저 확인해 주세요.');
  var data = spbReviewBody_(closeout, sourceId, sourceSignature, latest && latest.data.parent, spbFactsBasis_(state, studentId, day));
  var command = {requestId: id, type: recordType, studentId: studentId, bookId: '', date: day, data: data}, clean;
  try { clean = PTModel.validate(state.raw, state.events, command); } catch (_) { spbError_('INVALID', '확정한 진도·숙제와 Tracker 입력 조건을 확인해 주세요.'); }
  // Recheck immediately before append. ScriptLock coordinates script writers;
  // native direct cell edits are never claimed to be transactional with Apps Script.
  var checked = spbState_(ss), checkedLatest = spbLatestReview_(checked, studentId, day, testMode);
  spbRequire_(spbStudentVersion_(checked, studentId) === expectedVersion && (checkedLatest ? checkedLatest.id : '') === expectedRemoteId, 'CONFLICT', '저장 준비 중 Tracker 기록이 바뀌었습니다. 다시 대조해 주세요.');
  spbRequire_(!spbAttendance_(ss, day).some(function (a) { return a.studentId === studentId && a.status === '결석'; }), 'CONFLICT', '저장 준비 중 출결이 바뀌었습니다. 수업일과 출결을 대조해 주세요.');
  var sheet = spbSheet_(ss, SPB_CONFIG.events), rowNumber = sheet.getLastRow() + 1;
  spbRequire_(rowNumber <= SPB_CONFIG.maxRows, 'INVALID', 'Tracker 기록표의 보관 범위를 점검해 주세요. 기존 기록은 유지됩니다.');
  if (rowNumber > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), rowNumber - sheet.getMaxRows());
  var target = sheet.getRange(rowNumber, 1, 1, 13);
  spbRequire_(!target.isPartOfMerge() && target.isBlank() && target.canEdit(), 'CONFLICT', '추가할 Tracker 기록 행을 확인해 주세요. 기존 셀은 바꾸지 않았습니다.');
  var body = JSON.stringify(clean.data), now = new Date(), record = [id, now, actor, recordType, studentId, '', day, body, expectedVersion, 1, '확인', testMode ? 'SPT 기능검증 · 학습집계 제외' : 'SPT 교사 확정 마감 연동', pkHash_(clean.data)];
  var safe = record.map(function (value) { return typeof value === 'string' && value.charAt(0) === '=' ? "'" + value : value; });
  target.setValues([safe]); SpreadsheetApp.flush();
  var got = target.getValues()[0];
  spbRequire_(String(got[0]) === id && spbStoredAt_(got[1]) === now.toISOString() && String(got[2]) === actor && String(got[3]) === recordType && String(got[4]) === studentId && String(got[5] || '') === '' && spbIso_(got[6], ss.getSpreadsheetTimeZone()) === day && String(got[7]) === body && String(got[8]) === expectedVersion && Number(got[9]) === 1 && String(got[10]) === '확인' && String(got[11]) === record[11] && String(got[12]) === pkHash_(clean.data), 'CONFLICT', '저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.');
  checked.eventRows.push(got); checked.events.push({id: id, created: spbIso_(got[1], ss.getSpreadsheetTimeZone()), actor: actor, type: recordType, studentId: studentId, bookId: '', date: day, data: clean.data});
  return spbReceipt_(checked, got, false);
}

// Metadata-only native operation; same ScriptLock, no academic facts.
function spbCatalogUpdate_(ss, p) {
  var id = spbString_(p.requestId, 80, true), day = spbDate_(p.date);
  spbRequire_(/^REQ-CATALOG-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id), 'INVALID', '목차 수정 요청 ID를 확인해 주세요.');
  function matrix(v, width, max) {
    spbRequire_(Array.isArray(v) && v.length <= max && v.every(function(r) { return Array.isArray(r) && r.length === width && r.every(function(c) { return typeof c === 'string' && c.length <= 5000 || typeof c === 'number' && Number.isFinite(c); }); }), 'INVALID', '목차 수정 행을 확인해 주세요.');
    return v;
  }
  var beforeBooks = matrix(p.expectedBooks, 12, 100), beforeUnits = matrix(p.expectedUnits, 11, 1000), books = matrix(p.books, 12, 100), units = matrix(p.units, 11, 1000);
  var operation = {recoveryOf:p.recoveryOf?spbString_(p.recoveryOf,80,true):'',beforeHash:pkHash_([beforeBooks,beforeUnits]),afterHash:pkHash_([books,units]),bookChanges:books.map(function(r,i){return pkHash_(r)===pkHash_(beforeBooks[i])?null:{before:beforeBooks[i],after:r};}).filter(Boolean),unitAdditions:units.slice(beforeUnits.length),notationChanges:beforeUnits.map(function(r,i){return r[10]===units[i][10]?null:{id:r[0],before:r[10],after:units[i][10]};}).filter(Boolean)};
  var events = spbRows_(ss, SPB_CONFIG.events, 13), prior = events.find(function(r) { return String(r[0]) === id; });
  if (prior) { spbRequire_(String(prior[3]) === 'CATALOG' && String(prior[7]) === JSON.stringify(operation) && String(prior[12]) === pkHash_(operation), 'CONFLICT', '같은 목차 요청의 내용이 다릅니다.'); return {ok:true,saved:true,duplicate:true,requestId:id}; }
  spbRequire_(books.length === beforeBooks.length && books.every(function(r,i) { return r[0] === beforeBooks[i][0] && r.every(function(c,j) { return [1,3,8,9,10,11].indexOf(j) >= 0 || c === beforeBooks[i][j]; }); }), 'INVALID', '기존 교재 ID·범위·제외 기준은 보존해야 합니다.');
  spbRequire_(units.length >= beforeUnits.length && beforeUnits.every(function(r,i) { return r.every(function(c,j) { return j === 10 || c === units[i][j]; }); }), 'INVALID', '기존 단원 ID·원문·범위는 보존해야 합니다.');
  var bookIds = books.map(function(r){return r[0];}), unitIds = units.map(function(r){return r[0];});
  spbRequire_(new Set(bookIds).size === books.length && new Set(unitIds).size === units.length && units.every(function(r) { return r[0] && bookIds.indexOf(r[1]) >= 0 && (!r[2] || units.some(function(parent){return parent[0] === r[2] && parent[1] === r[1];})) && [1,2,3].indexOf(Number(r[3])) >= 0 && (!r[6] || Number(r[6]) > 0) && (!r[7] || Number(r[7]) >= Number(r[6])); }), 'INVALID', '목차 ID·상위 경로·페이지를 확인해 주세요.');
  units.forEach(function(r) { var seen = {}, u = r; while(u && u[2]) { spbRequire_(!seen[u[0]], 'INVALID', '목차 상위 경로가 순환합니다.'); seen[u[0]]=true; u=units.find(function(x){return x[0] === u[2];}); } });
  function current(name,width) { return spbRows_(ss,name,width); }
  spbRequire_(pkHash_(current(SPB_CONFIG.books,12)) === pkHash_(beforeBooks) && pkHash_(current(SPB_CONFIG.units,11)) === pkHash_(beforeUnits), 'CONFLICT', '목차 원본이 변경되었습니다. 대조 후 다시 준비해 주세요.');
  spbRequire_(JSON.stringify(operation).length < 45000, 'INVALID', '목차 수정 이력은 작은 단위로 준비해 주세요.');
  var targets=[];
  function target(sheet,row,column,before,values,notation) {
    var range=sheet.getRange(row,column,values.length,values[0].length);
    spbRequire_(range.canEdit() && !range.isPartOfMerge() && !range.getFormulas().some(function(r){return r.some(Boolean);}) && pkHash_(range.getValues())===pkHash_(before) && !values.some(function(r){return r.some(function(v){return typeof v==='string' && v.charAt(0)==='=';});}), 'CONFLICT', '수정할 목차 셀·수식을 확인해 주세요.');
    targets.push({range:range,before:before,values:values,notation:notation && column<=11 && column+values[0].length>11 ? sheet.getRange(row,11,values.length,1) : null});
  }
  [[SPB_CONFIG.books,beforeBooks,books,12],[SPB_CONFIG.units,beforeUnits,units,11]].forEach(function(group) {
    var sheet=spbSheet_(ss,group[0]);
    group[1].forEach(function(before,i) { var row=group[2][i],j=0;while(j<group[3]) { if(row[j]===before[j]){j++;continue;}var start=j;while(j<group[3]&&row[j]!==before[j])j++;target(sheet,i+2,start+1,[before.slice(start,j)],[row.slice(start,j)],group[0]===SPB_CONFIG.units); } });
    var extra=group[2].slice(group[1].length);if(extra.length)target(sheet,group[1].length+2,1,extra.map(function(r){return r.map(function(){return '';});}),extra,group[0]===SPB_CONFIG.units);
  });
  var header=spbSheet_(ss,SPB_CONFIG.units).getRange(1,11,1,1), headerValue=header.getValues()[0][0];
  spbRequire_(headerValue === '' || headerValue === '목차 원문 번호', 'CONFLICT', '추가 목차 열의 용도를 확인해 주세요.');
  if(headerValue === '')target(spbSheet_(ss,SPB_CONFIG.units),1,11,[['']],[['목차 원문 번호']]);
  spbRequire_(targets.length > 0, 'INVALID', '변경할 목차 정보가 없습니다.');
  targets.forEach(function(t) { spbRequire_(pkHash_(t.range.getValues()) === pkHash_(t.before), 'CONFLICT', '목차 수정 중 원본이 변경되었습니다. 결과를 재조회하세요.'); if(t.notation)t.notation.setNumberFormat('@');t.range.setValues(t.values); });
  SpreadsheetApp.flush();
  spbRequire_(pkHash_(current(SPB_CONFIG.books,12)) === pkHash_(books) && pkHash_(current(SPB_CONFIG.units,11)) === pkHash_(units), 'CONFLICT', '목차 반영 결과를 재조회하세요. 자동 재시도하지 않습니다.');
  var sheet=spbSheet_(ss,SPB_CONFIG.events), row=sheet.getLastRow()+1;
  var record=[id,new Date(),'SPT:'+p.actorKey,'CATALOG','','',day,JSON.stringify(operation),pkHash_([beforeBooks,beforeUnits]),1,'확인','교재 표시명·원문 목차 정비 · 학습 사실 아님',pkHash_(operation)];
  sheet.getRange(row,1,1,13).setValues([record]);SpreadsheetApp.flush();
  spbRequire_(String(sheet.getRange(row,1,1,13).getValues()[0][7]) === JSON.stringify(operation), 'CONFLICT', '목차 수정 이력을 재조회하세요.');
  return {ok:true,saved:true,duplicate:false,requestId:id,changedRanges:targets.length,bookIds:bookIds,unitCount:units.length};
}

// Read-only deployment check: no learning records, triggers, or test writes.
function spbCheckConnection() {
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    spbRequire_(String(PropertiesService.getScriptProperties().getProperty('SPB_SHARED_KEY') || '').length >= 32, 'AUTH', '연결 키를 확인해 주세요.');
    var ss = SpreadsheetApp.openById(SPB_CONFIG.spreadsheetId);
    var date = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd');
    var snapshot = spbSnapshot_(ss, {date: date}).snapshot;
    console.log(JSON.stringify({ok:true, readOnly:true, version:snapshot.tracker.version, profiles:snapshot.profileSource.profiles.length, mainRows:snapshot.mainSource.rows.length, eventRows:snapshot.tracker.events.length}));
  } finally { lock.releaseLock(); }
}
