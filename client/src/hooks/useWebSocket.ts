import { useEffect, useRef, useCallback, useState } from "react";
import { io, Socket } from "socket.io-client";

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
  timestamp?: string;
}

export function useWebSocket() {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [hasEverConnected, setHasEverConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [fallbackToPolling, setFallbackToPolling] = useState(false);
  const [cacheWarmingProgress, setCacheWarmingProgress] = useState<CacheWarmingEvent | null>(null);

  useEffect(() => {
    // Initialize socket connection
    const socket = io(window.location.origin, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
    });

    socket.on("connect", () => {
      console.log("[WebSocket] Connected:", socket.id);
      setIsConnected(true);
      setIsReconnecting(false);
      setFallbackToPolling(false);
      setHasEverConnected(true);
      // Subscribe to cache warming progress
      socket.emit("subscribe:cache-warming");
    });

    socket.on("disconnect", () => {
      console.log("[WebSocket] Disconnected");
      setIsConnected(false);
      setIsReconnecting(true);
    });

    // Manager-level events for reconnection lifecycle
    socket.io.on("reconnect_failed", () => {
      console.warn("[WebSocket] Reconnect failed, falling back to polling");
      setIsReconnecting(false);
      setFallbackToPolling(true);
    });

    socket.io.on("reconnect", () => {
      console.log("[WebSocket] Reconnected via manager");
      setIsReconnecting(false);
      setFallbackToPolling(false);
    });

    socket.on("cache-warming:progress", (event: CacheWarmingEvent) => {
      setCacheWarmingProgress(event);
    });

    socket.on("error", (error) => {
      console.error("[WebSocket] Error:", error);
    });

    socketRef.current = socket;

    return () => {
      if (socketRef.current) {
        socketRef.current.emit("unsubscribe:cache-warming");
        socketRef.current.disconnect();
      }
    };
  }, []);

  const subscribe = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.emit("subscribe:cache-warming");
    }
  }, []);

  const unsubscribe = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.emit("unsubscribe:cache-warming");
    }
  }, []);

  return {
    isConnected,
    hasEverConnected,
    isReconnecting,
    fallbackToPolling,
    cacheWarmingProgress,
    subscribe,
    unsubscribe,
  };
}
