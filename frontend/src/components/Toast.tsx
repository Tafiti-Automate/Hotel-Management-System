import { useApp } from '../state/AppContext'
import FeedbackDialog from './FeedbackDialog'

export default function Toast() {
  const app = useApp()
  if (!app.toast) return null

  return <FeedbackDialog tone="success" message={app.toast} onClose={app.closeToast} />
}
