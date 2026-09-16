# Module 5 — Customer Quality Management: a plan

Read from `Module_5_Customer_Quality_Management.xlsx`: **989 complaints**,
26 columns, 7 sheets, 2016 to 2026. What follows is grounded in what the
register actually contains rather than what its columns imply.

---

## 1. What the spreadsheet says about how complaints really work

Fill rates across all 989 records, because they describe the process as it is
rather than as the form asks for it:

| Field | Filled | Read this as |
|---|---|---|
| Section, CC No, Customer, Call Date, Details, CE, Status | 96–97% | the actual core of a complaint |
| Site Eng | 90% | usually assigned |
| Financial Year, Month Term, Year | 85–100% | mostly derived |
| Defect Code 1 | 52% | the analysis field that half works |
| **Contract Number / Delivery Date** | **22% / 23%** | mostly "TBC" and never revisited |
| **Complaint Type** | **22%** | and inconsistent — see §2 |
| **Corrective Action** | **21%** | four in five never record one |
| **Correction** | **21%** | |
| **Root Cause** | **20%** | |
| **Estimated Cost** | **20%** | |
| **Response Date** | **15%** | |
| **Labour / Material Cost** | **13% / 8%** | |
| **Response Time** | **9%** | |
| **Closed Date** | **3%** | 38 records out of 989 |
| Defect Code 2 | 1% | effectively unused |

### The number that matters

**957 complaints are marked Closed. 38 have a closing date.**

Closure is asserted, not evidenced. Nobody can say how long this division takes
to resolve a customer complaint, because for 96% of them the date it was
resolved was never written down. Response time is worse: 132 records have both
a call date and a response date, so the interval a customer actually waits
before hearing back is measurable on **13%** of complaints.

Those two intervals are the entire point of a complaints process. ISO 9001
clause 9.1.2 asks an organisation to monitor customer perception, and clause
10.2 asks it to react to nonconformity and evaluate whether the action taken
worked. Neither is demonstrable from this register, and an auditor sampling it
would establish that within about ten minutes.

### The second thing

Root cause 20%, corrective action 21%. Almost exactly the NCR register's
numbers, and the same conclusion follows: this is good at *recording* a
complaint and poor at *closing* one. A faithful copy of the spreadsheet would
preserve that. The module should make the closing half the easy half.

---

## 2. Where the data has drifted

The `List` sheet defines eleven complaint types. The `DATA` sheet does not use
them — it is free text, so:

- `Technical / Quality` (189), `Techical / Quality` (3, a typo),
  `Technical/Quality - Electrical` (4), `Technical / Quality-Electrical` (2)
- `Wiring` (4) and `wiring` (1)
- `Shortage` (8), `Transport` (2), `Damage in Transit` (2)

Four spellings of one category means the category cannot be counted. Same in
Section: `Minisubs` (266) against `Minisub` (2), and `renewable` lowercase.
Same in Status: `Closed` (950) and `closed` (7).

**Dates are worse.** `Year` contains `1900` on 29 records, `#VALUE!` on three,
and scattered values from 2001, 2009 and 2011–2015 that predate the register.
Those are spreadsheet arithmetic failures, not history.

None of this is carelessness. It is what a shared workbook does over ten years.
It is also the argument for the module: a list that is enforced cannot drift.

---

## 3. What is actually good here

Worth saying, because the NCR register had less going for it.

**Defect Code 1 is filled on 52%** and the vocabulary is sound — Breaker
Defect (72), Transformer Defect (38), Wiring Defect (37), Ring Main Unit
Defect (28), Oil Leak (25), Painting (23). That is a usable defect taxonomy
that people evidently do use, and it should survive into the module rather than
being redesigned.

**Cost is recorded on 178 complaints, totalling R8.46m.** Thin coverage, but
the records that exist are specific, and they are the only evidence of what
customer quality failures cost this division.

**Two named people per complaint** — `CE` (97%) and `Site Eng` (90%). Both are
almost always filled, which means the accountability half of the process works.

---

## 4. Questions I need answered before building

**4.1 Complaint types.** Do we adopt the eleven in the `List` sheet as the
enforced list — Lack of Response, Delivery, Damage in Transit, EHS,
Technical/Quality Electrical, Technical/Quality Mechanical, Design, Payment,
Shortage, Install & Commissioning? The data suggests Technical/Quality is 85%
of everything, which makes the other ten nearly unused. Is that real, or is it
the free-text field collapsing into one habit?

**4.2 Response time.** Is there a target? A complaint register that records a
response date without a commitment to respond within some period is recording a
number nobody is measured against. If there is an agreed target, the module
should show what is overdue rather than what was slow.

**4.3 Sections.** Indoor, Minisubs, Outdoor, Aftersales, WPI, Renewable,
Western Region, Ekurhuleni, Medupi, Quoted Work. Are these product lines,
departments, or sites? It matters for whether one Grid deployment covers them
or whether some belong to other divisions.

**4.4 CE and Site Eng.** What are these roles? Is CE the customer engineer who
owns the complaint, and Site Eng whoever attends? Do both need to be Grid users
or is one a free-text name?

**4.5 The link to NCRs.** This is the significant one. A customer complaint
with a technical cause is usually also a nonconformance — and Module 3 already
has the seven-stage ladder, root causes, corrective actions with verification,
and the report. Should raising a complaint of type Technical/Quality prompt an
NCR, linked, so the investigation happens once in one place?

My view: yes, and it is most of the value of doing this module at all. The
alternative is two registers that describe the same failure and disagree.

**4.6 The 989 records.** Import all, or from a cut-off? The pre-2016 rows and
the 1900 dates are arithmetic failures rather than complaints. I would import
everything from 2016, report every row that needed cleaning, and leave the rest
in the workbook.

---

## 5. Shape of the build, subject to §4

| Step | What | Size |
|---|---|---|
| 1 | Schema: complaints, complaint types, response and closure timestamps, link to ncrs | medium |
| 2 | Raise, respond, close — with closure requiring a closing date, a cause and an action | medium |
| 3 | The register, with the filters the workbook's pivot tables were reaching for | small |
| 4 | Import the 989, with a report of everything that needed cleaning | medium, needs §4.6 |
| 5 | Response and closure time reporting, by section and by month | small |
| 6 | Printable complaint, same treatment as the NCR report | small, pattern exists |

**Step 2 carries the whole point.** If closing a complaint requires a closing
date the way closing an NCR requires a root cause, then in a year this register
can answer how long this division takes to resolve a customer complaint. Today
it cannot answer that at all.

---

## 6. What I would not build

**A satisfaction score.** Clause 9.1.2 asks for customer perception, and it is
tempting to add a rating field. Nothing in ten years of this workbook suggests
anyone has ever asked a customer how satisfied they were, and a field that is
never filled is worse than no field, because reports built on it lie. If
customer perception is wanted it needs a way of collecting it first, and that
is a different piece of work.

**A second defect taxonomy.** Defect Code 1 here and `defect_codes` in Module 2
overlap heavily — Breaker Defect, Wiring Defect, Painting. One list, used by
both, or the same fault gets counted under two names depending on who found it.
