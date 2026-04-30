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
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disconnect = useCallback(() => {
    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect();
      resizeObserverRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (xtermRef.current) {
      xtermRef.current.dispose();
      xtermRef.current = null;
    }
    fitAddonRef.current = null;
    setConnected(false);
  }, []);

  const sendResize = useCallback(() => {
    if (!fitAddonRef.current || !xtermRef.current || !wsRef.current) return;
    if (wsRef.current.readyState !== WebSocket.OPEN) return;
    try {
      fitAddonRef.current.fit();
      const dims = fitAddonRef.current.proposeDimensions();
      if (dims) {
        wsRef.current.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
      }
    } catch {
      // Terminal may be disposed during unmount
    }
  }, []);

  const connect = useCallback(async () => {
    if (!serverIsOn) return;

    // Wait for the container div to be in the DOM
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

      // Load xterm CSS (bundled at build time)
      // Use dynamic link injection to match xterm v6 CSS
      if (!document.getElementById("xterm-css")) {
        const link = document.createElement("link");
        link.id = "xterm-css";
        link.rel = "stylesheet";
        // Resolve from node_modules via Next.js static serving
        link.href = "https://cdn.jsdelivr.net/npm/@xterm/xterm@6.0.0/css/xterm.css";
        document.head.appendChild(link);
        // Wait for CSS to load before rendering
        await new Promise<void>((resolve) => {
          link.onload = () => resolve();
          link.onerror = () => resolve(); // Don't block on failure
        });
      }

      const term = new Terminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, Monaco, 'Courier New', monospace",
        fontWeight: "normal",
        fontWeightBold: "bold",
        theme: {
          background: "#0d1117",
          foreground: "#c9d1d9",
          cursor: "#58a6ff",
          cursorAccent: "#0d1117",
          selectionBackground: "#264f78",
          selectionForeground: "#ffffff",
          black: "#484f58",
          red: "#ff7b72",
          green: "#3fb950",
          yellow: "#d29922",
          blue: "#58a6ff",
          magenta: "#bc8cff",
          cyan: "#39c5cf",
          white: "#b1bac4",
          brightBlack: "#6e7681",
          brightRed: "#ffa198",
          brightGreen: "#56d364",
          brightYellow: "#e3b341",
          brightBlue: "#79c0ff",
          brightMagenta: "#d2a8ff",
          brightCyan: "#56d4dd",
          brightWhite: "#f0f6fc",
        },
        scrollback: 10_000,
        allowProposedApi: true,
        allowTransparency: false,
        scrollSensitivity: 1,
        convertEol: false,
        lineHeight: 1.2,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(terminalRef.current);

      xtermRef.current = term;
      fitAddonRef.current = fitAddon;

      // Initial fit after CSS + DOM settle
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      fitAddon.fit();

      // Watch container size changes (sidebar collapse, panel resize, etc.)
      const observer = new ResizeObserver(() => {
        sendResize();
      });
      observer.observe(terminalRef.current);
      resizeObserverRef.current = observer;

      // Connect WebSocket
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
            // Re-fit and send initial dimensions after connection
            requestAnimationFrame(() => {
              fitAddon.fit();
              sendResize();
            });
            return;
          }
        } catch {
          // Raw terminal data — write to xterm
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

      // Send typed input to server
      term.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      // Send terminal size changes to server
      term.onResize(({ cols, rows }) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols, rows }));
        }
      });
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  }, [serverId, serverIsOn, disconnect, sendResize]);

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
    <div className="flex flex-col gap-3">
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
        className="overflow-hidden rounded-md border border-border bg-[#0d1117]"
        style={{ height: "70vh", minHeight: 300, padding: 4 }}
      />
    </div>
  );
}
