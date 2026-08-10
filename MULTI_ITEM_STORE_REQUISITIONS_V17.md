# Multi-item Store Requisitions v17

A Store Requisition remains one parent document and can contain any number of article lines from different inventory categories.

Each line preserves its own requested, approved, issued, outstanding and shortage state. Categories are displayed for operational clarity but do not split or restrict the request.

Requester behavior:
- Add multiple articles before submission.
- Add articles from different categories.
- Edit or remove any draft line.
- Duplicate article/unit lines are blocked; users edit the existing line instead.

Approver and Stores behavior:
- Review and decide each line independently.
- See the item category and line status.
- Parent status continues to reflect the aggregate request lifecycle.
