# HSNT WMS — Demo Login Accounts

> Demo environment on the current Supabase database. All demo data is `DEMO-` tagged
> and fully removable via `npm run seed:demo:reset`. **Login URL:** `/login`

| Role | Username | Password | What they can do in the demo |
|---|---|---|---|
| Administrator | `demo_admin` | `Demo@Admin1` | Full access — all modules, users, settings, audit |
| Manager | `demo_manager` | `Demo@Manager1` | Warehouse oversight, approvals, reports, dashboards |
| Supervisor | `demo_supervisor` | `Demo@Super1` | Warehouse operations, approval queue, fulfillment |
| Operator | `demo_operator` | `Demo@Operator1` | Receiving, putaway, pick/pack, scanner |
| Requester | `demo_requester` | `Demo@Request1` | Create withdrawal requests, confirm issued items, returns |

## Notes
- Passwords are ≥ 6 characters (login validation requirement).
- Roles map to the system `UserRole` enum: SYSTEM_ADMIN, WAREHOUSE_MANAGER, WAREHOUSE_SUPERVISOR, WAREHOUSE_STAFF, REQUESTER.
- Role-based menu visibility is enforced (e.g., Requester does not see warehouse-admin actions; Operator cannot approve requests).
- These accounts are created/refreshed every time `npm run seed:demo` runs and removed by `npm run seed:demo:reset`.

## Re-seeding the demo
```bash
cd backend
npm run seed:demo        # reset DEMO- data, then generate a fresh demo dataset + users
npm run seed:demo:reset  # remove ALL DEMO- data (production untouched)
```
