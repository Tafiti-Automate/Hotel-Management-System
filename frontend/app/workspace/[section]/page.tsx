import ClientApplication from '../../client-application'
import { authorizeWorkspace } from '../../../src/lib/serverSession'

export const dynamic = 'force-dynamic'

export default async function WorkspacePage({
  params,
}: { params: Promise<{ section: string }> }) {
  const { section } = await params
  await authorizeWorkspace('/workspace/' + section)
  return <ClientApplication />
}
