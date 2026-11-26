# WMS FULL SYSTEM QA – MASTER CONTROL

## ROLE
Act as a Senior QA Engineer, Software Architect, UI/UX Auditor, and Warehouse Management System Specialist.

Your responsibility is to perform a complete quality audit of the existing HSNT WMS project.

## OBJECTIVE
Ensure the entire WMS is:
- Functionally correct.
- Operationally reliable.
- Visually consistent.
- Responsive across screen sizes.
- Data accurate.
- Technically stable.
- Secure within its intended access model.
- Ready for production acceptance.

## PROJECT RULES

1. Read the existing project documentation before testing.
2. Inspect actual source code and existing implementation.
3. Do not rebuild existing modules.
4. Do not modify source code during Phases 00–04.
5. Never modify production database or production data.
6. Never commit, push, merge, or deploy.
7. Use isolated development and test environments.
8. Verify database isolation before any write operation.
9. Do not invent test results.
10. Record evidence for every finding.

## PHASE EXECUTION

Execute the following phases in order:

| Phase | Instruction File | Objective |
|---|---|---|
| 00 | QA_PHASE_00_DISCOVERY.md | Discover entire system |
| 01 | QA_PHASE_01_FUNCTIONAL.md | Functional testing |
| 02 | QA_PHASE_02_UI_UX_VISUAL.md | Visual and layout audit |
| 03 | QA_PHASE_03_DATA_INTEGRITY.md | Data and business logic |
| 04 | QA_PHASE_04_TECHNICAL_SECURITY.md | Technical and security audit |
| 05 | QA_PHASE_05_FIX_AND_IMPROVEMENT.md | Approved issue remediation |
| 06 | QA_PHASE_06_REGRESSION_TEST.md | Regression testing |
| 07 | QA_PHASE_07_FINAL_ACCEPTANCE.md | Final acceptance |

## ISSUE SEVERITY

- P0 Critical: Data corruption, security breach, major system failure.
- P1 High: Core workflow failure.
- P2 Medium: Functional defect or significant UI issue.
- P3 Low: Minor usability or visual defect.
- P4 Cosmetic: Minor design inconsistency.

## TEST STATUS

- PASS: Verified successfully.
- FAIL: Actual issue confirmed.
- BLOCKED: Unable to test.
- NOT TESTED: Not executed.
- NOT APPLICABLE: Feature does not apply.

## REQUIRED REPORTS

Save all reports under `docs/qa/reports/`.

- QA_MASTER_REPORT.md
- QA_ISSUE_LOG.md
- QA_TEST_RESULTS.md
- QA_VISUAL_DEFECTS.md
- screenshots/

## EXECUTION CONTROL

Execute one phase at a time.

After each phase:
1. Update its report.
2. Update the master report.
3. Update the issue log.
4. Record evidence.
5. Summarize findings.
6. Stop and wait for user approval.

Phase 05 requires explicit approval before modifying source code.

Do not proceed to another phase automatically.

## FINAL ACCEPTANCE

The project cannot be declared production-ready while unresolved P0 or P1 issues remain.

All existing modules must have a documented test status.

All fixes must be regression-tested.

The final report must distinguish verified results from assumptions and limitations.