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
window.APP_VERSION = "0.21.3";

/* Pre-1.0 while Phase 1 is in pilot. 1.0.0 is the MV Switchgear go-live. */
window.CHANGELOG = [
  {
    v: "0.21.3", d: "2026-09-09", t: "The assistant counts nonconformances correctly",
    items: [
      "Asked how many nonconformances were open, the assistant answered nought when there was one. It was filtering on the first stage of the workflow rather than on everything not yet closed.",
      "A nonconformance moves through stages: open, contained, cause identified, action agreed, action done, verified, closed. Only the first is called open. Asked how many are open, the assistant now reports everything not yet closed, which is what the question means, and it can still be asked about any single stage by name.",
      "This was worse than an error. It gave a precise, confident, wrong number and nothing flagged it. Where a lookup is given a value it does not recognise, it now refuses and says so rather than quietly substituting something else.",
      "The tests read the list of stages out of the database rule that produces them, so the assistant and the register cannot drift apart again.",
      "Answers no longer show stray asterisks around figures."
    ]
  },
  {
    v: "0.21.2", d: "2026-09-09", t: "The assistant can read the register properly",
    items: [
      "Asking the assistant anything about nonconformances came back saying the lookup had failed. The list of fields it asked the database for had four names that do not exist, so the whole request was rejected.",
      "One lookup was worse than broken: it was labelled as listing parts with more than one nonconformance, but was actually reading causes by month. A wrong label is more dangerous than a failure, because the answer comes back confident. It is now described as what it is, and there is no repeat-parts lookup until one exists properly.",
      "Inspections can now be asked about — what is scheduled and what is in progress, with the stage and who it is assigned to.",
      "The tests now check every field every lookup asks for against the actual database, so a lookup that names something that does not exist cannot be released again."
    ]
  },
  {
    v: "0.21.1", d: "2026-09-09", t: "The assistant can actually be reached",
    items: [
      "Since it was added, the assistant answered \"unavailable\" to everything. Neither cause was in the assistant itself.",
      "The addresses the panel calls were being intercepted by a routing rule and sent somewhere the assistant does not live, so requests failed before reaching it. The rule was added as a precaution and was itself the fault. Removed.",
      "The model named for the longer jobs — drafting a nonconformance, explaining a requirement, and the whole question-and-answer panel — is not one this account has, so those were rejected outright. Corrected, and still changeable per division without a new release.",
      "When it does fail, the reason is now recorded where someone diagnosing it can read it. Inspectors still see the same plain sentence; nobody has to guess between a wrong address, a wrong key and a network fault again."
    ]
  },
  {
    v: "0.21.0", d: "2026-09-09", t: "Ask about the register",
    items: [
      "A new panel, from the speech bubble at the top right, answers questions about this division's own records: which nonconformances are open, which parts keep coming back, what goes wrong most often, how a works order is progressing.",
      "It reads exactly what you can read. It runs under your own permissions, so it cannot show you a record you could not open yourself, and if it finds nothing it will say so rather than imply the record does not exist.",
      "It cannot run arbitrary searches. There is a fixed list of lookups it is allowed to make, and each answer shows which of them it used. An answer with nothing listed came from general knowledge, not from your register.",
      "It writes nothing. There is no lookup that changes a record, so it cannot raise, close or edit anything.",
      "It will not tell you whether something conforms, passes or should be accepted, and will not give you a tolerance, a torque figure or a disposition. Ask it and the whole answer is replaced with a note pointing you to your Quality Engineer — the refusal is recorded, and Quality Managers can read the list of them.",
      "Every question and answer is kept, including refused ones, and cannot be edited or deleted afterwards.",
      "Switched off for every division until someone turns it on in Administration. It is a separate switch from assisted drafting, so a division can have one without the other."
    ]
  },
  {
    v: "0.20.1", d: "2026-09-09", t: "Dialogs fit the screen",
    items: [
      "A tall dialog no longer runs off the screen. Raise an NCR, Hand over, Add a corrective action and What's new were all taller than a tablet screen, and the whole dialog scrolled rather than its contents — so the heading and the close button scrolled out of sight and the Raise button sat below the bottom of the screen where it looked as though it was missing.",
      "The heading and the buttons now stay put and the middle scrolls, which is how the form designer's panels have always worked.",
      "On a short screen, such as a tablet held sideways, dialogs now use almost the full height instead of leaving a wide border top and bottom.",
      "The stage table in the Generate dialog can be scrolled sideways on a narrow screen instead of being cut off.",
      "The suggestion bar from assisted drafting stayed where the page was rather than where the field was once a dialog scrolled, and could be pushed off the right-hand edge entirely. It now follows the field, flips above it when there is no room below, and closes as soon as anything scrolls."
    ]
  },
  {
    v: "0.20.0", d: "2026-09-08", t: "Assisted drafting — suggestions, never decisions",
    items: [
      "Free-text fields can now offer help: spelling, a defect code that may fit the fault you have described, and a first draft of an NCR description from a recorded fault. Everything it offers is a suggestion you take, edit or ignore.",
      "It will not tell you whether anything passes, fails or conforms, and it is not able to. That determination is yours, it is recorded against your name, and any suggestion that reads like a verdict is refused before it reaches your screen. The refusal is recorded too, so how often this happens can be looked at.",
      "Spelling works with no connection and costs nothing: a list of the misspellings that actually occur in switchgear notes, checked as you type. The rest asks a model when you leave the field, and only then.",
      "Defect codes suggested are always from this division's own list. A code that is not on your list cannot be suggested, so a fault cannot be filed against a category that does not exist here.",
      "Every suggestion is written to a register before it is shown, with who it was offered to, on which record, and whether they took it. That register cannot be edited afterwards and nothing can delete from it.",
      "Switched OFF for every division until someone turns it on in Administration, Optional features. The offline spelling list keeps working either way."
    ]
  },
  {
    v: "0.19.1", d: "2026-09-08", t: "Database scripts separated by product",
    items: [
      "The script used to set up a new division was being built from this system's database files and the Apprenticeship Portal's together, because both sat in one folder. A division created from it would have received apprenticeship tables — applicants, intakes, consent records — inside its quality database. The two sets are now in separate folders and the setup script contains only this system's.",
      "The setup script is less than half the size it was, and the list of migrations it records as applied now names only the fifteen that belong to this system. Previously it claimed the Apprenticeship Portal's as well, so a division would have reported itself running migrations it had never been given.",
      "The build now stops if it finds two database files claiming the same number, rather than choosing one without saying so. That is what let the two sets sit unnoticed in one folder.",
      "Nothing on screen changes. Recorded because a quality system's own change history is part of what an auditor asks for, and this affects how a division is set up."
    ]
  },
  {
    v: "0.19.0", d: "2026-09-07", t: "NCR reports",
    items: [
      "New Reports tab in NCR management, for the questions asked at the monthly review rather than the ones asked today.",
      "Causes are grouped by category and ordered by how many nonconformances each accounts for, with a running share. If most of the register has no cause recorded, the chart says so rather than quietly ranking the rest.",
      "Closure time is reported as a median, raised to closed, overall and by severity, with the slowest in each. A median rather than an average: one NCR forgotten for a year should not move the number everyone quotes.",
      "The open population is broken into age bands, showing for each how many have no cause and no corrective action — so it is clear whether the old ones are old because they are hard or because nobody has touched them.",
      "Parts raised more than once are listed with their distinct causes. The same part under the same cause twice means the corrective action did not work.",
      "Closed NCRs missing a root cause or a corrective action are counted and called out. Closing now requires both, so any that appear predate that rule or were closed by editing the record — they are what an auditor samples."
    ]
  },
  {
    v: "0.18.0", d: "2026-09-07", t: "Closed NCRs said Verified, and the dashboard split in two",
    items: [
      "A closed NCR stayed on the register as \"Verified\" instead of \"Closed\". The closure itself was recorded correctly all along — the date, the person, everything — but the status shown beside it was worked out from the record as it had been a moment earlier, before the closure was written. Seven NCRs were affected and have been corrected.",
      "The same fault made the earlier stages lag. Saving a root cause left the NCR showing its previous stage until something else happened to touch the record. Each stage now shows the moment it is saved.",
      "An NCR could be closed by editing the record directly, going around the rule that a closure needs a root cause and a verified corrective action. Nothing in Grid did this, but the database allowed it. It no longer does: closing is only possible through the closing action, which checks both.",
      "NCR management has moved out of Setup into its own section. It is daily work, not something configured once.",
      "The dashboard is now two things. A main dashboard covering both inspections and nonconformance shows what needs attention today. The four analysis tabs that used to be the dashboard are now Inspection reports.",
      "NCR management has a Reports tab. It is empty for now — the reports themselves are next."
    ]
  },
  {
    v: "0.17.1", d: "2026-08-28", t: "NCR database update would not apply",
    items: [
      "The NCR update failed on a rule about which record a photo belongs to. Some photo records had been left behind by a debugging session earlier and belonged to nothing, so the new rule refused them.",
      "The rule now applies to new records only and reports the old ones instead of stopping. Nothing is deleted: a database update should not decide that a record is worthless.",
      "The same treatment was applied to the fault list update, which had the same shape."
    ]
  },
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
