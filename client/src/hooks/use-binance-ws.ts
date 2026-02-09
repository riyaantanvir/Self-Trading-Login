import { useEffect, useRef, useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

interface TickerUpdate {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
}

const USDT_PAIRS = new Set([
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "XRPUSDT", "SOLUSDT",
  "ADAUSDT", "DOGEUSDT", "DOTUSDT", "TRXUSDT", "LINKUSDT",
  "AVAXUSDT", "UNIUSDT", "LTCUSDT", "ATOMUSDT", "ETCUSDT",
  "XLMUSDT", "NEARUSDT", "ALGOUSDT", "FILUSDT", "POLUSDT",
]);

export function useBinanceWebSocket() {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const directWsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [source, setSource] = useState<"none" | "relay" | "direct">("none");
  const mountedRef = useRef(true);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const relayRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMessageRef = useRef<number>(0);
  const healthCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const updateTickers = useCallback((updates: TickerUpdate[]) => {
    lastMessageRef.current = Date.now();
    queryClient.setQueryData(["/api/market/tickers"], (old: TickerUpdate[] | undefined) => {
      if (!old) return updates;
      const map = new Map(old.map(t => [t.symbol, t]));
      updates.forEach(u => map.set(u.symbol, u));
      return Array.from(map.values());
    });
  }, [queryClient]);

  const parseBinanceTickerArray = useCallback((data: any[]): TickerUpdate[] => {
    return data
      .filter((t: any) => USDT_PAIRS.has(t.s))
      .map((t: any) => ({
        symbol: t.s,
        lastPrice: t.c,
        priceChangePercent: t.P,
        highPrice: t.h,
        lowPrice: t.l,
        volume: t.v,
        quoteVolume: t.q,
      }));
  }, []);

  const cleanupDirect = useCallback(() => {
    if (directWsRef.current) {
      try { directWsRef.current.close(); } catch {}
      directWsRef.current = null;
    }
  }, []);

  const cleanupRelay = useCallback(() => {
    if (wsRef.current) {
      try { wsRef.current.close(); } catch {}
      wsRef.current = null;
    }
  }, []);

  const connectDirectToBinance = useCallback(() => {
    if (!mountedRef.current || directWsRef.current) return;

    try {
      const ws = new WebSocket("wss://testnet.binance.vision/stream?streams=!ticker@arr");
      directWsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) { ws.close(); return; }
        console.log("[Binance Direct WS] Connected");
        setConnected(true);
        setSource("direct");
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          const streamData = msg.data || msg;
          if (Array.isArray(streamData)) {
            const updates = parseBinanceTickerArray(streamData);
            if (updates.length > 0) {
              updateTickers(updates);
            }
          }
        } catch {}
      };

      ws.onerror = () => {
        console.log("[Binance Direct WS] Error");
        try { ws.close(); } catch {}
      };

      ws.onclose = () => {
        console.log("[Binance Direct WS] Closed");
        directWsRef.current = null;
        if (mountedRef.current) {
          setConnected(false);
          setSource("none");
          retryTimerRef.current = setTimeout(() => {
            if (mountedRef.current) connectDirectToBinance();
          }, 15000);
        }
      };
    } catch {
      directWsRef.current = null;
      setConnected(false);
      setSource("none");
    }
  }, [parseBinanceTickerArray, updateTickers]);

  const connectToRelay = useCallback(() => {
    if (!mountedRef.current || wsRef.current) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/market`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) { ws.close(); return; }
        console.log("[Market WS Relay] Connected");
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === "status") {
            if (msg.binanceConnected) {
              cleanupDirect();
              setConnected(true);
              setSource("relay");
            } else {
              connectDirectToBinance();
            }
            return;
          }

          const streamData = msg.data || msg;
          if (Array.isArray(streamData)) {
            const updates = parseBinanceTickerArray(streamData);
            if (updates.length > 0) {
              cleanupDirect();
              setConnected(true);
              setSource("relay");
              updateTickers(updates);
            }
          }
        } catch {}
      };

      ws.onerror = () => {
        console.log("[Market WS Relay] Error");
      };

      ws.onclose = () => {
        console.log("[Market WS Relay] Closed");
        wsRef.current = null;
        if (mountedRef.current) {
          setConnected(false);
          setSource("none");
          connectDirectToBinance();
          relayRetryRef.current = setTimeout(() => {
            if (mountedRef.current) connectToRelay();
          }, 30000);
        }
      };
    } catch {
      connectDirectToBinance();
    }
  }, [connectDirectToBinance, cleanupDirect, parseBinanceTickerArray, updateTickers]);

  useEffect(() => {
    mountedRef.current = true;
    connectToRelay();

    const directFallbackTimer = setTimeout(() => {
      if (mountedRef.current && !connected) {
        connectDirectToBinance();
      }
    }, 3000);

    healthCheckRef.current = setInterval(() => {
      if (!mountedRef.current) return;
      if (connected && lastMessageRef.current > 0) {
        const elapsed = Date.now() - lastMessageRef.current;
        if (elapsed > 30000) {
          console.log("[WS Health] No data for 30s, reconnecting...");
          setConnected(false);
          setSource("none");
          cleanupRelay();
          cleanupDirect();
          connectToRelay();
        }
      }
    }, 15000);

    return () => {
      mountedRef.current = false;
      clearTimeout(directFallbackTimer);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (relayRetryRef.current) clearTimeout(relayRetryRef.current);
      if (healthCheckRef.current) clearInterval(healthCheckRef.current);
      cleanupRelay();
      cleanupDirect();
    };
  }, []);

  return { connected, source };
}
