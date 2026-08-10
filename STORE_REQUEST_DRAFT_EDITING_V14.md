# Store Request Draft Editing v14

## Requester controls

- Draft request details can be corrected before submission.
- Required date and purpose can be updated and saved.
- Each draft line shows Edit and Remove actions.
- Editing preserves the original line and updates its requested quantity.
- Removing a line requires confirmation.
- An unsubmitted draft can be permanently deleted with confirmation.
- Submitted and processed requests remain read-only through the normal role workflow.

## Department identity

For employee operational workspaces, the employee's department name is displayed instead of the generic role name in:

- the top-left workspace title;
- the top-right user subtitle;
- the breadcrumb workspace label;
- the sidebar user summary.

Technical and administrative accounts without a department continue to show their role or module name.

## Validation

The frontend TypeScript and Vite production build passed successfully.
