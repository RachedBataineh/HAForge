"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@HAForge/ui/components/button";
import { env } from "@HAForge/env/web";

interface TerminalProps {
  serverId: string;
  serverIsOn?: boolean;
}

export default function Terminal({ serverId, serverIsOn }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<any>(null);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (xtermRef.current) {
      if ((xtermRef.current as any)._resizeHandler) {
        window.removeEventListener("resize", (xtermRef.current as any)._resizeHandler);
      }
      xtermRef.current.dispose();
      xtermRef.current = null;
    }
    fitAddonRef.current = null;
    setConnected(false);
  }, []);

  const connect = useCallback(async () => {
    if (!serverIsOn) return;

    // Wait for the div to be rendered
    await new Promise((r) => setTimeout(r, 50));
    if (!terminalRef.current) return;

    setLoading(true);
    setError(null);
    disconnect();

    try {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);

      // Inject xterm CSS once
      if (!document.getElementById("xterm-css")) {
        const link = document.createElement("link");
        link.id = "xterm-css";
        link.rel = "stylesheet";
        link.href = "https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css";
        document.head.appendChild(link);
      }

      const term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "Menlo, Monaco, 'Courier New', monospace",
        theme: {
          background: "#0d1117",
          foreground: "#c9d1d9",
          cursor: "#58a6ff",
          selectionBackground: "#264f78",
        },
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(terminalRef.current);

      // Wait for CSS + DOM to settle, then fit and snap container to exact row height
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      fitAddon.fit();

      // Snap container height to exact row multiple to prevent ghost lines
      const xtermEl = terminalRef.current.querySelector(".xterm-screen");
      if (xtermEl) {
        const renderedHeight = (xtermEl as HTMLElement).offsetHeight;
        terminalRef.current.style.height = `${renderedHeight}px`;
        fitAddon.fit();
      }

      xtermRef.current = term;
      fitAddonRef.current = fitAddon;

      const wsUrl = env.NEXT_PUBLIC_SERVER_URL.replace("http", "ws");
      const ws = new WebSocket(`${wsUrl}/ws/terminal?serverId=${serverId}`);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        const data = event.data;
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === "error") {
            setError(parsed.message);
            setLoading(false);
            return;
          }
          if (parsed.type === "connected") {
            setConnected(true);
            setLoading(false);
            requestAnimationFrame(() => requestAnimationFrame(() => fitAddon.fit()));
            return;
          }
        } catch {
          // Raw terminal data
          term.write(data);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        setLoading(false);
        if (xtermRef.current) {
          term.write("\r\n\x1b[33m--- Connection closed ---\x1b[0m\r\n");
        }
      };

      ws.onerror = () => {
        setError("Connection failed");
        setLoading(false);
      };

      term.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      const onResize = () => {
        if (fitAddonRef.current && xtermRef.current) {
          fitAddonRef.current.fit();
          const dims = fitAddonRef.current.proposeDimensions();
          if (dims && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
          }
        }
      };

      window.addEventListener("resize", onResize);
      (term as any)._resizeHandler = onResize;
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  }, [serverId, serverIsOn, disconnect]);

  // Auto-connect when mounted and server is on
  useEffect(() => {
    if (serverIsOn) {
      connect();
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  if (!serverIsOn) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Server must be running to use the terminal.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            {connected ? "Connected" : loading ? "Connecting..." : "Disconnected"}
          </span>
          {error && <span className="text-xs text-destructive ml-2">{error}</span>}
        </div>
        <div className="flex items-center gap-2">
          {!connected && !loading && (
            <Button variant="outline" size="sm" onClick={connect} disabled={!serverIsOn}>
              Reconnect
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { disconnect(); setError(null); }}
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      <div
        ref={terminalRef}
        className="overflow-hidden border bg-[#0d1117]"
        style={{ height: 400, padding: 0 }}
      />
    </div>
  );
}
