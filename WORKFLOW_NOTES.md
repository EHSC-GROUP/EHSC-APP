# Client workbook analysis — running notes

Source: client's Excel workbook "EHS PM Tool" (11 sheets, all visible, no hidden rows/cols).
Reports come from Claude-in-Excel, pasted one sheet at a time. Client names are masked
(PERSON_n / CLIENT_n). This file is the working memory for mapping it onto the app —
append one section per sheet, then do the consolidation/field-placement at the end.

App levels used for placement: Enquiry (Business Development) -> Company Profile ->
Project (Project Tracker) -> Plan Action / Template. Dropdown lists -> Settings.

## Workbook-level facts
- Sheets (11): Read Me (1), Dashboard (2, pending), Lists (3, done), then Master Project Tracker, Task Tracker,
  Resource Capacity, Audit Schedule, Financial Tracker, Monthly Review, Supplier Assessments, Dealer
  Assessments (order of the rest still to be confirmed as reports arrive).
- Stated data flow: Master Project Tracker -> Task Tracker -> Resource Capacity ->
  Audit Schedule -> Financial Tracker -> Management Dashboard.
- Cadence: weekly internal operations review + monthly top-management review.
- Supplier Assessments and Dealer Assessments are maintained SEPARATELY from the project flow.
- Join key between sheets: **Project ID** (one project -> many tasks).
- Business: Bengaluru EHS/ESG consulting operations (EHS Consultants Group).

## 1. Read Me (done)
Purpose: user guide, no data. Owner of dashboard = PERSON_1 (Sr. Manager Operations - ESG & EHS Services).
Core team: PERSON_1..PERSON_5 (PERSON_2 = COO).

Recommended workflow (7 steps): (1) enter live projects + commercial values in Master Project
Tracker; (2) milestones/deliverables in Task Tracker; (3) update resource allocation/utilisation;
(4) planned + completed audits in Audit Schedule; (5) invoice + payment status in Financial
Tracker; (6) review Dashboard before weekly ops meeting; (7) Monthly Review for management reporting.

Milestone structure: each project block = Name, Start Date, Due Date, Status, % Complete, Owner,
Deliverable, Remarks. Text says 8 blocks; the actual table (Master Project Tracker A3:BJ52) has 5
(M1-M5). Extra milestones go in Task Tracker under same Project ID.

**Service Scope list (Read Me!B8) — dropdown candidate, 10 items:**
ISO Projects; ESG Consultancy; EcoVadis; GRI & BRSR Reporting; Audits & Assessments; Legal
Compliance; ZWL; Supply Chain Audits; IFC/Biodiversity Projects; Capacity Building.
(Compare with Master Project Tracker "Service" column and the app's PROJECT_TYPES:
GHG, ISO, EV, CDP, SR, AUDIT, TRAINING, ASSESSMENT — they do NOT match yet.)

Open questions for client:
- 8 vs 5 milestone blocks per project — which is right?
- Task Tracker = milestones, tasks, or both?
- Is Service Scope the master services list? ("Lists" sheet not mentioned in Read Me)
- How does a project start (enquiry/proposal/PO)? Handled outside the workbook? (App already has Business Development for this.)

## 3. Lists (done — workbook position 3 of 11; sheet 2 "Dashboard" still pending)
Title A1: "EHS PM Tool - Master Lists". Pure lookup sheet: no formulas, no validation of its own,
unprotected, nothing hidden. 8 list columns in A3:H3 (values from row 4), plus a stray second
"Status" block at B12:B18 that exactly repeats A4:A9 (unused/duplicate -> ignore).
Lists feeds validation on Task Tracker, Audit Schedule, Financial Tracker. Master Project
Tracker has the same dropdowns typed in by hand (not linked) and they drift from Lists.

**Dropdown lists (clean values, one-of unless noted):**
- Project Status (A4:A9): Not Started; Planning; Ongoing; On Hold; Completed; Cancelled
  (order looks like a lifecycle but nothing enforces it)
- Priority (B4:B7): Critical; High; Medium; Low
- Service (C4:C8, only 5): ISO Consultancy; ESG Consultancy; Audits & Assessments; Legal Compliance; Training
  (Read Me lists 10 services - see below; Master Project Tracker rule says "Audit & Assessment" singular)
