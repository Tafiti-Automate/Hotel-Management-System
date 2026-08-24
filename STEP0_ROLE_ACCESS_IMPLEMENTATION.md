# Step 0 — Roles, Default Permissions, and Role-Based Navigation

Implemented for the client-approved procurement workflow.

## Predefined roles

- Requester
- Department Head
- Cost Controller
- Store Keeper
- Procurement Manager
- Financial Manager
- General Manager
- Receiving Clerk
- System Administrator

Role names are fixed workflow identities. Administrators may adjust the permission checkboxes for each role.

## Default permission behavior

- New or zero-permission predefined roles are automatically populated with their safe workflow defaults after `migrate`.
- Existing legacy role names are migrated to the canonical names and existing user assignments are preserved.
- Once an administrator customizes a non-empty role, later migrations do not overwrite that customization.
- `python manage.py setup_hotel_roles` is the explicit reset-to-client-defaults command.

## Legacy role mappings

Examples handled automatically:

- `COST CONTROLLER` → `Cost Controller`
- `STORE KEEPER` → `Store Keeper`
- `PROCUREMENT OFFICER` → `Procurement Manager`
- `FINANCIAL MANAGER` → `Financial Manager`
- `MANAGER` → `General Manager`
- `RECIVING CLARK` → `Receiving Clerk`
- `Department Requester` → `Requester`

## Access-management UI

The Roles page now:

- displays the real permission count for every role;
- provides an Adjust Permissions button;
- opens the existing module/permission checkbox editor;
- shows the role's current/default permissions as checked;
- permits checking or unchecking permissions;
- prevents renaming predefined workflow roles.

## Sidebar behavior

Default role permissions feed the existing role-aware route controls. Core workflow labels are role-specific:

- Requester → My requisitions
- Department Head → Department approvals
- Store Keeper → Store Keeper queue
- Procurement Manager → Procurement workbench
- Financial Manager → LPO finance approvals
- General Manager → Final LPO approvals
- Receiving Clerk → Receiving & GRN

Hard workflow boundaries remain in place so roles such as General Manager cannot enter the Department/Store Keeper request workflow simply because a low-level model permission is present.

## Deployment

After deploying this version, run:

```bash
python manage.py migrate
```

The new migration causes the post-migrate role bootstrap to populate new/empty predefined roles and migrate legacy names.

To intentionally restore every predefined role to the client's default permission template, run:

```bash
python manage.py setup_hotel_roles
```

After changing role assignments or applying the migration, users should sign out and sign back in so the frontend receives the updated role and permission list.

## Validation

- Python source compilation: PASS
- TypeScript (`tsc --noEmit`): PASS
- Vite production build: PASS
- Django runtime command was not executed in the artifact environment because Django is not installed globally there.
