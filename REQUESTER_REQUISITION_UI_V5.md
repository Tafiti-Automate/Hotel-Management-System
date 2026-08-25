# Requester Requisition UI V5

## Scope

This revision changes only the Department Requester requisition experience and related wording. It does not add new procurement features or change the approved business workflow.

## Requester workflow

The requester now performs only these actions:

1. Open **My Requisitions**.
2. Click **New requisition**.
3. Select an Article.
4. Enter Quantity.
5. Review the automatically displayed UOM.
6. Optionally enter an item Note.
7. Click **Add**.
8. Repeat for additional items.
9. Edit or remove a line when necessary.
10. Click **Submit requisition**.

## Removed from the requester form

- Required date.
- Requisition-level purpose/reason.
- Separate "Save draft details" action.
- Duplicate "Add another item" actions.
- Large empty item table before the first item is added.
- Statements explaining that supplier and price information are hidden.
- Redundant local "My requisitions" tab inside the My Requisitions page.

The backend fields remain intact for compatibility, but these fields are not presented to the requester because they are not part of the confirmed client requirement.

## Multi-item behavior

Each requested item is displayed as a separate row with:

- Article
- Quantity
- UOM
- Optional Note
- Edit action
- Remove action

After an item is added, the entry row is cleared and is immediately ready for the next item.

## Draft behavior

Item additions and edits are saved when the user performs the action. An explicit "Save draft" button is therefore not shown. A draft can be reopened from My Requisitions and continued later.

## Submission

Submission is enabled only after at least one item exists. The backend continues to enforce the same request ownership, HOD approval and workflow controls.

## Requester list

The list now focuses on:

- Requisition number
- Date
- Item count / short item preview
- Progress
- Status

## Validation

Frontend production build executed successfully with:

```bash
npm run build
```

This completed both:

```bash
tsc -b
vite build
```

The Vite output contained only the existing chunk-size warning; there were no TypeScript or build errors.
