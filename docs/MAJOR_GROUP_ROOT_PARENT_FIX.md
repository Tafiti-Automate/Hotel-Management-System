# Root Major Group creation: GUEST SUPPLIES regression (2026-11-19)

## Report
Client screenshot from Cost Control / admin/article-groups: "New Major Group"
was submitted with name GUEST SUPPLIES and description GUEST AMENITIES.
The API responded with "Choose a major group as the parent", a validation
message that should only be possible for a third-level category.

## Confirmed cause
The frontend shared `findDataId` treated an empty string as a valid
lookup, and compared that empty string to optional, absent properties
such as `category.abbr`. Most category records have no `abbr`.
Therefore `findDataId(data, 'categories', '')` returned the first
category ID rather than an empty value. A root-level Major Group POST
was silently assigned a random parent. If that category happened to
be an Item Group, the backend correctly rejected the third level.

## Corrected behaviour
- Blank, null, undefined or whitespace-only references resolve to
  **no ID**, never to an existing record.
- New Major Group is sent with `parent: null`.
- New Item Group requires a real, root-level Major Group. Unknown,
  child-level, or mistyped parent selections fail early.
- The Major Group form resets hidden parent state explicitly.
- Frontend executable regression tests cover the exact GUEST SUPPLIES
  case with existing Item Groups and parent lookup safety.
- Django API test covers the same operation with an established hierarchy.

This is a frontend record-ID resolution bug, NOT evidence that the Cost
Controller lacked permission. No existing catalogue data is rewritten.
