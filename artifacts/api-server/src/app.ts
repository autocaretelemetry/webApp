import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import path from "node:path";
import fs from "node:fs";
import router from "./routes";
import { logger } from "./lib/logger";
import { attachUser } from "./lib/auth";

/**
 * Locate the built web app (`artifacts/autocare/dist/public`) so a single Node
 * service (e.g. a Render Web Service) can serve both the API and the web UI
 * from one origin. Returns null when no build is present — which is the case in
 * Replit dev, where the web app runs on its own Vite server and is reached
 * through the shared proxy, so the API never needs to serve static files.
 */
function resolveWebDistDir(): string | null {
  const envDir = process.env["WEB_DIST_DIR"];
  const candidates = [
    ...(envDir ? [envDir] : []),
    // cwd = artifacts/api-server (pnpm --filter ... run start)
    path.resolve(process.cwd(), "../autocare/dist/public"),
    // cwd = repo root
    path.resolve(process.cwd(), "artifacts/autocare/dist/public"),
    path.resolve(process.cwd(), "dist/public"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "index.html"))) {
      return dir;
    }
  }
  return null;
}

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(attachUser);

app.use("/api", router);

// Single-service web serving. When a web build is present and we're not in
// Replit dev (where the Vite server owns the web origin), serve the SPA so one
// Node service answers both /api and the UI from the same origin. Same-origin
// means no CORS / cross-site-cookie work is required.
if (process.env["NODE_ENV"] !== "development") {
  const webDistDir = resolveWebDistDir();
  if (webDistDir) {
    logger.info({ webDistDir }, "Serving static web build (single-service mode)");
    app.use(express.static(webDistDir));
    // SPA fallback: any non-/api GET that didn't match a static file gets the
    // app shell so client-side routing works on hard refresh / deep links.
    app.use((req, res, next) => {
      // Skip non-GET and anything under the /api segment (segment-aware +
      // case-insensitive so SPA routes like /apiary aren't falsely matched).
      if (req.method !== "GET" || /^\/api(?:\/|$)/i.test(req.path)) {
        next();
        return;
      }
      res.sendFile(path.join(webDistDir, "index.html"));
    });
  }
}

export default app;
