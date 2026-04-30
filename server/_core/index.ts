import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerStorageProxy } from "./storageProxy";
import { appRouter, handleDailyScanScheduled, handleDailyCacheScheduled } from "../routers";
import { createContext } from "./context";
import { sdk } from "./sdk";
import { serveStatic, setupVite } from "./vite";
import { initializeWebSocket } from "./websocket";
import { startCacheScheduler, initializeScheduledTasks } from "../cacheScheduler";
import { startMarketCapCronScheduler } from "../marketCapCronScheduler";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // Initialize WebSocket server for real-time cache warming progress
  initializeWebSocket(server);
  registerStorageProxy(app);
  // Scheduled task endpoint - called by Manus scheduled task agent
  app.post("/api/scheduled/daily-scan", async (req, res) => {
    try {
      let user: any = null;
      try {
        user = await sdk.authenticateRequest(req as any);
      } catch {
        if (process.env.NODE_ENV === "production") {
          res.status(401).json({ success: false, message: "Unauthorized" });
          return;
        }
      }
      const result = await handleDailyScanScheduled();
      res.json({ ...result, calledBy: user?.name || user?.openId || "anonymous" });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || "Internal error" });
    }
  });
  // Scheduled task endpoint - daily cache warming (called by Manus scheduled task agent)
  app.post("/api/scheduled/daily-cache", async (req, res) => {
    try {
      let user: any = null;
      try {
        user = await sdk.authenticateRequest(req as any);
      } catch {
        if (process.env.NODE_ENV === "production") {
          res.status(401).json({ success: false, message: "Unauthorized" });
          return;
        }
      }
      const result = await handleDailyCacheScheduled();
      res.json({ ...result, calledBy: user?.name || user?.openId || "anonymous" });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || "Internal error" });
    }
  });
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
  // Initialize and start the cache warming scheduler
  initializeScheduledTasks().then(() => {
    startCacheScheduler();
    console.log("[CacheScheduler] Scheduler started and initialized");
  }).catch(err => {
    console.error("[CacheScheduler] Failed to start scheduler:", err);
  });

  // Initialize and start the market cap update scheduler
  try {
    startMarketCapCronScheduler();
  } catch (err) {
    console.error("[MarketCapCron] Failed to start market cap scheduler:", err);
  }
}

startServer().catch(console.error);
