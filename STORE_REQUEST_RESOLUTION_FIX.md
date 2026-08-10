# Store Request Resolution Fix

This build corrects the ordinary employee Store Request flow.

## Corrected behavior

- The frontend no longer decides whether an issuing store exists for ordinary employees.
- Requester, department, branch, and store are derived by the API from the authenticated employee profile.
- The request form no longer shows the misleading `No active store configured for your branch` message.
- Identity fields are hidden from ordinary employees and remain available only to authorized users creating requests on behalf of staff.
- Authentication responses now expose separate `user_id`, `employee_id`, `employee_code`, `branch_id`, and `department_id` values.
- Employees without an assigned branch receive a precise profile validation error.

## Validation

- Modified Python modules and regression tests pass Python syntax compilation.
- A frontend production build could not be executed in the container because its internal npm registry could not retrieve `yallist@3.1.1`. No generated dependencies are included in this archive.
