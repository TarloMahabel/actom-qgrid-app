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
window.APP_VERSION = "0.17.0";

/* Pre-1.0 while Phase 1 is in pilot. 1.0.0 is the MV Switchgear go-live. */
window.CHANGELOG = [
  {
    v: "0.17.0", d: "2026-08-28", t: "NCR management",
    items: [
      "New NCR module. A non-conformance is recorded, its cause found, and something changed so it does not happen again — as three stages rather than one long form.",
      "An NCR can be raised straight from a failed check or a fault line, and carries the inspection, the panel and the project with it.",
      "Closing an NCR requires a root cause and a verified corrective action. In the register this replaces, 7 of 475 records had a root cause and 368 were still open.",
      "Root causes are chosen from a list and grouped by category, so a repeat cause can actually be counted. Corrective actions are separate rows with an owner, a due date and a verification.",
      "Suppliers are their own field rather than a name typed into a department column, and severity is required.",
      "Repeat causes, by department and by supplier replace the pivot tables. The old numbers were already wrong: the workbook shows a #REF! in the repeat calculation and a #VALUE! in the supplier summary.",
      "Existing NCR numbers are kept and shown alongside the new reference."
    ]
  },
  {
    v: "0.16.1", d: "2026-08-28", t: "Database update 013 would not apply",
    items: [
      "The planned dates update failed part way through with 'function name is not unique'. Changing how many values a database function takes creates a second copy of it rather than replacing the first, so the old one had to be removed explicitly. Corrected, and safe to run again.",
      "The same latent problem was fixed across the earlier updates, and the tests now refuse it."
    ]
  },
  {
    v: "0.16.0", d: "2026-08-28", t: "Planned dates on a schedule",
    items: [
      "Generating a schedule now asks when the work starts. It used to date every inspection today, so a works order released for panels due in three weeks was overdue by the next day and the overdue count meant nothing.",
      "Each manufacturing stage carries how many working days into a build its inspection falls due, so a nine-stage route spreads across the weeks instead of landing on one date. Set this under Administration, Reference lists.",
      "Before generating you see exactly which date each stage will get.",
      "A planned date can be moved from the Schedule while the inspection has not been started. Weekends are skipped; public holidays are not, so check dates near a long weekend."
    ]
  },
  {
    v: "0.15.0", d: "2026-08-28", t: "Printing an inspection report",
    items: [
      "Every completed inspection can be printed, from the Register or from the inspection itself once it is signed. Print or save as PDF.",
      "The report carries what makes it evidence: the panel, the project and works order, the checksheet code and the revision it was captured against, every answer with the tolerance it was judged against, the instrument used, all faults with who cleared and verified them, the photographs, the signature, and who signed and when.",
      "A measurement prints its reading, not just pass or fail — the reading is what an auditor checks against the tolerance.",
      "It prints in black and white and keeps sections off page breaks, so a shop-floor printer produces something readable."
    ]
  },
  {
    v: "0.14.1", d: "2026-08-28", t: "Database update order",
    items: [
      "A database update that needs an earlier one now says which file to run first, instead of failing with a message about a missing column.",
      "Two update files had been given the same number. Corrected, and the tests now refuse a repeated or skipped number."
    ]
  },
  {
    v: "0.14.0", d: "2026-08-28", t: "Faults per project, and the actions arising",
    items: [
      "New Faults per project tab on the dashboard: the top ten projects for a month as a stacked bar chart, broken down by defect category, with totals on each bar and a table of the numbers underneath.",
      "Defect codes can be grouped for reporting. Incorrect labels and missing labels both show as Labelling & Identification on the chart, while each keeps its own code on the record. Set this under Administration, Reference lists.",
      "New Actions tab: what was decided about the faults, with an owner, a deadline and a status. It is kept month by month instead of being retyped into a slide.",
      "A month picker on both tabs, so last month's review is one click away."
    ]
  },
  {
    v: "0.13.0", d: "2026-08-28", t: "Who cleared a fault, and who verified it",
    items: [
      "Every fault line now records who cleared the fault and who verified the work, chosen from the people on the system rather than typed in.",
      "The dates are set by the system when each is recorded, not typed by hand.",
      "Verification cannot be recorded before clearing — it is a check on the clearing, so there has to be something to check.",
      "The same person clearing and verifying is allowed but shown on the line, because independent verification is the point of having both.",
      "Both can be recorded from Failed checks after the inspection is signed, which is usually when the work is actually done."
    ]
  },
  {
    v: "0.12.1", d: "2026-08-28", t: "As many photos as the job needs",
    items: [
      "Several photos could always be attached, but once past the minimum the field read '4 of 2 taken', which looks like a limit. It now reads '4 photos attached', the buttons say 'Take another' and 'Upload another', and the field says to add as many as you need.",
      "Upload takes several files at once; the camera takes one at a time, as the device does.",
      "A maximum can now be set on a photo field in the form designer, for a form that needs exactly so many. Leave it blank for no limit."
    ]
  },
  {
    v: "0.12.0", d: "2026-08-28", t: "Signature pad",
    items: [
      "The signature field is now a pad you sign on with a finger, a stylus or a mouse. It previously showed a note saying signing happened on submit, and there was nothing to sign.",
      "A form with an empty signature will not submit, and says which signature is missing.",
      "The drawing is saved with the inspection and appears on the record. Who signed and when still come from your sign-in, not from the drawing — the pad is the mark that goes on a certificate.",
      "A signature is not lost if the screen refreshes while you are part way through the form."
    ]
  },
  {
    v: "0.11.0", d: "2026-08-28", t: "Handing an inspection to someone else",
    items: [
      "An inspection that has been started can be handed to another inspector by a supervisor, planner, Quality Engineer or Quality Manager. A reason is required.",
      "Answers already captured stay as they are, recorded against whoever captured them. The person who signs is recorded as having signed, in their own name — nobody signs for anybody else.",
      "The record keeps all three: who started it, who it was handed to, and who signed. The register shows 'started by' when they differ, and the person picking it up sees why it was handed over.",
      "A signed inspection cannot be handed over. If it is wrong it needs an amendment, not a new owner."
    ]
  },
  {
    v: "0.10.5", d: "2026-08-28", t: "Removing a photo",
    items: [
      "Removing a photo reported 'you do not have access to that record'. An answer already recorded on an inspection cannot be deleted — that is deliberate, because a quality record should show that something was entered and then withdrawn, not that it never existed. Clearing an answer now blanks it instead."
    ]
  },
  {
    v: "0.10.4", d: "2026-08-28", t: "Photos upload",
    items: [
      "Choosing a photo did nothing. The app cleared the file box so the same photo could be picked twice in a row, and clearing it also discarded the photo that had just been chosen — before it was read. It now keeps the photo first.",
      "This was the actual cause of photos not uploading. The earlier attempts at it were treating symptoms."
    ]
  },
  {
    v: "0.10.3", d: "2026-08-28", t: "Photo store permissions",
    items: [
      "Uploads were being refused by the photo store's own permission rules. The rules are rewritten and now check themselves when installed, so a division cannot end up with photos silently unable to save.",
      "If the store ever refuses an upload again, the field says it is a permissions problem and who fixes it, rather than showing a database message."
    ]
  },
  {
    v: "0.10.2", d: "2026-08-28", t: "Photos actually upload",
    items: [
      "Choosing a photo did nothing at all — no error, no thumbnail. The file dialog stays open while you browse, and if anything refreshed the screen in that time the app lost track of which file you had picked. The picker no longer depends on the screen staying still.",
      "The screen also holds off refreshing while a file dialog is open."
    ]
  },
  {
    v: "0.10.1", d: "2026-08-28", t: "Photo upload says when it fails",
    items: [
      "An upload that failed showed a message that disappeared after a few seconds, so it looked as though nothing had happened at all. The reason now stays on the photo field until the next attempt.",
      "If the photo store has not been set up on a division, the field says so and says who fixes it, instead of failing silently.",
      "Removing a photo from an inspection now actually removes it. The permission to do so was missing, so it disappeared from the screen and stayed on the record."
    ]
  },
  {
    v: "0.10.0", d: "2026-08-28", t: "Many faults on one panel",
    items: [
      "New Fault list field for the form designer. An inspector can add as many fault lines as they find on a panel, each with its own defect code, description, location and severity — the form previously had room for one.",
      "A clean panel is confirmed with 'no faults found' rather than left blank, so a panel nobody checked and a panel with nothing wrong do not look the same on the record.",
      "Faults and failed checkpoints appear together in Failed checks, marked by how they were found. Defect counts and Pareto cover both.",
      "An inspection with faults on it is recorded as a fail even when every checkpoint passed."
    ]
  },
  {
    v: "0.9.10", d: "2026-08-28", t: "Take a photo or upload one",
    items: [
      "The photo field now offers both. On a tablet it previously forced the camera, so there was no way to attach a drawing, a certificate or a photo taken earlier.",
      "Upload takes several files at once; the camera takes one at a time, as the device does."
    ]
  },
  {
    v: "0.9.9", d: "2026-08-28", t: "Starting an inspection opens the current form",
    items: [
      "An inspection that had not been started could open with an empty form. It stayed attached to the version of the template it was created from, so fields added afterwards never reached it. Opening one now switches it to the current published form automatically, as long as nothing has been captured on it yet.",
      "An inspection that already has answers on it still keeps the form it was captured against, so nothing changes underneath a record in progress.",
      "A form with no questions on it can no longer be published. That is how empty forms reached the shop floor."
    ]
  },
  {
    v: "0.9.8", d: "2026-08-28", t: "Photos on an inspection",
    items: [
      "Taking or attaching a photo now works. The file picker was there but did nothing: the photo was never uploaded and submitting failed with 'Photo has not been answered'.",
      "Photos are resized on the tablet before upload, so a camera shot goes through on shop-floor Wi-Fi instead of timing out.",
      "Attached photos show as thumbnails and can be removed before signing. The count shows how many a field still needs.",
      "An upload that fails says so and leaves nothing behind, rather than looking as though the photo went through."
    ]
  },
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
