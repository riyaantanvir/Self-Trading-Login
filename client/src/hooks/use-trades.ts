import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
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
    mutationFn: async (data: { symbol: string; type: string; quantity: number; price: number }) => {
      const res = await apiRequest("POST", "/api/trades", data);
      return await res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] });
      queryClient.setQueryData(["/api/user"], data.user);
      toast({
        title: "Trade Executed",
        description: `${data.trade.type.toUpperCase()} ${data.trade.quantity} ${data.trade.symbol} at $${Number(data.trade.price).toLocaleString()}`,
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
