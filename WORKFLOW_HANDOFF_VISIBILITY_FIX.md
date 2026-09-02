# Workflow Handoff Visibility Fix

## Scope

This update fixes queue-visibility defects without changing the procurement approval sequence.

The expected Store Keeper purchase flow remains:

Store Keeper → Procurement Officer / Procurement Manager → LPO Preparation → Purchasing Manager (Level 1) → Financial Manager (Level 2) → General Manager (Level 3) → Supplier → Receiving Clerk → GRN → Inventory Posting.

## Corrected defects

1. **Finance / General Management LPO scope**
   - Requisitions were visible to management at hotel level while LPOs were restricted to the manager's exact branch.
   - Finance and General Management LPO visibility is now hotel-wide, matching their management responsibility and requisition visibility.
   - Procurement remains branch-scoped.

2. **Approval role ambiguity**
   - Accounts retaining more than one management group could be routed to the first role detected by the server and receive the wrong approval queue.
   - The UI now sends the active approval role explicitly and the backend verifies that the user is entitled to that role.

3. **Duplicate approval-inbox dependency**
   - The Procurement Workbench loaded the authoritative combined workspace and then made a second approval-inbox request.
   - If the second request failed, the whole page could appear empty even though the workspace request succeeded.
   - The combined workspace is now authoritative; the standalone inbox is only a safe fallback.

4. **Requisition / LPO branch mismatch**
   - Procurement could previously see a requisition from a branch that would later be hidden from the same user after an LPO was created.
   - Requisition and LPO scoping now use the same operational rules.

5. **Management notifications**
   - Finance and GM notifications were tied to the originating branch.
   - They are now sent at hotel scope, while Procurement and Receiving notifications remain branch-scoped.

6. **Approval route readiness**
   - Purchasing Manager availability remains branch-specific.
   - Financial Manager and General Manager availability is validated at hotel level, so a central management role can approve requests originating from another branch of the same hotel.

## Important workflow rule

A Store Keeper purchase request is not a Finance decision immediately after creation. Finance receives an actionable record after Procurement prepares the LPO and Level 1 Purchasing Manager approval is completed. The source Store Purchase Request remains attached to that LPO for traceability.
