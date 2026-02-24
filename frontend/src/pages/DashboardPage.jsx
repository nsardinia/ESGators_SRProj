import axios from "axios"
import { useEffect, useState } from "react"

function DashboardPage() {
  const [data, setData] = useState(null)

  useEffect(() => {
    axios.get("http://localhost:5000/data")
      .then(res => setData(res.data))
      .catch(err => console.error(err))
  }, [])

  return (
    <section className="workspace-content">
      <p className="page-kicker">Overview</p>
      <h1 className="page-title">ESGators Dashboard</h1>
      <h3 className="page-subtitle">Realtime IoT Environmental Data</h3>
      <div className="data-card">
        <p className="data-card-label">Live Payload</p>
        <pre className="data-json">
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
    </section>
  )
}

export default DashboardPage
