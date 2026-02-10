import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./use-auth";

interface TradingModeData {
  tradingMode: string;
  hasKucoinKeys: boolean;
}

interface KucoinBalanceData {
  balance: number;
}

export function useDemoRealMode() {
  const { user } = useAuth();

  const { data: tradingModeData } = useQuery<TradingModeData>({
    queryKey: ["/api/user/trading-mode"],
    enabled: !!user,
  });

  const isRealMode = tradingModeData?.tradingMode === "real";

  const { data: kucoinBalanceData } = useQuery<KucoinBalanceData>({
    queryKey: ["/api/kucoin/balance"],
    enabled: isRealMode && tradingModeData?.hasKucoinKeys === true,
    refetchInterval: 15000,
  });

  const effectiveBalance = isRealMode && kucoinBalanceData?.balance !== undefined
    ? kucoinBalanceData.balance
    : Number(user?.balance ?? 0);

  return {
    isRealMode,
    effectiveBalance,
    tradingMode: tradingModeData?.tradingMode || "demo",
    hasKucoinKeys: tradingModeData?.hasKucoinKeys || false,
    kucoinBalance: kucoinBalanceData?.balance,
  };
}
