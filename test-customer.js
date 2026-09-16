/* =====================================================================
   test-customer — Module 5, customer complaints.

   The workbook this replaces held 989 complaints, marked 957 of them
   Closed, and recorded a closing date on 38. Closure was asserted and
   never evidenced, so nobody could say how long this division takes to
   resolve a customer complaint. Response time was measurable on 13%.

   Every check here is about that not happening again. If the register
   can be closed without a date, or the status can be typed rather than
   derived, the module has failed at the one thing it exists for.
   ===================================================================== */
const { suite, REPO } = require('./test/harness');
const fs = require('fs');
const path = require('path');

const s = suite('test-customer — complaints, and the dates that prove them');
const read = p => fs.readFileSync(path.join(REPO, p), 'utf8');
const app = read('apps/inspect/app.js');
const mig = read('db/migrations/019-customer-complaints.sql');

/* ------------------------------------------------------------------ */
s.group('closure is evidenced, not asserted');

s.check('closing is an RPC, not an update the client composes',
  /create or replace function close_complaint/.test(mig) &&
  /supabase\.rpc\("close_complaint"/.test(app));
s.check('the closing date is the server\'s clock', /closed_at\s*=\s*now\(\)/.test(mig));
s.check('a complaint cannot be closed without saying what was done',
  /COMPLAINT_CORRECTION/.test(mig));
s.check('the client refuses first too, rather than relying on the error',
  /Say what was done for the customer/.test(app));
s.check('closing an already closed complaint is refused', /COMPLAINT_CLOSE/.test(mig));
s.check('closing stamps a response if one was never recorded',
  /responded_at = coalesce\(responded_at, now\(\)\)[\s\S]{0,200}closed_at/.test(mig) ||
  /closed_at[\s\S]{0,400}responded_at = coalesce\(responded_at, now\(\)\)/.test(mig));

/* A closed complaint is evidence. Evidence that can be rewritten is not. */
s.check('a closed complaint cannot be edited', /closed_at is null\s*\n?\s*and \(raised_by/.test(mig.replace(/\r/g, '')));
s.check('delete is revoked and never granted',
  /revoke all on complaints from anon, authenticated/.test(mig) &&
  !/^\s*grant\b[^;]*\bdelete\b[^;]*\bon\s+complaints/im.test(mig));

/* ------------------------------------------------------------------ */
s.group('status is derived, never typed');

/* The workbook had Closed, closed and Work in progress — three values
   for two states, because it was free text. */
s.check('there is a status function', /create or replace function complaint_status/.test(mig));
s.check('it reads the timestamps', /closed_at\s+is not null then 'closed'/.test(mig));
s.check('there is no status column to type into',
  !/^\s*status\s+text/m.test(mig.split('create table if not exists complaints')[1] || ''));
s.check('the view derives it', /complaint_status\(c\)\s+as status/.test(mig));

/* ------------------------------------------------------------------ */
s.group('the two intervals the module exists for');

s.check('first response is measured in hours', /response_hours/.test(mig));
s.check('time to close is measured in days', /days_to_close/.test(mig));
/* Null means "not yet". Zero would be a lie, and a report built on it
   would flatter the register exactly as the workbook's did. */
s.check('both are null until they have happened, not zero',
  /c\.responded_at - c\.called_at/.test(mig) && /c\.closed_at::date - c\.called_at::date/.test(mig));
s.check('a complaint cannot be answered before it was made',
  /complaint_answered_after_call/.test(mig));
s.check('nor closed before it was made', /complaint_closed_after_answer/.test(mig));
s.check('the register shows hours waited, not a status word', /no reply yet/.test(app));
s.check('medians rather than means', /const median = xs =>/.test(app));
s.check('open with no reply is called out', /Open, no reply yet/.test(app));

/* ------------------------------------------------------------------ */
s.group('the link to nonconformances');

/* 189 of 221 typed complaints in the workbook were Technical / Quality.
   Those are nonconformances, and 014 already has the ladder, the causes
   and the verified actions. Two registers describing one failure would
   drift apart and be reconciled by hand, which is where the workbook
   came from. */
s.check('a complaint can carry an NCR', /ncr_id\s+uuid references ncrs\(id\)/.test(mig));
s.check('types know whether they are technical', /is_technical boolean/.test(mig));
s.check('a technical complaint cannot be closed without one', /COMPLAINT_NEEDS_NCR/.test(mig));
s.check('and the reason is given to the person, not just refused',
  /so the cause and the corrective action are recorded where they can be verified/.test(mig));
s.check('the detail view says so before they try', /required before this can be closed/.test(app));

/* ------------------------------------------------------------------ */
s.group('lists that cannot drift');

/* Four spellings of Technical / Quality, one of them a typo; two of
   Minisub; two of Closed. All of it free text. */
s.check('complaint types are a table', /create table if not exists complaint_types/.test(mig));
s.check('sections are a table', /create table if not exists complaint_sections/.test(mig));
s.check('types are seeded', /Technical \/ Quality — Electrical/.test(mig));
s.check('sections are seeded', /'Minisubs'/.test(mig));
s.check('type names are unique', /name\s+text not null unique/.test(mig));
s.check('the client offers them as a list, not a free-text box',
  /id="kType"><option value=""/.test(app) && /id="kSection"><option value=""/.test(app));

/* One defect vocabulary, not two. The same fault counted under two names
   depending on who found it is the reconciliation problem that produced
   the workbook. */
s.check('defect codes are reused, not duplicated',
  /defect_code_id\s+smallint references defect_codes\(id\)/.test(mig) &&
  !/create table if not exists complaint_defect/.test(mig));
s.check('and the form says why', /counted once however it was found/.test(app));

/* ------------------------------------------------------------------ */
s.group('the module is wired in');

s.check('it has a nav entry', /id: "cust"/.test(app));
s.check('it is out of Later phases', !/"Supplier quality","Customer quality"/.test(app));
s.check('it has a view', /function vCust/.test(app) && /cust: vCust/.test(app));
s.check('an unmigrated division is told so rather than shown an empty register',
  /S\.complaintReady/.test(app) && /019-customer-complaints\.sql/.test(app));
for (const act of ['new-complaint', 'save-complaint', 'open-complaint',
                   'respond-complaint', 'close-complaint', 'do-close-complaint', 'cust-csv']) {
  s.check(`${act} has a handler`, new RegExp(`case "${act}"`).test(app));
}
s.check('the register can be downloaded', /function downloadComplaints/.test(app));
s.check('and reuses the CSV helper rather than a second one', /csvDownload\(`Complaints-/.test(app));

s.check('row level security is on', /alter table complaints\s+enable row level security/.test(mig));
s.check('it states its prerequisites', /PREREQUISITES|prereq/.test(mig));
s.check('it verifies itself', /Complaint types were not seeded/.test(mig));

s.done();
