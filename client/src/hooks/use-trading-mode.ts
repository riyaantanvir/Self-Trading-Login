import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./use-auth";

interface TradingModeData {
  tradingMode: string;
  hasBinanceKeys: boolean;
}

interface BinanceBalanceData {
  balance: number;
  error?: string;
}

export function useDemoRealMode() {
  const { user } = useAuth();

  const { data: tradingModeData } = useQuery<TradingModeData>({
    queryKey: ["/api/user/trading-mode"],
    enabled: !!user,
  });

  const isRealMode = tradingModeData?.tradingMode === "real";

  const { data: binanceBalanceData } = useQuery<BinanceBalanceData>({
    queryKey: ["/api/binance/balance"],
    enabled: isRealMode && tradingModeData?.hasBinanceKeys === true,
    refetchInterval: 15000,
  });

  const effectiveBalance = isRealMode && binanceBalanceData?.balance !== undefined
    ? binanceBalanceData.balance
    : Number(user?.balance ?? 0);

  return {
    isRealMode,
    effectiveBalance,
    tradingMode: tradingModeData?.tradingMode || "demo",
    hasBinanceKeys: tradingModeData?.hasBinanceKeys || false,
    binanceBalance: binanceBalanceData?.balance,
    binanceError: binanceBalanceData?.error,
  };
}
