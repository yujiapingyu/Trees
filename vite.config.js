import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
const csp =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: http: https: teaching-file:; media-src 'self' blob: teaching-file:; connect-src 'self' teaching-file:; worker-src 'self' blob:";
export default defineConfig(({ command }) => ({
  base: "./",
  plugins: [
    react(),
    ...(command === "build"
      ? [
          {
            name: "desktop-content-policy",
            transformIndexHtml(html) {
              return html.replace(
                "<head>",
                `<head><meta http-equiv="Content-Security-Policy" content="${csp}">`,
              );
            },
          },
        ]
      : []),
  ],
  build: { chunkSizeWarningLimit: 1800 },
  server: { strictPort: true },
}));
