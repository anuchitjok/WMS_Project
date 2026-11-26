# PHASE 00 – COMPLETE SYSTEM DISCOVERY

## OBJECTIVE
Perform a complete inspection of the existing WMS project to understand its architecture, modules, components, workflows, and technical dependencies before testing.

## TASK 1: PROJECT STRUCTURE
Inspect the entire project directory.

Identify:
- Frontend architecture.
- Backend architecture.
- Database structure.
- API services.
- Shared libraries.
- Configuration files.
- Environment variables.
- Testing frameworks.
- Build tools.

## TASK 2: MODULE DISCOVERY
Identify every existing module, submenu, and page.

Include:
- Dashboard / Control Tower.
- Receiving.
- Putaway.
- Inventory.
- Stock Availability.
- Issue.
- Picking.
- Packing.
- Shipment.
- RMA.
- DOA.
- RTV.
- Cycle Count.
- Scrap.
- Rack Management.
- Location Management.
- Capacity Planner.
- User Management.
- RBAC.
- Audit Trail.
- System Setup.
- Import / Export.
- 3D Warehouse.
- All other discovered modules.

Do not assume every listed module exists. Verify against the actual application.

## TASK 3: ROUTE AND COMPONENT DISCOVERY

Identify:
- All routes.
- All pages.
- All reusable components.
- All dialogs and modals.
- All forms.
- All tables.
- All charts.
- All navigation elements.
- All shared layouts.

## TASK 4: DATABASE AND API DISCOVERY

Document:
- Database tables.
- Relationships.
- Primary and foreign keys.
- Important constraints.
- API endpoints.
- Backend services.
- Data dependencies between modules.

Do not modify schemas or database records.

## TASK 5: MULTILINGUAL DISCOVERY

Inspect:
- English.
- Thai.
- Simplified Chinese.

Identify translation files, language switching logic, and localization architecture.

## TASK 6: TEST ENVIRONMENT

Identify how to run the application locally.

Verify:
- Frontend URL.
- Backend URL.
- Database target.
- Test account availability.
- Browser automation availability.
- Existing test scripts.

Never assume the database is isolated. Confirm before testing.

## DELIVERABLES

Create:
1. System Architecture Overview.
2. Complete Module Inventory.
3. Route Inventory.
4. Component Inventory.
5. API Inventory.
6. Database Overview.
7. Existing Test Coverage.
8. Environment Assessment.
9. QA Coverage Checklist.
10. Initial Risk Assessment.

Save reports under `docs/qa/reports/`.

## RESTRICTIONS

Do not modify source code, configuration, database, or production environment.

Do not start functional testing.

Complete Phase 00 and stop for approval.