- Region (E4:E5): India; Global  (Supplier/Dealer Assessments sheets have a Region/State column -> may need state list)
- Payment Status (F4:F9): Not Invoiced; Invoice Pending; Invoiced; Partially Paid; Paid; Overdue
  (Financial Tracker rule only covers F4:F8 so "Overdue" is NOT selectable there - likely a bug; app should include it)
- Risk (G4:G7): Low; Medium; High; Critical
- Team Member (H4:H8): PERSON_2; PERSON_1; PERSON_3; PERSON_4; PERSON_5 (= the core team; spellings differ
  between Lists and Master Project Tracker's Project Manager rule -> in the app this must become the
  employee list, not typed names)

**Project Type (D4:D8) is NOT a clean list** - free text, several types per cell, rows align with Service rows:
- D4: "ISO 14K, 45k, 9k, 50001"   (next to ISO Consultancy -> ISO standards 14001/45001/9001/50001; the app already has ISO sub-types)
- D5: "ECOVADIS, CDP, GHG, BRSR, SR, CBAM"   (next to ESG Consultancy)
- D6: "ISO, ESG, Supply chain, Assurance"   (next to Audits & Assessments)
- D7: "EHS, OHS, Legal register"   (next to Legal Compliance)
- D8: "IA, HIRA, AIA, ESG,"   (next to Training; trailing comma; IA=Internal Audit? HIRA=Hazard ID & Risk Assessment? AIA=?)
Inferred model: **Service (5) -> Project Type (dependent dropdown)**. Not confirmed by the workbook.
Compare to app PROJECT_TYPES (GHG, ISO, EV, CDP, SR, AUDIT, TRAINING, ASSESSMENT): the client's real
hierarchy is Service > Project Type. Probable app change: add a Service field and make Project Type depend on it.

**Not in Lists / not a dropdown anywhere:** Client, Branch/Site, enquiry stage, proposal, PO, invoice %.
Workflow facts: no triggers, no standard durations, no task->days table, no invoice percentages in this sheet.
Colour: header cells only (cosmetic, no meaning).

**Mismatches between Lists and Master Project Tracker rules (hard-coded there):**
- D Service: same five but "Audit & Assessment" (singular) vs Lists "Audits & Assessments"
- G Project Manager: spelled differently from Lists H4:H8 (only PERSON_2 matches exactly)
- K Project Status: same six, but "On Hold " and "Completed " have trailing spaces
- L Priority: matches Lists B4:B7

**Open questions for client (Lists):**
1. Is each Project Type cell one type or a group? What do the codes (14K, 45K, 9K, IA, HIRA, AIA, SR) mean?
2. Should Project Type depend on Service (rows line up)?
3. Why is B12:B18 a duplicate Status block - used anywhere?
4. Which team-member spelling is right (Lists vs Master Project Tracker)?
5. Should "Overdue" be selectable on Financial Tracker?
6. Why does Read Me list 10 services but Lists has 5? Where do EcoVadis, GRI/BRSR, ZWL, Supply Chain Audits,
   IFC/Biodiversity and Capacity Building belong?
7. Region has only India/Global - should it be a state list? (Supplier/Dealer sheets have Region/State.)
(I only scanned validation on the 9 columns of Task/Audit/Financial plus 4 on Master Tracker so far - the
analyst said it will re-check more columns when it reaches them.)

## 4. Master Project Tracker (done — position 4 of 11; Dashboard still pending)
Table "ProjectMasterMilestones" at A3:BJ52 (62 columns, header row 3, filter on). 22 real projects
(rows 4-25), rows 26-52 blank. **No formulas anywhere (confirmed)**. Rows 1-2 = title + one-line
instruction. One row = one project. Starts at PO/contract stage onwards (no enquiry/proposal here).
Users: operations manager + project managers. Real data is thin: most "tracking" columns are EMPTY.

