/* =====================================================================
   ACTOM Apprenticeship Portal — CHANGELOG

   The standard ACTOM internal-tool pattern: a version array, a "What's
   new" panel, and a dot on the button until the person has seen the
   latest entry.

   ADDING AN ENTRY
     Put the newest at the TOP and bump APP_VERSION to match. The dot
     appears for anyone whose last-seen version is older, which is why
     the version string must change whenever an entry is added.

     Entries are written for ACTOM reviewers, not applicants.

   REVIEWER CONSOLE ONLY. The applicant portal deliberately has no
   changelog: an applicant uses it once, and release notes only raise
   questions they cannot act on ("what was fixed — was my application
   affected?"). A public changelog listing internals is also free
   reconnaissance. This file must never be loaded by apps/applicant.
   ===================================================================== */
(function () {
  'use strict';

  var APP_VERSION = '1.15.0';

  var CHANGELOG = [
    {
      version: '1.15.0', date: '2026-09-02', items: [
        'An application now shows what qualification the applicant appears to hold — ' +
        'Matric, NCV Level 4, N2 to N6 — read from what they typed in the further ' +
        'qualification box, with the points HR\\u2019s scoring workbook gives it.',
        'This is a reading of free text and it is shown as one. It does not affect the ' +
        'score, the rank, or the advisory flags. Wording that matches nothing known is ' +
        'called out as unrecognised rather than quietly counted as zero.',
        '\\u201cTechnical Matric\\u201d no longer also counts as \\u201cAcademic Matric\\u201d, and ' +
        '\\u201cNCV Level 4\\u201d is no longer mistaken for \\u201cN4\\u201d.'
      ]
    },
    {
      version: '1.14.0', date: '2026-08-31', items: [
        'The \\u201cMax files\\u201d setting in Form setup is now enforced by the database, not just ' +
        'by the applicant\\u2019s browser. Until now it was advisory: anything bypassing the ' +
        'portal could attach unlimited files to a slot configured for one.',
        'Applicants are told the limit up front (\\u201cyou can add up to 4 files here\\u201d) and a ' +
        'full slot now shows as full instead of offering a button that only produces an error.',
        'Uploading against a document type that has been hidden for the intake is refused.',
        'Fixed: if a file reached storage but its catalogue entry failed, the file was left ' +
        'in the bucket with nothing pointing at it. Those leftovers are now cleaned up.',
        'A \\u201cMax files\\u201d value typed outside 1\\u20136 is now clamped instead of failing the ' +
        'save with a database error.'
      ]
    },
    {
      version: '1.13.2', date: '2026-08-30', items: [
        'Trades are now listed by name only. The division no longer appears under the trade ' +
        'name in Form setup, on the apprentice register, or on the applicant\u2019s trade cards. ' +
        'It is still included in the register CSV export.'
      ]
    },
    {
      version: '1.13.1', date: '2026-08-30', items: [
        'Fixed: choosing a large file appeared to do nothing while it was being read, so ' +
        'applicants tapped again and the same document uploaded twice. The waiting state ' +
        'now appears immediately and the control locks until the upload finishes.'
      ]
    },
    {
      version: '1.13.0', date: '2026-08-28', items: [
        'Applicants can upload PDF, JPG and PNG only. iPhone HEIC photos are now rejected ' +
        'with instructions for switching the camera to Most Compatible, rather than a ' +
        'general refusal.',
        'Uploads show a clear waiting state while the file is going up, and the control is ' +
        'disabled until it finishes \u2014 which stops the duplicate uploads caused by tapping again.'
      ]
    },
    {
      version: '1.12.1', date: '2026-08-22', items: [
        'An applicant whose application was not successful now sees a clear, plainly worded ' +
        'outcome instead of the forward roadmap \u2014 which previously still showed the path to ' +
        'qualifying, under the words \u201cthat is the hard part done\u201d.',
        'Declined applicants are pointed towards applying again, and told how to ask about the decision.',
        'Fixed: the editable journey steps added in 1.12.0 were not actually being used by the ' +
        'applicant portal.'
      ]
    },
    {
      version: '1.12.0', date: '2026-08-22', items: [
        'The \u201cWhat happens from here\u201d steps an applicant sees after submitting can now be ' +
        'edited per intake, at the bottom of Form setup. Add, remove or reword them without a deploy.',
        'These steps stay editable after the intake is published \u2014 unlike the rest of the form \u2014 ' +
        'because they describe our process rather than anything the applicant filled in.',
        'Cloning an intake carries its steps forward.'
      ]
    },
    {
      version: '1.11.0', date: '2026-08-22', items: [
        'Help \u0026 guide rewritten as a walk through the actual job \u2014 the queue, deciding, ' +
        'scoring, documents, the register and the access log \u2014 and now shows only the parts ' +
        'your role can reach.'
      ]
    },
    {
      version: '1.10.1', date: '2026-08-22', items: [
        'The employee number and SETA learner number can now be added to an apprentice ' +
        'after enrolment, from their register entry \u2014 the SETA usually issues the learner ' +
        'number only once the contract has been registered, weeks after the person starts.'
      ]
    },
    {
      version: '1.10.0', date: '2026-08-22', items: [
        'Consent wording can now be read and edited in the console, under Consent wording. ' +
        'Administrators and the Information Officer only.',
        'Wording locks automatically once an applicant has agreed to it \u2014 POPIA requires the ' +
        'record to show what a person actually saw, so changes after that point are made as a ' +
        'new version rather than an edit.'
      ]
    },
    {
      version: '1.9.0', date: '2026-08-22', items: [
        'Declining an application is now its own deliberate action \u2014 Not selected \u2014 ' +
        'with a required reason (below minimum requirements, position filled, failed assessment, ' +
        'incomplete documents, unreachable, or other) rather than a quick click with a free-text note.',
        'This is recorded on the application and can be reported on later by trade, to help answer ' +
        'where in the process candidates are most often lost.'
      ]
    },
    {
      version: '1.8.1', date: '2026-08-21', items: [
        'Fixed: opening a trade\u2019s Subjects grid in Form setup could fail to load. ' +
        'Introduced when the weighting explainer above the grid was added in 1.8.0.'
      ]
    },
    {
      version: '1.8.0', date: '2026-08-21', items: [
        'Form setup now explains exactly how subject weighting works, with a worked example, right where you set the weights \u2014 including what happens when a required subject is left blank.',
        'The applications queue can show just the top candidates by score. Set a custom count or use the Top 100 shortcut, and see the cut-off score plus any applicants tied right on the boundary.'
      ]
    },
    {
      version: '1.7.0', date: '2026-08-15', items: [
        'Shortlisted applicants can be enrolled as apprentices, capturing start date, employee and SETA numbers, site and supervising artisan.',
        'Apprentice register: who is active, how far through their contract, trade test results, and who has completed or left.',
        'Enrolling places the application on legal hold. An apprentice\u2019s record is an employment record and is no longer subject to the 12-month applicant retention.',
        'Fixed: the nightly retention job could not delete stored documents and so purged nothing at all. Files are now queued for removal through the Storage API.'
      ]
    },
    {
      version: '1.6.0', date: '2026-08-15', items: [
        'Dashboard added as the landing screen: intake progress, applications against positions per trade, and Employment Equity aggregates. Figures only \u2014 no applicant is named.',
        'Navigation moved to a slide-out rail with counts on the things that need action, and a pin to keep it open.',
        'The applications table now uses the full width: rank, reference, ID last four, Grade 12 and location, with a sticky header and clickable rows.',
        'Help \u0026 guide section explaining scoring, flags, the publish lock and the access log.'
      ]
    },
    {
      version: '1.5.0', date: '2026-08-14', items: [
        'Corporate logo rendered from a single shared file across both apps.',
        'Applicant portal and reviewer console laid out properly for phones and tablets.',
        'Applicant portal no longer carries release notes — it is a public, single-use form.'
      ]
    },
    {
      version: '1.4.0', date: '2026-08-14', items: [
        'Scoring now evaluates only the applicant\u2019s own school stream. Previously an academic-stream applicant was flagged for missing technical subjects they could not have written, which pulled every score down.',
        'Applications submitted before this change have been re-scored automatically.',
        'Subject rules can safely be marked required in both streams \u2014 each applicant is held only to their own.',
        'Fixed duplicate document rows caused by upload handlers rebinding on every visit to the step.',
        'Applicants choose a trade from cards describing the work, rather than a dropdown.'
      ]
    },
    {
      version: '1.3.0', date: '2026-08-14', items: [
        'Form setup: configure trades, subjects, minimum marks, weights and document requirements per intake, without a deploy.',
        'Publishing an intake freezes its form permanently. Clone it to build the next one \u2014 the original stays exactly as its applicants experienced it.',
        'Automatic weighted scoring and per-trade ranking, with advisory flags. Nothing is ever auto-declined.'
      ]
    },
    {
      version: '1.2.0', date: '2026-08-14', items: [
        'Reviewer console separated onto its own site and domain, with Entra sign-in and per-trade scoping.',
        'Every ID number unlocked, document opened and list exported is recorded against the reviewer\u2019s name.',
        'Applicants can save and resume, and under-18 applicants are guided through guardian consent.'
      ]
    },
    {
      version: '1.0.0', date: '2026-08-14', items: [
        'First release of the ACTOM apprenticeship application portal and reviewer console.'
      ]
    }
  ];

  function seenKey(scope) { return 'actom_apprentice_seen_' + scope; }

  function lastSeen(scope) {
    try { return window.localStorage.getItem(seenKey(scope)); } catch (e) { return null; }
  }
  function markSeen(scope) {
    try { window.localStorage.setItem(seenKey(scope), APP_VERSION); } catch (e) {}
  }

  /* Compare two version strings numerically, part by part.
     A plain string comparison is wrong the moment a part reaches double
     digits: '1.10.0' > '1.9.0' is FALSE as text, because '1' sorts
     before '9'. That would silently stop the What's New dot appearing
     for everyone still on 1.9.x — the failure is invisible, which is
     the worst kind. Returns >0 if a is newer than b. */
  function compareVersions(a, b) {
    var pa = String(a || '0').split('.');
    var pb = String(b || '0').split('.');
    for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
      var na = parseInt(pa[i], 10) || 0;
      var nb = parseInt(pb[i], 10) || 0;
      if (na !== nb) return na - nb;
    }
    return 0;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function entriesFor() {
    return CHANGELOG.filter(function (e) { return e.items && e.items.length; });
  }

  function open(scope) {
    var entries = entriesFor();
    var seen = lastSeen(scope);

    var back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.setAttribute('role', 'dialog');
    back.setAttribute('aria-modal', 'true');
    back.setAttribute('aria-label', "What's new");
    back.innerHTML =
      '<div class="modal">' +
      '<div class="modal-head"><div><div class="eyebrow">Release notes</div>' +
      '<h2>What\u2019s new</h2></div><span style="flex:1"></span>' +
      '<button class="modal-close" aria-label="Close">&times;</button></div>' +
      entries.map(function (e) {
        var isNew = !seen || compareVersions(e.version, seen) > 0;
        return '<div class="cl-entry"><div class="cl-ver"><strong>' + esc(e.version) + '</strong>' +
          '<time>' + new Date(e.date).toLocaleDateString('en-ZA',
            { day: 'numeric', month: 'long', year: 'numeric' }) + '</time>' +
          (isNew ? '<span class="cl-new">new</span>' : '') + '</div><ul>' +
          e.items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') +
          '</ul></div>';
      }).join('') +
      '</div>';

    function close() {
      back.remove();
      document.removeEventListener('keydown', onKey);
      markSeen(scope);
      var dot = document.querySelector('.whatsnew-dot');
      if (dot) dot.remove();
    }
    function onKey(ev) { if (ev.key === 'Escape') close(); }

    back.addEventListener('click', function (ev) {
      if (ev.target === back || ev.target.classList.contains('modal-close')) close();
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(back);
    back.querySelector('.modal-close').focus();
  }

  // Attach to a button. Adds the unseen dot when there is something new.
  function attach(el, scope) {
    if (!el) return;
    el.classList.add('whatsnew-btn');
    var seen = lastSeen(scope);
    if (!seen || compareVersions(APP_VERSION, seen) > 0) {
      var dot = document.createElement('span');
      dot.className = 'whatsnew-dot';
      dot.setAttribute('aria-label', 'New updates');
      el.appendChild(dot);
    }
    el.addEventListener('click', function () { open(scope); });
  }

  window.ACTOM_CHANGELOG = {
    version: APP_VERSION,
    attach: attach,
    open: open
  };
})();
