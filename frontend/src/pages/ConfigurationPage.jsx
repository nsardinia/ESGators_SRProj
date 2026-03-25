import NodeNetwork from "../components/NodeNetwork"
import { useAuth } from "../components/AuthContext"
import useOwnedNodes from "../hooks/useOwnedNodes"

function ConfigurationPage() {
  const { user } = useAuth()
  const { createdNodes, error, loadingNodes } = useOwnedNodes(user)

  return (
    <section className="workspace-content configuration-page">
      <p className="page-kicker">Configuration</p>

      {error && <p className="auth-error configuration-error">{error}</p>}
      {loadingNodes && createdNodes.length === 0 && (
        <div className="node-search configuration-status">
          <span>Loading your nodes...</span>
        </div>
      )}

      <NodeNetwork nodes={createdNodes} />
    </section>
  )
}

export default ConfigurationPage
