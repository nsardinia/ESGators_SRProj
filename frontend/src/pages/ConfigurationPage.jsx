import NodeNetwork from "../components/NodeNetwork"
import { useAuth } from "../components/AuthContext"
import useOwnedNodes from "../hooks/useOwnedNodes"

function ConfigurationPage() {
  const { user } = useAuth()
  const { createdNodes, error, loadingNodes, warning, owner } = useOwnedNodes(user)

  return (
    <section className="flex min-h-0 max-w-[940px] flex-1 flex-col">
      <p className="mb-[10px] pt-2 text-base font-bold uppercase tracking-[0.08em] text-[var(--muted)]">Configuration</p>

      {error && <p className="mb-[14px] text-[0.86rem] text-[#fca5a5]">{error}</p>}
      {!error && warning && <p className="mb-[14px] text-[0.86rem] text-[#f6d28b]">{warning}</p>}
      {loadingNodes && createdNodes.length === 0 && (
        <div className="mb-[14px] flex items-center justify-between gap-3 rounded-[10px] border border-[var(--border)] bg-[var(--bg-elevated)] px-[14px] py-3 text-[0.95rem] text-[var(--muted)]">
          <span>Loading your nodes...</span>
        </div>
      )}

      <NodeNetwork nodes={createdNodes} ownerFirebaseUid={owner?.firebase_uid || ""} />
    </section>
  )
}

export default ConfigurationPage
