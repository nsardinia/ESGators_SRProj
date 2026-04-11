import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath, URL } from "node:url"

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined
          }

          if (id.includes("react-map-gl") || id.includes("maplibre-gl")) {
            return "map-vendor"
          }

          if (id.includes("firebase/database")) {
            return "firebase-database-vendor"
          }

          if (id.includes("firebase/auth")) {
            return "firebase-auth-vendor"
          }

          if (id.includes("firebase/app")) {
            return "firebase-core-vendor"
          }

          if (id.includes("firebase")) {
            return "firebase-shared-vendor"
          }

          if (id.includes("react-router")) {
            return "router-vendor"
          }

          if (id.includes("react") || id.includes("scheduler")) {
            return "react-vendor"
          }

          return "vendor"
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/setupTests.js",
    globals: true,
  },
})
