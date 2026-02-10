import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./use-auth";

interface TradingModeData {
  tradingMode: string;
  hasKrakenKeys: boolean;
}

interface KrakenBalanceData {
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

  const { data: krakenBalanceData } = useQuery<KrakenBalanceData>({
    queryKey: ["/api/kraken/balance"],
    enabled: isRealMode && tradingModeData?.hasKrakenKeys === true,
    refetchInterval: 15000,
  });

  const effectiveBalance = isRealMode && krakenBalanceData?.balance !== undefined
    ? krakenBalanceData.balance
    : Number(user?.balance ?? 0);

  return {
    isRealMode,
    effectiveBalance,
    tradingMode: tradingModeData?.tradingMode || "demo",
    hasKrakenKeys: tradingModeData?.hasKrakenKeys || false,
    krakenBalance: krakenBalanceData?.balance,
    krakenError: krakenBalanceData?.error,
  };
}
