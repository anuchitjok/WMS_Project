# Project Planning & Resource Calculator

A **planning-only** module. It estimates time, people, materials, warehouse
space and cost for a project before any work starts. It never creates
purchase orders, never reserves stock and never writes to operational tables
(StockItem, WithdrawalRequest, Slot, …). A test (`planning.int-spec.ts`) checks
this by counting operational rows before and after a calculation.

Menu: **Overview → Project Planning** (`/planning`, `/planning/project?id=…`).

## Prerequisites before merge / deploy

1. Apply `database/schema/22_project_planning.sql` to the database **before**
   merging to `master` (merging deploys immediately).
   - Additive and idempotent: three new tables (`PlanningProject`,
     `PlanningScenario`, `PlanningRun`), their indexes, and foreign keys
     between them only.
   - Adds 4 rows to the `Permission` catalogue (`planning.read`,
     `planning.manage`, `planning.approve`, `planning.cost`) with
     `ON CONFLICT DO NOTHING`. **No role is granted anything.**
2. Existing users keep access through existing codes and legacy roles
   (see `backend/src/auth/access.ts`: `planningRead`, `planningManage`,
   `planningApprove`, `planningCost`). Grant the new `planning.*` codes to DB
   roles only if you want finer control.

## Data the module uses and does not have

| Needed by the spec | In this WMS today | What the module does |
|---|---|---|
| BOM / MRP | Not present | Materials are entered per project ("manually defined") and labelled as such. |
| Purchase orders / supplier ETAs | Not present | Expected supply is entered by hand; stock in inspection is counted as inbound. |
| Demand forecast | Not present | Project demand is marked forecast (draft) or confirmed (approved plans). |
| Productivity standards | Not present | Entered per stage, marked **Validated** or **Estimate**. Never defaulted. |
| Labour rates | Not present | Entered per scenario. Missing → cost marked incomplete. |
| Warehouse dimensions | Floor Plan (only when unit is metres) and slots | Used when present; otherwise flagged as missing, or entered as an override. |
| Packaging (units/carton, cartons/pallet) | Not in Product Master | Entered per scenario; missing → space marked incomplete. |
| Product unit cost currency | Not declared | Excluded from cost unless the planner enters a rate to the project currency. |

## How Calculate works

1. Validate the inputs. Missing required values block the run and are listed;
   nothing is estimated in their place.
2. Read stock, unreserved requests, other approved plans, slots and layout
   areas inside one repeatable-read transaction (a consistent snapshot).
3. Run the pure engine `calculatePlan()` (`backend/src/planning/engine/`).
4. Save a `PlanningRun` with the input snapshot, data snapshot, a sha256 hash,
   the engine version and the result. **Verify** (History tab) recomputes from
   the stored snapshot and confirms the result is identical.

## Formulas (with the browser-verified sample)

Sample: 200 units, 1 shift of 8 h with 60 min break (7 net h/day),
utilization 85 %, absence 5 %, 6 people available, Repair template.

- **Stage capacity / day** = stations × operators × clock h/day × 60 ×
  utilization × (1 − buffer) ÷ minutes per unit.
  Repair: 3 × 1 × 7 × 60 × 0.85 ÷ 45 = **23.8 units/day**.
- **Line pace** = the slowest stage, in finished units. Capacities are never
  added together. Bottleneck: Repair, 23.8/day.
- **Quantities** flow backwards: stage input = ⌈ successor need ÷ yield ⌉;
  processed = input + ⌈ input × rework % ⌉.
- **Labour hours** = processed × minutes ÷ 60 ÷ utilization + setup × crew.
  Repair: 200 × 45 ÷ 60 ÷ 0.85 = 176.47 h. Total 313.72 h.
- **FTE** = labour hours ÷ (working days × net hours) = 313.72 ÷ (15 × 7) = 2.99.
- **Headcount** = the larger of
  - hours-based ⌈ 313.72 ÷ (15 × 7 × 0.95) ⌉ = 4, and
  - schedule-based ⌈ peak concurrent crew × shifts ÷ (1 − absence) ⌉ =
    ⌈ 3 × 1 ÷ 0.95 ⌉ = 4.

  Stages that run one after another share people; overlapping stages add up.
  "If each stage had its own crew" (15) is shown only for contrast.
- **Schedule**: forward pass in working clock hours, with optional transfer
  batches; the critical path is traced back from the stage that finishes last.
  Sample: finish 2026-12-03, 9 working days after the 2026-11-20 target.
- **Materials** (MB-X200): need 200 × 1 × 1.02 = 204.
  Usable = 140 available − 10 safety stock − 8 pending requests − 0 other
  approved plans = 122. Reserved stock (12) is already excluded from
  "available", so it is not subtracted twice. Net requirement 82; 20 in
  inspection arrive in time; **shortage 62**, order by 2026-10-30
  (10-day lead time). A suggestion only.
- **Cost**: in the project currency only. Inputs in another currency need an
  explicit rate; otherwise they are excluded and the cost is marked incomplete.
- **What-ifs** (2 shifts, +1 station at the bottleneck, transfer batches)
  re-run the engine with one change and are never applied automatically.

## Statuses and approval

- Run status flags include Material Shortage, Schedule at Risk, Capacity Risk,
  Cost Estimate Incomplete and Insufficient Data; overall Ready / At risk / Not ready.
- Plan status: DRAFT → IN_REVIEW → PLAN_APPROVED / PLAN_REJECTED, plus ARCHIVED.
  - Submit needs a run calculated from the current inputs.
  - The approver must be a different person from the submitter.
  - Editing an approved plan returns it to DRAFT (audit `PLANNING_APPROVAL_WITHDRAWN`).
- **Plan approval is not execution approval.** Requests, reservations and
  purchasing still go through the normal WMS flows.

## Access

- Read: planners, supervisors, managers, management / finance viewers, auditors.
- Manage (edit, calculate, submit): supervisors and above, or `planning.manage`.
- Approve: managers / admins, or `planning.approve`.
- Cost (unit costs, labour rates, cost results): `planning.cost` or finance /
  management roles. Users without it see costs hidden, and their saves keep
  the hidden cost inputs unchanged.
- Warehouse scope applies: users only see and plan for their warehouses.

## Known limitations

- Overall headcount assumes people can move between stages regardless of
  skill. The "By skill" table shows the per-skill need; if skills are not
  interchangeable, the true headcount is closer to the sum of that table.
- No BOM, MRP, PO, supplier or forecast data exists in the WMS, so those
  inputs are manual.
- Space sizing needs packaging and pallet dimensions that the Product
  Master does not hold.