**Columns that are actually used (fill rate):**
| Col | Header | Notes |
|---|---|---|
| A | Project ID | e.g. 2026/CONS/ESG/18 — NOT unique (20 distinct in 22 rows); prefixes CONS/ESG, CONS/ISO, AUD, TRG, 1 oddball 2026/AUD/011 for an ESG service; format drift (ISO006) |
| B | Client | free text, 16 raw spellings of 13 real clients (e.g. "TVS Motor Company Limited" in 4 variants, trailing spaces) |
| C | Project / Engagement | free text name |
| D | Service | dropdown (validation): ESG Consultancy 10, ISO Consultancy 5, Audit & Assessment 3, Training 2 (+ Legal Compliance allowed, unused) |
| E | Project Type | free text, no validation — Ecovadis 4, ESG 4, GHG 2, CBAM 2, BRSR, ISO 14001:2026, HIRA, AIA, combined ISO standards ("ISO14001:2015, ISO45001:2018 & ISO9001:2015"), Supply Chain Assessment, Sustainability Report, Water Conservation Assessment |
| F | Region | India 21, Global 1 (free text) |
| G | Project Manager | dropdown (validation) but 77% filled and data breaks the rule (spelling variants of the PERSONs) |
| H | Team Members | comma-separated people, 59% filled, free text, mix of "Ms./Mr./Associate-" prefixes |
| K | Project Status | dropdown: Ongoing 16, Planning 4, Not Started 1, Completed 1 |
| L | Priority | dropdown: Medium 15, High 5, Low 1, Critical 1 |
| M | Client SPOC | 36% filled, one contact per row, depends on client |

**Columns that exist but are 0% used (client never fills them):** Project Start Date (I), Project Target Date (J),
Commercial Value (N), Invoiced (O), Received (P), Outstanding (Q), Overall % Complete (R), Overall Next Milestone (S),
Overall Risk (T), Last Update (U), Management Action Required (V); every milestone Start/Due/Status/Owner/Remarks.
(Money is tracked in the Financial Tracker sheet instead — to confirm.)

**Milestone blocks M1-M5** (5 blocks, not the 8 the Read Me promises): per block = Milestone Name,
Start, Due, Status, % Complete, Owner, Deliverable, Remarks. Cols: M1 W-AD, M2 AE-AL, M3 AM-AT, M4 AU-BB, M5 BC-BJ.
13 hidden columns (all empty): AD AF AG AL AN AO AP AR AT AV AW AX AZ.
**How they are REALLY used: the milestones are PAYMENT / INVOICE TRIGGERS.** Name = billing trigger,
"% Complete" column = % of contract value invoiced at that trigger (adds to 100%). Start/Due/Owner never used.
Deliverable column just repeats the Milestone Name.

**Real examples (invoice split per project, from the data):**
- Ecovadis Implementation (A5): Advance 30% / On Assessment Completion 25% / On Report Completion 25% / On completion of Support for Submission of Documents in Ecovadis Portal 15%  (= 95%, probably an error)
- Ecovadis support (A10): Advance 35 / On Assessment Completion 25 / On Report Completion 25 / On completion of Support for Submission ... Portal 15 = 100
- ISO 14001 & 9001:2026 (A13): After Initial Assessment & Gap Analysis 20 / After Documentation Development 40 / After Training & Awareness Sessions 20 / After Internal Audit Training 10 / After Internal Audits 10 = 100 (5th milestone sits in wrong columns BB:BD)
- ISO 14001 & 45001 recertification (A21): Advance 50 / After first level Training to management & CFT members 25 / After review & documentation for the management system 20 / After Internal Audit Completion 5 = 100
- ISO 50001 (A22): Advance 50 / After completion of training 25 / After Internal Audit 25 = 100
- Rows 14-20: no milestone name, only "50%" in AA (probably the advance, unstated)
=> This maps almost 1:1 to the app's existing **Invoice Stages** (stage % + the Project Plan actions tagged to a stage). The app
   already has 4 stages; the client uses 3-5 per project and wants a NAMED trigger per stage.

**Validation mismatches vs Lists (see sheet 3):** Service ("Audit & Assessment"), Project Manager spellings, Status trailing
spaces ("On Hold ", "Completed "), Priority OK. Number formats: only R, AA, AI, AQ, AY, BG are %; N:P have no rupee format.
**Conditional formatting:** on the five % columns (AA AI AQ AY BG, rows 4-52): <50% colour 1, 50-80% colour 2, >=80% colour 3
(colours not rendering/unclear meaning). Header "AI3" is a single space, not "M2 - % Complete".

**Relationships:** Project ID is the intended key to Task Tracker (but not unique). Client repeats (CLIENT_1 has 3 projects,
CLIENT_5 has 6) -> client is one-to-many with Project (matches our Company Profile -> Projects). No branch column (branch sits
inside the client name, e.g. "Centre for Innovation & Technology (CIT)", "- IQL Anekal"). Row C23 says "Dealers Audit" though a
separate Dealer Assessments sheet exists. Financial Tracker has PO No. and Invoice No. (to check).

