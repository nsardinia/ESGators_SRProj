import { getAuth } from "firebase/auth"
import { firebaseApp } from "./firebase-core"

const auth = firebaseApp ? getAuth(firebaseApp) : null

export { auth }
