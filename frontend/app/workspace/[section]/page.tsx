import ClientApplication from '../../client-application'

/**
 * All recognized workspace paths reuse the existing authenticated application
 * during incremental App Router migration. AppContext validates role access.
 */
export default function WorkspacePage() {
  return <ClientApplication />
}
