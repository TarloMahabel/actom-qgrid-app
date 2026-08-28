/* =====================================================================
   ACTOM Grid — version and release notes.

   THIS FILE IS UPDATED ON EVERY CHANGE. Not as a courtesy: test-version.js
   fails without it, and the pre-commit hook refuses a commit that touches
   apps/, shared/ or db/ while leaving this file alone.

   Why that strictness. A quality system's own change history is part of
   what an auditor asks for. "What changed, when, and why" has to be
   answerable by someone who does not have the repository and will not
   read a git log.

   HOW TO ADD AN ENTRY
     1. Bump APP_VERSION below.
          patch  a fix; nothing about using the system changes
          minor  a new capability, or behaviour a user would notice
          major  go-live, or anything that needs retraining
     2. Add an entry at the TOP of CHANGELOG with that same version.
     3. Write it for the person using the system, not for a developer.
        "Publishing a form silently did nothing" beats "fixed the RLS
        policy on template_revisions".

   Edit HERE, then run ./shared/sync.sh.
   ===================================================================== */
window.APP_VERSION = "0.9.7";

/* Pre-1.0 while Phase 1 is in pilot. 1.0.0 is the MV Switchgear go-live. */
window.CHANGELOG = [
  {
    v: "0.9.7", d: "2026-08-28", t: "Test entry",
    items: ["A change you would notice."]
  },
  {
    v: "0.9.6", d: "2026-08-28", t: "Publishing a form silently did nothing",
    items: [
      "Publishing a template reported success while leaving it a draft. The database was refusing the change on a permissions rule and saying nothing, and the app believed the response. Both are fixed: the database raises an error instead of quietly doing nothing, and the app checks the template really was published before it says so.",
      "Signing an inspection had the same flaw and could have reported a record as signed when it was not. Fixed the same way.",
      "A System Administrator can publish templates, which the role was always meant to allow."
    ]
  },
  {
    v: "0.9.5", d: "2026-08-28", t: "Form designer: clearer publishing",
    items: [
      "Publish and Save lock while they are working, so a second click cannot publish twice.",
      "The result stays on screen instead of a message that disappears, and says which revision was published and what the next one will be.",
      "Buttons name the revision they will write, so it reads 'Save as draft rev 2' rather than 'Save draft'."
    ]
  },
  {
    v: "0.9.4", d: "2026-08-27", t: "Competency, and a fix to saving revisions",
    items: [
      "New Administration -> Competency screen. Nobody could sign an inspection because there was nowhere to record who is competent to do what. The matrix shows every template, the level it needs, and who can sign it.",
      "The capture screen says up front when you cannot sign an inspection and why, rather than refusing after the form is filled in.",
      "Saving a second revision of a form could fail with 'that already exists'. Fixed.",
      "Duplicate errors name the field and value that clashed.",
      "Defect codes no longer carry a default department; it decided nothing."
    ]
  },
  {
    v: "0.9.3", d: "2026-08-27", t: "Knowing what to do next",
    items: [
      "Every empty screen names the setup step blocking it and links straight there, instead of saying only 'Nothing to show yet'.",
      "Generate on a works order says exactly why it cannot run: no published template, no product family, or no requirements for that family.",
      "Projects and works orders are managed in the app under Scheduling. They previously needed database access.",
      "The form designer opens on a library of templates rather than dropping straight into one."
    ]
  },
  {
    v: "0.9.2", d: "2026-08-26", t: "Reference lists are editable",
    items: [
      "Manufacturing stages, departments, product families and defect codes can be edited, added and retired in Administration.",
      "Retiring hides an entry from new forms and keeps every historic record readable. Deleting is refused while anything still references it.",
      "The requirements matrix is configurable: click any cell to set the template, level and sampling rule.",
      "Hold points and the second-approver rule on templates are division settings, both off by default."
    ]
  },
  {
    v: "0.9.1", d: "2026-08-26", t: "Look and feel",
    items: [
      "Matched to ACTOM HC Analytics, with the official ACTOM badge and a loading screen showing a transmission line energising.",
      "Renamed to ACTOM Grid."
    ]
  },
  {
    v: "0.9.0", d: "2026-08-26", t: "Phase 1 wired to Supabase",
    items: [
      "Inspection capture, scheduling, the form designer and the requirements matrix, running against a live database.",
      "Sign-in through Microsoft. A new account is inactive until an administrator activates it.",
      "Controls enforced by the database rather than the browser: a signed inspection cannot be edited, an instrument out of calibration cannot be used, and the audit trail cannot be altered."
    ]
  }
];
// touched
