# Cost Control: Major Group and Item Group creation

## Report
A Cost Controller user reported that creating Major Groups and Item Groups
under Cost Control was not working. Code audit revealed a role-grant drift:
the catalogue UI allowed the canonical Cost Controller role to create groups
but the backend category API separately demanded the Django add/change
permission. In deployments where the role membership exists but the group
permission template has not been applied, Save was blocked.

## Repair
- Category endpoints now accept the *server-verified* Cost Controller or System
  Administrator role as master-data authority even when the stored permission
  list is stale. Other employees can only read groups with view_category
  permission; creating/updating/deleting groups is still role restricted.
- Cost Controller category navigation no longer redirects away solely because
  the view_category permission template is out of sync.
- Major Group and Item Group actions remain separate, and the Item Group
  form automatically chooses its parent when exactly one Major Group exists.
- Added a visible entry from the Articles page to the group setup screen.
- Form validates required names and duplicate names before submitting. Backend
  continues to enforce hierarchy, unique names and auto-generated group codes.

## Operational acceptance
Sign in with an account assigned to the Cost Controller group, open
**Cost Control → Master data → Major & Item Groups**, create a Major Group,
then create an Item Group under it. Refresh and confirm both appear in the tree.
An employee assigned *only* Store Keeper must not be able to alter groups.
This does not create any production users or alter any employee's role
assignment. If a particular user is not in the Cost Controller group, the
System Administrator must correct that user assignment.

The entire backend regression and frontend check suite should pass prior
to reporting the correction as validated.
