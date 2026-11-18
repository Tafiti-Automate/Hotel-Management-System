import { explainWorkflowAction, type WorkflowDomain, type WorkflowRecord } from '../features/shared/workflowIntelligence'
import { Icon } from './Icon'

/**
 * Non-modal guidance for unavailable work. The Django mutation endpoint
 * remains authoritative for role, quantity, fiscal and state validation.
 */
export default function WorkflowPrerequisite({
  domain, record, action, label,
}: {
  domain: WorkflowDomain
  record: WorkflowRecord | null | undefined
  action: string
  label?: string
}) {
  const guidance = explainWorkflowAction(domain, record, action)
  if (guidance.allowed) return null
  return <div className="mc-workflow-prerequisite" role="status" aria-live="polite">
    <Icon name="info" size={17} />
    <div>
      <strong>{label || 'A previous step is required'}</strong>
      <p>{guidance.message}</p>
      <small>Next: {guidance.next}</small>
    </div>
  </div>
}
