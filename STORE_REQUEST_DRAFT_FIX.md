# Store Request Draft Continuation Fix

This update fixes the case where a Store Request is successfully created (`201 Created`) but the requester screen still shows “No draft requests”.

## Root causes fixed

1. Department Requesters cannot read the Stores master endpoint. The frontend incorrectly treated the resulting empty store list as proof that no branch records existed and filtered out valid requests.
2. Store Request status is formatted for display (`Draft`) while the editor compared it only to lowercase backend values (`draft`).
3. The editor selected requests using the displayed requisition number while item endpoints and workflow actions require the backend UUID.

The backend remains authoritative for requester, department, branch, and store assignment.
