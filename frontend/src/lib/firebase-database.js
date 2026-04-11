import { getDatabase } from "firebase/database"
import { firebaseApp } from "./firebase-core"

const database = firebaseApp ? getDatabase(firebaseApp) : null

export { database }
