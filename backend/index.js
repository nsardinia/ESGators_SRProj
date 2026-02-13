require("dotenv").config()
const express = require("express")
const cors = require("cors")
const db = require("./firebase")   // ← 이거 있어야 함

const app = express()
app.use(cors())
app.use(express.json())

app.get("/", (req, res) => {
    res.send("ESG Backend Running")
})

app.get("/data", async (req, res) => {
    const snapshot = await db.ref("sensor_data").once("value")
    res.json(snapshot.val())
})

app.listen(5000, () => {
    console.log("Server running on port 5000")
})
