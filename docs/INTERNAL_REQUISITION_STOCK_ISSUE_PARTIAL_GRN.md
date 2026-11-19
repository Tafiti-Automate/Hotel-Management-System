# Internal requisition search, valued dispatch, stock movements and partial GRNs

1. **Searchable source store and destination cost center**: Outlet Supervisor
   can search authorized branch issuing stores and their own assigned destination
   cost center. The backend checks the explicitly selected destination matches
   their employee assignment; selecting another department is never accepted.
2. **Issued valuation**: Storekeeper Transfer Dispatch reads the *committed*
   StockIssueItem.dispatched_unit_cost snapshots after dispatch and displays an
   internal valued transfer/issue voucher with per-Article unit cost, line value
   and total issued UGX. It does not calculate values from current WAC after
   dispatch. This cost readout is limited to Cost Control/Stores/Finance roles.
   Outlet pickup vouchers remain quantity-only per the role privacy boundary.
3. **Stock on Hand**: the table's movement column now reads
   "Issued / transferred" and reports cumulative *outgoing* ledger quantities
   from real store issues, physical-to-transit dispatches and store transfers.
   Pending reservations remain separately recorded and visible in the detail
   drawer; Available still equals physical SOH minus reserved.
4. **Partial receipts**: recording a GRN does not increase SOH until accepted
   quantities are verified and posted by Storekeeper. SOH shows a visible
   unposted GRN alert and navigates to the authorized posting queue. A partial
   4-of-10 LPO receipt must post 4, keep the LPO partially received and never
   silently post the remaining 6.

QA: test multiple stores with duplicate names across branch, destination
security rejection, quantity-only requester responses, valued Stores dispatch,
stock ledger outbound totals and partial GRN posting with open fiscal periods.
