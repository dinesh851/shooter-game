import { defineConfig } from "vite";

// The client lives in /client. We bind to 0.0.0.0 (host: true) so that other
// machines on the office LAN can open the dev server by IP during development.
export default defineConfig({
  root: "client",
  server: {
    host: true,
    port: 5173,
    // allow importing the /shared module that sits outside the client root
    fs: { allow: [".."] },
  },
  build: {
    outDir: "../dist/client",
    emptyOutDir: true,
  },
});
