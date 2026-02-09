import { useEffect, useRef, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

interface TickerData {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
}

export function useBinanceWebSocket() {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const mountedRef = useRef(true);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevPricesRef = useRef<Map<string, number>>(new Map());
  const [priceFlashes, setPriceFlashes] = useState<Map<string, "up" | "down">>(new Map());

  const updateTickers = useCallback((tickers: TickerData[]) => {
    const newFlashes = new Map<string, "up" | "down">();

    tickers.forEach(t => {
      const newPrice = parseFloat(t.lastPrice);
      const prevPrice = prevPricesRef.current.get(t.symbol);
      if (prevPrice !== undefined && prevPrice !== newPrice) {
        newFlashes.set(t.symbol, newPrice > prevPrice ? "up" : "down");
      }
      prevPricesRef.current.set(t.symbol, newPrice);
    });

    if (newFlashes.size > 0) {
      setPriceFlashes(new Map(newFlashes));
      setTimeout(() => {
        if (mountedRef.current) setPriceFlashes(new Map());
      }, 600);
    }

    queryClient.setQueryData(["/api/market/tickers"], tickers);
  }, [queryClient]);

  const connect = useCallback(() => {
    if (!mountedRef.current || wsRef.current) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/market`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) { ws.close(); return; }
        console.log("[Market WS] Connected");
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === "status") {
            setConnected(msg.connected);
            return;
          }

          if (msg.type === "tickers" && Array.isArray(msg.data)) {
            setConnected(true);
            updateTickers(msg.data);
          }
        } catch {}
      };

      ws.onerror = () => {
        console.log("[Market WS] Error");
      };

      ws.onclose = () => {
        console.log("[Market WS] Closed");
        wsRef.current = null;
        if (mountedRef.current) {
          setConnected(false);
          reconnectTimerRef.current = setTimeout(() => {
            if (mountedRef.current) connect();
          }, 2000);
        }
      };
    } catch {
      wsRef.current = null;
      setConnected(false);
    }
  }, [updateTickers]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        try { wsRef.current.close(); } catch {}
        wsRef.current = null;
      }
    };
  }, [connect]);

  return { connected, priceFlashes };
}
