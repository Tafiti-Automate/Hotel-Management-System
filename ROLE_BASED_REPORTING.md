# Role-Based Reporting

This release adds a dedicated Reports workspace to every client-approved operational role without changing the login screen or the procurement/stores workflow sequence.

## Reporting access

Report visibility is defined by role in the frontend and independently enforced by the Django reports API. A user cannot gain access to a restricted backend report by manually calling its endpoint.

| Role | Reports |
| --- | --- |
| Requester | Department Request Register; Stock Issue Register |
| Department Head | Department Request Register; Stock Issue Register |
| Store Keeper | Department Request Register; Stock Issue Register; Stock Valuation; Low Stock & Reorder; Stock Card; Stock Expiry; Stock Consumption; Stock Movement Control; GRN Register |
| Cost Controller | Low Stock & Reorder; Procurement Status Summary; Supplier Price Changes; Supplier Directory |
| Procurement Manager | Purchase Requisition Register; Procurement Status Summary; LPO Register; GRN Register; Pending Actions; Exception Report; Approval Trail; Supplier Price Changes; Direct-to-Workspace; Supplier Directory |
| Financial Manager | Procurement Status Summary; LPO Register; GRN Register; Pending Actions; Exception Report; Approval Trail; Management Summary |
| General Manager | Management Summary; Procurement Status Summary; LPO Register; GRN Register; Stock Valuation; Stock Consumption; Pending Actions; Exception Report; Approval Trail |
| Receiving Clerk | LPO Register; GRN Register; Pending Actions; Exception Report; Direct-to-Workspace |
| System Administrator | Full report catalogue, including User Activity and Daily Crucial Activities |

## Scope controls

- Requesters see their own department requests and related stock issues.
- Department Heads see their own department within their branch.
- Store Keepers see reports for their active assigned stores.
- Other operational roles are limited to the branch/property attached to their employee profile.
- System Administrators can report across permitted properties and may select a property scope.
- Backend report endpoints repeat these restrictions even when a user changes URL/query parameters manually.

## Report workspace

The Reports screen is a professional searchable table. Every visible row opens a full report view with appropriate filters, pagination, record drill-down where supported, and downloads in:

- PDF
- Excel-compatible XLS
- CSV

PDF exports use A4 landscape and include the report title, user, role, scope, generation timestamp, criteria and record count.

## Controlled LPO copies

The LPO Register does not create a second copy-control mechanism. It uses the existing LPO print records and shows the next controlled output for each LPO:

- no controlled print yet -> `ORIGINAL COPY`
- one or more controlled prints already recorded -> `COPY OF ORIGINAL`

The report itself is an internal report and is not marked as an Original Copy. To produce the controlled procurement document, the user opens the LPO from the report and uses the existing LPO print/download action. That existing action remains responsible for recording the print and issuing the correct Original/Copy classification.

## GRN reporting

The GRN Register shows receipt state and posting state separately and links back to the source GRN. The previously approved A4 landscape GRN source-document layout is unchanged.

## Production note

No automated test suite was run for this release, in accordance with the requested packaging approach. Validation was limited to backend Python syntax compilation, frontend TypeScript/Vite production build, login-screen hash comparison, and final ZIP integrity checking.
