"use client";

import { createContext, useContext, useEffect, useMemo, useReducer, useState, type ReactNode } from "react";
import { io } from "socket.io-client";
import { SOCKET_URL } from "./api";
import { useAuth } from "./auth-context";
import { initialScanEventsState, scanEventsReducer, type ScanEventsState } from "./scan-events-reducer";
import type { BatchProgress, ScanProgress } from "./types";

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

interface ScanEventsContextValue extends ScanEventsState {
  connection: ConnectionStatus;
  clearFinished: () => void;
}

const ScanEventsContext = createContext<ScanEventsContextValue | null>(null);

/**
 * One Socket.IO connection for the whole app (namespace /scans), opened only while logged in.
 * The JWT goes in the handshake; the server refuses the connection without a valid one.
 */
export function ScanEventsProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [state, dispatch] = useReducer(scanEventsReducer, initialScanEventsState);
  // Status is remembered per token; a new token starts as "connecting" without an extra state update.
  const [status, setStatus] = useState<{ token: string | null; value: ConnectionStatus }>({ token: null, value: "disconnected" });
  const connection: ConnectionStatus = !token ? "disconnected" : status.token === token ? status.value : "connecting";

  useEffect(() => {
    if (!token) return;
    const socket = io(`${SOCKET_URL}/scans`, { auth: { token }, transports: ["websocket"] });
    const set = (value: ConnectionStatus) => setStatus({ token, value });

    socket.on("connect", () => set("connected"));
    socket.on("disconnect", () => set("disconnected"));
    socket.on("connect_error", () => set("error")); // socket.io keeps retrying by itself
    socket.on("scan.progress", (payload: ScanProgress) => dispatch({ type: "scan.progress", payload }));
    socket.on("batch.progress", (payload: BatchProgress) => dispatch({ type: "batch.progress", payload }));

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [token]);

  const value = useMemo<ScanEventsContextValue>(
    () => ({ ...state, connection, clearFinished: () => dispatch({ type: "clear-finished" }) }),
    [state, connection],
  );

  return <ScanEventsContext.Provider value={value}>{children}</ScanEventsContext.Provider>;
}

export function useScanEvents(): ScanEventsContextValue {
  const value = useContext(ScanEventsContext);
  if (!value) throw new Error("useScanEvents must be used inside <ScanEventsProvider>");
  return value;
}
