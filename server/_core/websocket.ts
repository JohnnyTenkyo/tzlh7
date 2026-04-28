/**
 * WebSocket server for real-time cache warming progress
 * 
 * Features:
 * - Real-time progress updates during cache warming
 * - Current stock symbol display
 * - Progress bar percentage
 * - Source statistics (success/failed)
 * - Error notifications
 */

import { Server as SocketIOServer, Socket } from "socket.io";
import { Server as HTTPServer } from "http";

export interface CacheWarmingEvent {
  type: "progress" | "complete" | "error" | "start";
  total: number;
  completed: number;
  skipped: number;
  current: string;
  percentage: number;
  currentSymbol?: string;
  sourceStats?: Record<string, { success: number; failed: number }>;
  error?: string;
  elapsed?: number;
  speed?: number;
}

let io: SocketIOServer | null = null;

export function initializeWebSocket(httpServer: HTTPServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    transports: ["websocket", "polling"],
  });

  io.on("connection", (socket: Socket) => {
    console.log(`[WebSocket] Client connected: ${socket.id}`);

    socket.on("disconnect", () => {
      console.log(`[WebSocket] Client disconnected: ${socket.id}`);
    });

    socket.on("subscribe:cache-warming", () => {
      socket.join("cache-warming");
      console.log(`[WebSocket] Client subscribed to cache-warming: ${socket.id}`);
    });

    socket.on("unsubscribe:cache-warming", () => {
      socket.leave("cache-warming");
      console.log(`[WebSocket] Client unsubscribed from cache-warming: ${socket.id}`);
    });
  });

  return io;
}

export function getWebSocketServer(): SocketIOServer | null {
  return io;
}

export function broadcastCacheWarmingProgress(event: CacheWarmingEvent): void {
  if (!io) {
    console.warn("[WebSocket] Server not initialized");
    return;
  }

  io.to("cache-warming").emit("cache-warming:progress", {
    ...event,
    timestamp: new Date().toISOString(),
  });
}

export function broadcastCacheWarmingStart(total: number): void {
  broadcastCacheWarmingProgress({
    type: "start",
    total,
    completed: 0,
    skipped: 0,
    current: "初始化...",
    percentage: 0,
  });
}

export function broadcastCacheWarmingComplete(
  total: number,
  completed: number,
  skipped: number,
  sourceStats: Record<string, { success: number; failed: number }>,
  elapsed: number
): void {
  const speed = elapsed > 0 ? completed / (elapsed / 1000) : 0;
  broadcastCacheWarmingProgress({
    type: "complete",
    total,
    completed,
    skipped,
    current: `完成: ${completed} 成功, ${total - completed - skipped} 失败, ${skipped} 跳过`,
    percentage: 100,
    sourceStats,
    elapsed: Math.round(elapsed / 1000),
    speed: parseFloat(speed.toFixed(1)),
  });
}

export function broadcastCacheWarmingError(error: string): void {
  broadcastCacheWarmingProgress({
    type: "error",
    total: 0,
    completed: 0,
    skipped: 0,
    current: `错误: ${error}`,
    percentage: 0,
    error,
  });
}
