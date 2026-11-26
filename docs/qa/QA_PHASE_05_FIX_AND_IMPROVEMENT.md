# PHASE 05 – FIX AND IMPROVEMENT

## OBJECTIVE
Fix verified issues identified during Phases 00–04.

## PRECONDITIONS

Before implementation:

1. Read all QA reports.
2. Review QA_ISSUE_LOG.md.
3. Confirm the issue root causes.
4. Identify affected files and components.
5. Evaluate cross-module impact.
6. Prepare a proposed fix plan.
7. Obtain explicit user approval.

Do not begin source code modifications without approval.

## FIX PRIORITY

1. P0 – Critical.
2. P1 – High.
3. P2 – Medium.
4. P3 – Low.
5. P4 – Cosmetic.

## IMPLEMENTATION RULES

- Fix the root cause.
- Avoid unnecessary refactoring.
- Preserve existing business logic.
- Preserve existing database structure unless separately approved.
- Preserve API compatibility.
- Preserve RBAC.
- Preserve multilingual support.
- Preserve existing UI branding.
- Do not remove existing functionality.
- Do not introduce duplicate components.
- Avoid broad CSS changes that could affect unrelated pages.

## VISUAL FIXES

Correct:
- Container overflow.
- Incorrect dimensions.
- Text clipping.
- Typography.
- Alignment.
- Overlapping.
- Z-index.
- Responsive layout.
- Modal and dropdown positioning.
- Table dimensions.

## FUNCTIONAL FIXES

Correct:
- Broken buttons.
- Form validation.
- Incorrect state transitions.
- Search and filter defects.
- Navigation.
- API integration.
- Error handling.

## DATA FIXES

Correct only approved defects.

Do not alter historical production data or silently change business rules.

## TEST AFTER EVERY FIX

Run relevant:
- Unit tests.
- Integration tests.
- TypeScript checks.
- Build.
- Functional tests.
- Visual checks.

Record:
- Issue ID.
- Root cause.
- Files modified.
- Change description.
- Tests executed.
- Test results.
- Remaining risks.

## DELIVERABLES

Update:
- QA_ISSUE_LOG.md
- QA_MASTER_REPORT.md
- Fix Report.
- Changed Files Report.

Do not commit, push, merge, or deploy.

Stop after the approved issue list has been addressed.