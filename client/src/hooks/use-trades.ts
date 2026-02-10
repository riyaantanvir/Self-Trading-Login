import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export function useTickers() {
  return useQuery({
    queryKey: ["/api/market/tickers"],
    queryFn: async () => {
      const res = await fetch("/api/market/tickers", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch tickers");
      return await res.json();
    },
    refetchInterval: 5000,
  });
}

export function useTrades() {
  return useQuery({
    queryKey: ["/api/trades"],
    queryFn: async () => {
      const res = await fetch("/api/trades", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch trades");
      return await res.json();
    },
  });
}

export function usePortfolio() {
  return useQuery({
    queryKey: ["/api/portfolio"],
    queryFn: async () => {
      const res = await fetch("/api/portfolio", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch portfolio");
      return await res.json();
    },
  });
}

export function useCreateTrade() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: {
      symbol: string;
      type: string;
      quantity: number;
      price: number;
      orderType?: string;
      limitPrice?: number;
      stopPrice?: number;
    }) => {
      const res = await apiRequest("POST", "/api/trades", data);
      return await res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trades/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio/today-pnl"] });
      queryClient.setQueryData(["/api/user"], data.user);
      const isPending = data.trade.status === "pending";
      const orderLabel = (data.trade.orderType || "market").replace("_", " ");
      toast({
        title: isPending ? "Order Placed" : "Trade Executed",
        description: isPending
          ? `${orderLabel.toUpperCase()} ${data.trade.type.toUpperCase()} ${data.trade.quantity} ${data.trade.symbol} placed`
          : `${data.trade.type.toUpperCase()} ${data.trade.quantity} ${data.trade.symbol} at $${Number(data.trade.price).toLocaleString()}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Trade Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function usePendingOrders() {
  return useQuery({
    queryKey: ["/api/trades/pending"],
    queryFn: async () => {
      const res = await fetch("/api/trades/pending", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch pending orders");
      return await res.json();
    },
    refetchInterval: 3000,
  });
}

export function useCancelOrder() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (tradeId: number) => {
      const res = await apiRequest("DELETE", `/api/trades/${tradeId}`);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trades/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      toast({ title: "Order Cancelled" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to cancel order", description: error.message, variant: "destructive" });
    },
  });
}

export function useWatchlist() {
  return useQuery({
    queryKey: ["/api/watchlist"],
    queryFn: async () => {
      const res = await fetch("/api/watchlist", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch watchlist");
      return await res.json();
    },
  });
}

export function useAddToWatchlist() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (symbol: string) => {
      const res = await apiRequest("POST", "/api/watchlist", { symbol });
      return await res.json();
    },
    onSuccess: (_data, symbol) => {
      qc.invalidateQueries({ queryKey: ["/api/watchlist"] });
      toast({ title: "Added to Watchlist", description: `${symbol.replace("USDT", "")}/USDT added to your watchlist` });
    },
  });
}

export function useRemoveFromWatchlist() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (symbol: string) => {
      await apiRequest("DELETE", `/api/watchlist/${symbol}`);
    },
    onSuccess: (_data, symbol) => {
      qc.invalidateQueries({ queryKey: ["/api/watchlist"] });
      toast({ title: "Removed from Watchlist", description: `${symbol.replace("USDT", "")}/USDT removed from your watchlist` });
    },
  });
}

export function useAlerts() {
  return useQuery({
    queryKey: ["/api/alerts"],
    queryFn: async () => {
      const res = await fetch("/api/alerts", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch alerts");
      return await res.json();
    },
  });
}

export function useCreateAlert() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (data: { symbol: string; targetPrice: number; direction: string; notifyTelegram?: boolean; alertType?: string; indicator?: string; indicatorCondition?: string; chartInterval?: string }) => {
      const res = await apiRequest("POST", "/api/alerts", data);
      return await res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/alerts"] });
      const coin = data.symbol.replace("USDT", "");
      const desc = data.alertType === "indicator"
        ? `${coin}/USDT - ${data.indicator === "bollinger_bands" ? "Bollinger Band" : data.indicator} alert on ${data.chartInterval}`
        : `${coin}/USDT ${data.direction} $${Number(data.targetPrice).toLocaleString()}`;
      toast({
        title: "Alert Created",
        description: desc,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create alert", description: error.message, variant: "destructive" });
    },
  });
}

export function useDeleteAlert() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (alertId: number) => {
      await apiRequest("DELETE", `/api/alerts/${alertId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/alerts"] });
      toast({ title: "Alert Deleted" });
    },
  });
}

export function useSaveTelegramSettings() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (data: { telegramBotToken: string; telegramChatId: string }) => {
      const res = await apiRequest("POST", "/api/user/telegram", data);
      return await res.json();
    },
    onSuccess: (updatedUser) => {
      qc.setQueryData(["/api/user"], updatedUser);
      toast({ title: "Telegram Settings Saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save settings", description: error.message, variant: "destructive" });
    },
  });
}

export function useTestTelegram() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/user/telegram/test");
      return await res.json();
    },
    onSuccess: () => {
      toast({ title: "Test message sent!", description: "Check your Telegram for the test message." });
    },
    onError: (error: Error) => {
      toast({ title: "Test failed", description: error.message, variant: "destructive" });
    },
  });
}

export interface DailyPnlEntry {
  date: string;
  pnl: number;
  cumulative: number;
}

export interface PnlHistoryData {
  dailyPnl: DailyPnlEntry[];
  cumulativePnl: number;
  weeklyPnl: number;
  startingBalance: number;
}

export function usePnlHistory() {
  return useQuery({
    queryKey: ["/api/portfolio/pnl-history"],
    queryFn: async () => {
      const res = await fetch("/api/portfolio/pnl-history", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch PNL history");
      return await res.json() as PnlHistoryData;
    },
  });
}

export function useNewsAlerts() {
  return useQuery<{ enabled: boolean }>({
    queryKey: ["/api/user/news-alerts"],
    queryFn: async () => {
      const res = await fetch("/api/user/news-alerts", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch news alert settings");
      return await res.json();
    },
  });
}

export function useToggleNewsAlerts() {
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await apiRequest("POST", "/api/user/news-alerts", { enabled });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/news-alerts"] });
    },
  });
}

export function useSignalAlerts() {
  return useQuery<{ enabled: boolean }>({
    queryKey: ["/api/user/signal-alerts"],
    queryFn: async () => {
      const res = await fetch("/api/user/signal-alerts", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch signal alert settings");
      return await res.json();
    },
  });
}

export function useToggleSignalAlerts() {
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await apiRequest("POST", "/api/user/signal-alerts", { enabled });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/signal-alerts"] });
    },
  });
}

export function useTodayPnl() {
  return useQuery({
    queryKey: ["/api/portfolio/today-pnl"],
    queryFn: async () => {
      const res = await fetch("/api/portfolio/today-pnl", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch today PNL");
      return await res.json() as { totalPnl: number; perSymbol: Record<string, number>; startOfDayValue: number; currentValue: number; periodStart: string };
    },
    refetchInterval: 5000,
  });
}
