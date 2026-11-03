import { useApp } from '../state/AppContext'
import FeedbackDialog from './FeedbackDialog'

export default function WorkflowAlert() {
  const app = useApp()
  const alert = app.workflowAlert
  if (!alert) return null

  const blockers = alert.message
    .replace(/[{}[\]"]/g, '')
    .split(/\n|(?<=\.)\s+|;\s*/)
    .map((item) => item.replace(/^[^:]+:\s*/, '').trim())
    .filter(Boolean)

  const [message, ...details] = blockers
  return <FeedbackDialog
    tone={alert.tone}
    title={alert.title}
    message={message || alert.message}
    details={details}
    onClose={app.closeWorkflowAlert}
  />
}
