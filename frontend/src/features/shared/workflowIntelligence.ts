/**
 * Presentation-only workflow guidance. Django remains the authority for
 * role permissions, invoice matching, stock movements and financial posting.
 * Never automatically execute an approval, posting, or bank operation.
 */
export type WorkflowRecord = { status?: unknown; [key: string]: unknown }
export type WorkflowDomain = 'purchase_order' | 'goods_receipt' | 'supplier_invoice' | 'supplier_payment' | 'stock_issue' | 'stock_adjustment' | 'store_requisition' | 'supplier_return' | 'department_return' | 'stock_count'
export type WorkflowDecision = {
  allowed: boolean
  message: string
  next: string
}
const status = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/[ -]/g, '_')
const ready = (message: string): WorkflowDecision => ({ allowed: true, message, next: '' })
const blocked = (message: string, next: string): WorkflowDecision => ({ allowed: false, message, next })

export function explainWorkflowAction(domain: WorkflowDomain, record: WorkflowRecord | null | undefined, action: string): WorkflowDecision {
  if (!record) return blocked('Select a document before continuing.', 'Select the relevant document from the list.')
  const current = status(record.status)
  switch (domain) {
    case 'purchase_order':
      if (action === 'issue') {
        if (current === 'approved') return ready('The approved LPO may be issued to the supplier.')
        return blocked('The LPO cannot be issued before the required approvals are complete.',
          current === 'draft' ? 'Submit the LPO for Level 1 Procurement Manager approval.' :
          'Open the approval history and identify the outstanding approval.')
      }
      if (action === 'submit') {
        if (current === 'draft') return ready('The draft LPO may be submitted for approval.')
        return blocked('Only draft LPOs can be submitted.', 'Review the current approval stage and act from its queue.')
      }
      break
    case 'store_requisition':
      if (action === 'submit') {
        if (current === 'draft') return ready('The requisition may be submitted after confirming quantities and store.')
        return blocked('Only draft requisitions may be submitted.', 'Review the current approval stage, or open a new draft.')
      }
      if (action === 'department_approve') {
        if (current === 'submitted') return ready('The Department Head may review the submitted request.')
        return blocked('Department approval requires a submitted requisition.', 'Ask the originating department to submit its draft.')
      }
      if (action === 'dispatch') {
        if (['approved', 'partially_approved', 'partially_issued'].includes(current)) return ready('The Storekeeper may pick approved outstanding quantities.')
        return blocked('Stock cannot be dispatched against an unapproved requisition.', 'Resolve outstanding department and Stores approvals.')
      }
      break
    case 'goods_receipt':
      if (action === 'receive') {
        if (['issued', 'partially_received'].includes(current)) return ready('Blind receiving is available for an issued LPO.')
        return blocked('Receiving requires an issued LPO.', 'Ask Procurement to complete LPO approval and issue it to the supplier.')
      }
      if (action === 'post') {
        if (current === 'posted') return blocked('This GRN is already posted.', 'Open the posted GRN or stock ledger instead.')
        if (current !== 'inspected' && current !== 'approved')
          return blocked('The goods must be counted, saved and inspected before posting.',
            'Complete the Receiving Clerk count and inspection, then confirm accepted quantities.')
        return ready('The inspected GRN may be posted after server validation.')
      }
      break
    case 'supplier_invoice':
      if (action === 'match') {
        if (['draft', 'exception'].includes(current)) return ready('Matching checks the LPO, accepted GRN and invoice on the server.')
        return blocked('Only draft or exception invoices can be matched again.', 'Review the locked invoice evidence or approval history.')
      }
      if (action === 'approve') {
        if (current === 'matched') return ready('The invoice can be sent for approval.')
        return blocked('This invoice cannot be approved until the LPO, accepted GRN and invoice match.',
          'Open three-way matching and resolve any quantity, price or receipt exception.')
      }
      break
    case 'supplier_payment':
      if (action === 'submit') {
        if (current === 'draft') return ready('The draft payment instruction can be submitted.')
        return blocked('Only a draft payment instruction may be submitted.',
          'Open the payment history to review its current status.')
      }
      if (action === 'authorize') {
        if (current === 'submitted') return ready('This instruction awaits independent Financial Manager authorization.')
        return blocked('The payment must first be submitted by Accounts Payable.',
          'Ask the preparing Accounts Payable Clerk to submit the draft payment instruction.')
      }
      if (action === 'release') {
        if (current === 'approved') return ready('This authorized instruction can be released for external execution. It is not paid yet.')
        return blocked('The payment cannot be released before independent Finance approval.',
          'Request Financial Manager authorization first.')
      }
      if (action === 'settle') return blocked(
        'Release does not prove that the supplier received funds.',
        'Obtain verified external bank settlement evidence and reconcile the transaction.')
      break
    case 'supplier_return':
      if (action === 'apply') {
        if (current === 'draft' && !record.inventory_changes_applied) return ready('Unposted supplier return lines can be dispatched after the server verifies original receipts and stock.')
        return blocked('This supplier return cannot be posted again.', 'Select a draft supplier return and complete its article lines.')
      }
      if (action === 'acknowledge') {
        if (current === 'posted' && !record.supplier_acknowledged_at) return ready('Record supplier acknowledgement for the dispatched return.')
        return blocked('Acknowledgement requires a posted return and cannot be duplicated.', 'Dispatch goods first, or open the existing acknowledgement.')
      }
      break
    case 'department_return':
      if (action === 'apply') {
        if (!record.inventory_changes_applied) return ready('Unposted departmental returns require signed issue evidence and quantities.')
        return blocked('This department return has already been posted.', 'Open its printed return note and inventory ledger.')
      }
      break
    case 'stock_count':
      if (action === 'submit') {
        if (['draft', 'in_progress'].includes(current)) return ready('Sync physical counts before submitting for review.')
        return blocked('The physical count is locked after submission.', 'Open the review or variance report.')
      }
      if (action === 'approve') {
        if (current === 'submitted') return ready('An independent reviewer may approve the submitted count.')
        return blocked('Stocktake approval requires submitted physical counts.', 'Finish and submit the blind count sheet.')
      }
      if (action === 'apply') {
        if (current === 'approved' && !record.inventory_changes_applied) return ready('Apply an approved stocktake after final server checks.')
        return blocked('Stock variances require approval and cannot post twice.', 'Obtain independent approval or inspect the completed ledger.')
      }
      break
    case 'stock_issue':
      if (action === 'dispatch') {
        if (['approved', 'partially_approved', 'partially_issued'].includes(current)) return ready('Pick within approved outstanding stock and physical SOH.')
        return blocked('Only approved requests may be dispatched.', 'Complete department and Storekeeper approval.')
      }
      if (action === 'acknowledge') {
        if (current === 'in_transit') return ready('The department may sign the physical pickup after checking all articles.')
        return blocked('The Storekeeper must dispatch the posted stock before departmental pickup.',
          'Open the issue voucher and request Storekeeper dispatch.')
      }
      break
    case 'stock_adjustment':
      if (action === 'apply') {
        if (current === 'approved') return ready('A separately approved stock correction may be applied.')
        return blocked('A stock adjustment cannot change inventory before independent Finance approval.',
          'Submit the adjustment with a reason and obtain Financial Manager authorization.')
      }
  }
  return ready('This action will be validated against the live document and your permissions.')
}
