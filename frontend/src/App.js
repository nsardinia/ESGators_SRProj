import axios from "axios"
import { useEffect, useState } from "react"

function App() {
  const [data, setData] = useState(null)

  useEffect(() => {
    axios.get("http://localhost:5000/data")
      .then(res => setData(res.data))
      .catch(err => console.error(err))
  }, [])

  return (
    <div style={{ padding: "40px" }}>
      <h1>ESGators Dashboard</h1>
      <h3>Realtime IoT Environmental Data</h3>

      <pre>
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  )
}

export default App
