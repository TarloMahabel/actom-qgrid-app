# Module 3 — NCR Management: a plan

Read from `Module_3_NCR_Management.xlsx`: **475 NCRs**, 29 columns, 15 sheets,
10 pivot caches, two external workbook links. What follows is grounded in what
the register actually contains rather than what its columns imply.

---

## 1. What the spreadsheet says about how NCRs really work

Column fill rates across all 475 records, because they tell you what the
process is as opposed to what the form asks for:

| Field | Filled | Read this as |
|---|---|---|
| NCR No, Raised by, Dept responsible, Cost centre, Date, Date term, Status | 99–100% | the actual core of an NCR |
| Non-conformance details | 99% | always written |
| Part description / part no | 98% / 94% | always known |
| Type (rework/scrap/RTS) | 95% | the disposition decision |
| Standard defect | 88% | the analysis field that works |
| Containment action | 91% | done at the time |
| **Person responsible** | **49%** | half are unassigned |
| **Corrective action** | **19%** | four in five NCRs never record one |
| **SYSPRO capture** | **24%** | tracked by hand, mostly not |
| **Concession** | **14%** | |
| **Severity** | **7%** | effectively unused |
| **Root cause** | **1%** | seven records out of 475 |
| **Total cost** | **22%** | |
| **Material / labour cost** | **0%** | never once filled in |

