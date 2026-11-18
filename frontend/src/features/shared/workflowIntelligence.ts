/**
 * Presentation-only workflow guidance. Django remains the authority for
 * role permissions, invoice matching, stock movements and financial posting.
 * Never automatically execute an approval, posting, or bank operation.
 */
export type WorkflowRecord = { status?: unknown; [key: string]: unknown }
export type WorkflowDomain = 'purchase_order' | 'goods_receipt' | 'supplier_invoice' | 'supplier_payment' | 'stock_issue' | 'stock_adjustment'
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
    case 'goods_receipt':
      if (action === 'post') {
        if (current === 'posted') return blocked('This GRN is already posted.', 'Open the posted GRN or stock ledger instead.')
        if (current !== 'inspected' && current !== 'approved')
          return blocked('The goods must be counted, saved and inspected before posting.',
            'Complete the Receiving Clerk count and inspection, then confirm accepted quantities.')
        return ready('The inspected GRN may be posted after server validation.')
      }
      break
    case 'supplier_invoice':
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
    case 'stock_issue':
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
