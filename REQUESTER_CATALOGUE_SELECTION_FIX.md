# Requester Catalogue Selection Fix

The Requester requisition editor uses the catalogue hierarchy:

**Major Group -> Item Group -> Item**

The Requester role previously had read access to Items and Units of Measure but not Categories.
Because the frontend loads Major Groups and Item Groups from the Categories endpoint, the endpoint returned 403 and the dropdowns appeared empty.

This release adds **read-only `inventory.view_category`** to the Requester role. It does not grant category creation/edit/delete access and does not expose supplier quotations or prices.

The requester selector also now ignores inactive catalogue groups and sorts Major Groups, Item Groups and Items alphabetically.

On Vercel, `vercel_build.sh` runs `setup_hotel_roles`, so the corrected permission is synchronized automatically on deployment. For another deployment method, run:

```bash
python manage.py setup_hotel_roles
```

Then the Requester should sign out and sign back in (or refresh the session) so the permission list is reloaded.