**The honest conclusion.** The register is very good at *recording* a
non-conformance and poor at *closing* one. 368 of 475 are still Open. Root
cause is empty, corrective action is empty four times out of five, and cost is
mostly unknown — so the two questions the business needs answering ("what keeps
causing this" and "what is it costing us") cannot be answered from the data,
even though there are columns for both.

Building a faithful copy of this spreadsheet would preserve that. The module
should make the closing half of the process the part that is easy.

## 2. Data quality found in the register

These need decisions before any import:

- **Status has 5 spellings** for 2 states: `Open` 368, `closed` 74, `Closed` 22,
  `open` 9. Same for Type — `SCRAP`/`scrap`/`Scrap`, `Rework`/`REWORK`/`rework`
  reduce 18 distinct values to about 7 real ones.
- **12 duplicated NCR numbers** — `026/093`, `026/096`, `026/120`, `026/125`,
  `026/143`, `026/144`, `026/145`, `M026/046` and four more. Either genuinely
  two NCRs sharing a number, or double entry. Someone has to say which.
- **Numbering is not one scheme**: `###/###` (323), `M###/###` (127),
  `HB###/###` (18), plus `###-###`, `M###//###`, `M###/### CBI`. Prefixes look
  like divisions or areas — Minisub, High Bay.
- **Two NCR numbers contain a second reference**: `026/002\n#769`. A field is
  being used for two facts.
- **Cost centre is `#N/A` for every external NCR** — a broken lookup, not data.
- **Quantities are not always numbers**: `4 SHEETS (252.2 KG)`, `1 UNIT`,
  `5 of each item`. The unit matters and there is nowhere to put it.
- **Concession holds `No`, `Yes`, and numbers** (1, 4, 9, 57) — two different
  meanings in one column.
- **`Department responsible` mixes** real departments with `EXTERNAL`, while
  `Department` holds either `Internal` or a supplier name. So supplier is
  encoded in a field named Department.

## 3. What I propose to build

### Phase 3a — the register, done properly (the foundation)

One `ncrs` table, plus the closing workflow the spreadsheet lacks.

**Identity and origin**
- `ref` — generated, `NCR-YY-NNNN`, same mechanism as INS/FC. **Existing
  numbers are kept in `legacy_ref`**, because 475 records and every historic
  email refer to them.
- `source` — raised from an inspection, from a fault line, from a supplier
  delivery, from site, or standalone. **An NCR raised from a failed check
  should link to it**: today an inspection and its NCR are two disconnected
  records, and Grid already holds the inspection.
- Project, works order, part description, part number, quantity **with a unit**.

**Responsibility** — department responsible, person responsible, raised by.
Person responsible becomes **required to move past containment**, which is what
fixes the 49%.

**The three stages, each with its own state**, rather than one Status column:
- *Containment* — what was done immediately. Already 91% filled.
- *Root cause* — a short structured list (the register's own `Standard Defect`
  values are a good start) **plus free text**. One field, required to close.
- *Corrective action* — what stops it recurring, with an owner and a due date,
  then verification that it worked. This is the 19% column.

**Disposition** — rework, scrap, return to supplier, concession, use as is. A
concession needs who authorised it; that is the point of a concession.

**Cost** — material, labour, rework, and a total that is **computed, not
typed**. Currently 0% / 0% / 2% with a hand-entered total at 22%.

**Status derived, never typed.** Open → contained → cause identified →
corrective action agreed → verified → closed. Five spellings of two states is
what happens when status is free text.

### Phase 3b — the analysis the spreadsheet does with pivots

Reproduce, from live data:
- NCRs and cost by responsible department (`Internal Total Reduced`)
- Supplier performance, cost by supplier (`Supplier`)
- **Repeat NCRs**: defect type by month with a trend, and the "frequency of
  occurrence" logic on `Repeat NCRs CALC`. This is the sheet doing the most
  valuable work and the hardest to maintain by hand.
- Drawing office attribution (`DWG Office`)
- Actions — already built in v0.14.0; the NCR actions merge into it.

### Phase 3c — the connections that only work inside Grid

This is the part a spreadsheet cannot do, and the reason to build it here:
- A failed check or fault line **raises an NCR in one action**, carrying the
  inspection, panel, defect code and photographs with it.
- An NCR against a supplier part **feeds supplier quality** (Phase 2+).
- A repeat defect **flags the requirements matrix** — if the same defect recurs
  at the same stage, the inspection frequency there is wrong.
- Cost roll-up per project appears on the existing faults-per-project chart.

## 4. Decisions I need from you

1. **Numbering.** Keep `M`/`HB` prefixes as division or area codes, or move to
   one `NCR-26-0001` series with the old number preserved? I would do the
   latter, and show the legacy number everywhere it helps.
2. **The 12 duplicate numbers** — two NCRs each, or double entry?
3. **Severity is 7% filled.** Drop it, or make it required? A field that is
   almost never filled is worse than no field, because reports built on it lie.
4. **Cost.** Is material/labour cost obtainable at all, or is a single total the
   realistic answer? Never filling two columns for two years is an answer.
5. **`EXTERNAL` in Department responsible.** I would make supplier a proper
   field on the NCR, so "internal vs supplier" is a fact rather than a spelling.
6. **Import.** All 475, or open ones only? Importing 368 open NCRs with no root
   cause and no corrective action means starting with a backlog that cannot be
   closed without going back to the people who raised them.
7. **Who closes an NCR?** Grid can require that verification is not the person
   who did the corrective action, as it does for template approval — off by
   default like the others.

## 5. Sequence

| Step | What | Rough size |
|---|---|---|
| 1 | Schema, RLS, numbering, audit — migration `014` | small, mostly settled patterns |
| 2 | NCR register and detail screen, raise-from-inspection | the bulk of the work |
| 3 | Containment / cause / corrective-action workflow with states | medium |
| 4 | Import the 475, with a report of everything that needed cleaning | medium, needs your answers to §4 |
| 5 | Analysis tabs, repeat-defect trend | medium |
| 6 | Printable NCR, same treatment as the inspection report | small, pattern exists |

Steps 1–3 are the useful minimum: you could raise and close an NCR properly.
Step 4 is where the decisions above bite. Step 5 replaces the pivots.

## 6. One thing worth saying plainly

The spreadsheet has 10 pivot caches, two external links and a 149 MB data
sheet. It is at the end of its life as a tool — a `#REF!` in `Repeat NCRs CALC`
and `#VALUE!` in `Supplier` are already visible in the analysis, which means
some numbers being reported are wrong now.

That is an argument for building this, but also for **not** reproducing its
shape. The register is the easy part. Making corrective action and root cause
the path of least resistance is what would change the 19% and the 1%.