**Open questions for client (Master Project Tracker):**
1. Do the M1-M5 "% Complete" values mean invoice split or real progress? (Headers say progress, names/data say payment.) Why is the header "% Complete"?
2. What does "50%" with no milestone name (AA14:AA20) mean?
3. Row 5 percentages total 95% — error?
4. Is BB13:BD13 a misplaced 5th milestone? 5 or 8 blocks? Why is M2 % header blank-ish (AI3)?
5. Why are Start/Due/Value/Invoiced/Received/Outstanding/Overall columns empty — tracked in other sheets?
6. How are Overall % / Outstanding / Next Milestone supposed to be calculated?
7. Is Project ID unique per project? Why do 2026/CONS/ISO/004 and 2026/AUD/001 each appear twice? Is the sequence per prefix or global?
8. PERSON_6/7/8 in Team Members — external associates? Need them in a staff list?
9. What do the colours at 50%/80% mean?
10. A12 = 2026/AUD/011 with Service ESG Consultancy: prefix or Service wrong?
11. What does "#86" suffix in a client name mean?
12. Project Type: one value or several per project (Project Type appears to be multi-select)?

**Data-model takeaways (draft, to confirm):**
- Project ID format: `YYYY/<DEPT>/<SERVICE-CODE>/<running no>` (e.g. 2026/CONS/ESG/18, 2026/CONS/ISO/004, 2026/AUD/001, 2026/TRG/..).
  The app auto-generates PRJ150001-style IDs today -> replace with this format (needs rules answered above).
- Project fields the client really uses: Client, Project name, Service, Project Type (multi), Region, Project Manager, Team Members (multi), Status, Priority, Client SPOC, + payment milestones (name + % each).
- Fields they have but never fill: start/target dates, commercial value & money tracking, overall %/risk/next milestone, last update, mgmt action.

## 5. Task Tracker (done — position 5 of 11)
Table "TaskTracker" A3:Q57 (54 data rows, only 4 filled = SAMPLE DATA: PRJ-001..003, "Sample Client A/B/C",
TSK-001..004 — none match the real Project IDs). Frozen A1:Q3. One row per task/workstream. Execution + deliverables stage.
Columns: Task ID (TSK-NNN) | Project ID (free text, repeats, no validation, doesn't match Master Tracker today) |
Client (typed again every row, no lookup) | Workstream/Task | Owner (dropdown = Lists team member) | Start Date | Due Date |
Status (dropdown = Lists Project Status) | Priority (dropdown) | % Complete (0-100 number, not %) | Dependency (free text — in sample
equals the Deliverable of an earlier task, e.g. "Gap report") | Deliverable | Days Remaining (formula) | Delay (Days) (formula) |
Risk (dropdown) | Escalation Required (Yes/No, typed, no validation) | Remarks (unused).
**Formulas (only 2, rows 4-7; not copied to new rows):**
- Days Remaining = IF(Due="","",Due-TODAY())  (negative = overdue)
- Delay (Days)   = IF(AND(Due<TODAY(), Status<>"Completed"), TODAY()-Due, 0)  — quirk: Cancelled and On Hold tasks still count as delayed
**Rules:** none automatic. Status, Risk, % Complete, Escalation are all typed by hand; no link between task completion and invoice
stages; no standard durations (sample tasks span 11-36 days, e.g. Gap assessment report 11d, Documentation development 26d,
EcoVadis evidence review 19d, ESG data collection 36d). No colours, no approvals.
**Relationships:** Project ID -> project (one-to-many, typed); Client duplicated; Owner -> team list; no milestone/invoice column.
**App comparison:** this is almost exactly our **Project Plan actions** (description, assignee, start, due, completed, dependsOn,
stage tag). Missing in the app: Priority, Risk, % Complete, Deliverable, Escalation, Remarks, Delay/Days-remaining display.
**Open questions (Task Tracker):** are the 4 rows only samples? real Project ID format/source of tasks? should Client auto-fill from
Project? standard task durations / template per Service? Dependency = Task ID, deliverable or client input? % Complete 0-100 or 0-1?
should Cancelled/On Hold count as delayed? what makes Escalation "Yes"? are Master Tracker milestones also tasks? is Remarks used?
