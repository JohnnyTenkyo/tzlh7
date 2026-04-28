/**
 * WebSocket progress broadcaster for cache warming.
 * Uses Socket.IO to push real-time progress updates to connected clients.
 */
import type { Server as HttpServer } from "http";
import { Server as SocketIOServer } from "socket.io";

let io: SocketIOServer | null = null;

export function initSocketIO(httpServer: HttpServer) {
  io = new SocketIOServer(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    path: "/api/ws",
  });

  io.on("connection", (socket) => {
    console.log(`[WS] Client connected: ${socket.id}`);
    socket.on("disconnect", () => {
      console.log(`[WS] Client disconnected: ${socket.id}`);
    });
  });

  console.log("[WS] Socket.IO initialized on /api/ws");
  return io;
}

export interface CacheProgressEvent {
  type: "start" | "progress" | "done" | "error";
  total: number;
  completed: number;
  failed: number;
  currentSymbol?: string;
  currentSource?: string;
  message?: string;
  percent: number;
  hitRate?: number; // cache hit rate percentage
  apiCalls?: number;
  cacheHits?: number;
}

export function emitCacheProgress(event: CacheProgressEvent) {
  if (io) {
    io.emit("cache:progress", event);
  }
}

export function getIO() {
  return io;
}
