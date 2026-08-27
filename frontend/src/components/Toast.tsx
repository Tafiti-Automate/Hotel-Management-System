import { useApp } from '../state/AppContext'
import FeedbackDialog from './FeedbackDialog'

export default function Toast() {
  const app = useApp()
  if (!app.toast) return null

  return <FeedbackDialog
    tone="success"
    title={app.toast}
    message="The action was completed and saved successfully."
    onClose={app.closeToast}
  />
}
