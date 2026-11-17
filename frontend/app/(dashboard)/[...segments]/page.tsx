import ClientApplication from '../../client-application'
import { authorizeWorkspace } from '../../../src/lib/serverSession'

export const dynamic = 'force-dynamic'

export default async function OperationalPage({
  params,
}: { params: Promise<{ segments: string[] }> }) {
  const { segments } = await params
  await authorizeWorkspace('/' + segments.join('/'))
  return <ClientApplication />
}
