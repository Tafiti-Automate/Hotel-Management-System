# Phase 1 — Role-by-role frontend/API validation

**Date:** 17 November 2026  
**Repository:** Tafiti-Automate/Hotel-Management-System  
**Target branch:** `back$front`  
**Scope:** Django REST API + Next.js UI role navigation, route availability, read-only evidence, page data requirements and negative authorization. No arbitrary privilege elevation.

## Operational roles

The client reference describes ten operational roles. The implementation uses the following canonical Django groups:

| Reference function | Canonical role | Screen/API smoke tests |
|---|---|---|
| Outlet / department supervision | Department Supervisor | Department store requests; item/store browsing; waste records |
| HOD (level 1, recipe & external PR) | Department Head | Own requisitions and lines; department requests; item/units |
| Storeroom & posting | Store Keeper | Assigned stock count + lines, GRNs, balances and ledger |
| Property-wide F&B audit | Cost Controller | Stocktake variance/ledger; supplier quote matrix |
| Purchasing | Procurement Manager | PR/PO/quotes/vendor resources |
| Physical delivery | Receiving Clerk | Purchase orders, GRNs |
| Supplier ledger | Accounts Payable Clerk | Invoices, PO/GRN/return data for three-way matching |
| Finance control | Financial Manager | Cost control evidence, three-way matching review, budgets, close |
| Executive approval | General Manager | PO approvals and finance overview |
| IT controls | System Administrator | Users, roles, branches and article master |

## Confirmed issues and corrections

1. **Financial Manager stocktake and 3-way invoice matching 403s.** Finance route was visible, while Django role permissions omitted `stockcount`, `stockcountitem`, `stockledger`, `goodsreceiptnote`, `goodsreceiptitem` and `supplierreturn`. Added **read-only** rights; no add/change/delete permissions granted. Matching and payment controls in the invoice review UI are shown only for Accounts Payable.
2. **Department Head PR builder 403 / confidentiality.** The new PR screen fetched supplier-item-prices, which HOD cannot see. Changed it to quantity-only requests and removed prices, supplier quotes and estimated unit cost from outbound line payloads. Added narrow add/view permissions for department-created PRs/lines with requisition-line queryset ownership and create checks; no commercial supplier-price rights.
3. **HOD approval navigation pointed at procurement approvals instead of the department request workflow.** Navigation now opens the department-store workflow rather than an inappropriate approval API.
4. **IT user administration 403.** User/role/permission endpoints required `is_staff`, although the canonical System Administrator group is assigned independently. Changed these endpoints to require authenticated active membership of the **System Administrator** group or superuser status; ordinary roles remain blocked.
5. **Supervisor blind stocktake link currently targets a Store Keeper-only count sheet.** Removed this inaccessible link until a properly scoped *outlet* counting workflow is implemented. No broad read access to main-store stock or ledger was granted.

## Automated coverage

- `hotel_erp_backend/tests/test_phase1_role_screen_contracts.py`: GET smoke tests for the relevant enterprise screen collections under all **ten** canonical roles; negative tests for IT registry and commercial supplier data.
- `frontend/src/features/shared/phase1RoleRoutes.test.mjs`: positive role route checks for all ten roles; negative route checks for forbidden actions and pages.
- Existing tests: `test_stocktake_cost_controller_access.py`, `test_stocktake_role_separation.py`, `test_stocktake_immutability.py`, `test_report_role_access.py`, `enterpriseAccess.test.mjs`.

All grants and denials are tested on isolated test database users, **not** the live hotel deployment. Passing GET response tests establish that data endpoints are reachable for an empty role account, **not** that real branch/department/store records or every mutation sequence have passed browser acceptance.

## Outstanding acceptance items

**P0**
- Install/upgrade the backend deployment and run `python manage.py migrate` and `python manage.py setup_hotel_roles` so permissions stored in the live database match code. Do not assert production is fixed until tested with each actual staff role.
- Create an independent test user per canonical role with employee/property/department/store assignments. Exercise every sidebar page with real fixtures and test allowed/forbidden mutations, scope leaks and forbidden data fields.
- Validate all remaining non-enterprise screens and dynamic action paths; route smoke tests in this phase are a representative baseline, not exhaustive coverage.

**P1**
- Build a separate department/outlet blind-stocktake entry workflow tied to outlet assignments. Current shared stock count sheet remains restricted to Store Keepers.
- Review other legacy role menus and header context for indirect API fetches not visible in the direct page list.
- Run an end-to-end purchase-to-pay integration journey with positive, negative, empty and interrupted states; this continues in Phase 2.

## Release gate

Only label Phase 1 complete after both GitHub Actions jobs succeed on the final commit **and** every role successfully executes a deployed browser acceptance checklist. Earlier successful CI cannot certify untested production environment settings.
