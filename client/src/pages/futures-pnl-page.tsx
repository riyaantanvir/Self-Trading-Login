import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useFuturesPnlHistory, useFuturesTodayPnl, type FuturesPnlHistoryData } from "@/hooks/use-trades";
import { useAuth } from "@/hooks/use-auth";
import { LayoutShell } from "@/components/layout-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft, ChevronLeft, ChevronRight, BarChart3, CalendarDays } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

type PeriodTab = "7D" | "30D" | "90D";
type ViewMode = "chart" | "calendar";

export default function FuturesPnlPage() {
  const { user } = useAuth();
  const { data: pnlHistory, isLoading: loadingHistory } = useFuturesPnlHistory();
  const { data: todayPnlData } = useFuturesTodayPnl();
  const [, navigate] = useLocation();
  const [period, setPeriod] = useState<PeriodTab>("7D");
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [dailyViewMode, setDailyViewMode] = useState<ViewMode>("calendar");

  const { data: futuresWalletData } = useQuery({
    queryKey: ["/api/futures/wallet"],
  });

  const todayPnl = todayPnlData?.totalPnl ?? 0;
  const currentValue = todayPnlData?.currentValue ?? (futuresWalletData as any)?.balance ?? 0;
  const todayPnlPercent = currentValue > 0 ? (todayPnl / currentValue) * 100 : 0;

  const weeklyPnl = pnlHistory?.weeklyPnl ?? 0;
  const cumulativePnl = pnlHistory?.cumulativePnl ?? 0;
  const weeklyPnlPercent = currentValue > 0 ? (weeklyPnl / currentValue) * 100 : 0;
  const cumulativePnlPercent = currentValue > 0 ? (cumulativePnl / currentValue) * 100 : 0;

  const periodDays = period === "7D" ? 7 : period === "30D" ? 30 : 90;

  const filteredDailyPnl = useMemo(() => {
    if (!pnlHistory?.dailyPnl) return [];
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - periodDays);
    const cutoffKey = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
    return pnlHistory.dailyPnl.filter((d) => d.date >= cutoffKey);
  }, [pnlHistory, periodDays]);

  const periodPnl = useMemo(() => {
    return filteredDailyPnl.reduce((sum, d) => sum + d.pnl, 0);
  }, [filteredDailyPnl]);

  const dailyPnlMap = useMemo(() => {
    const map: Record<string, number> = {};
    if (pnlHistory?.dailyPnl) {
      for (const d of pnlHistory.dailyPnl) {
        map[d.date] = d.pnl;
      }
    }
    return map;
  }, [pnlHistory]);

  const netWorthData = useMemo(() => {
    if (!pnlHistory?.dailyPnl || pnlHistory.dailyPnl.length === 0) return [];
    return filteredDailyPnl.map((d) => ({
      date: d.date,
      value: d.cumulative,
    }));
  }, [filteredDailyPnl]);

  const calendarDays = useMemo(() => {
    const { year, month } = calendarMonth;
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startOffset = firstDay.getDay();
    const totalDays = lastDay.getDate();

    const days: Array<{ day: number; dateKey: string } | null> = [];
    for (let i = 0; i < startOffset; i++) days.push(null);
    for (let d = 1; d <= totalDays; d++) {
      const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      days.push({ day: d, dateKey });
    }
    return days;
  }, [calendarMonth]);

  const monthLabel = `${calendarMonth.year}-${String(calendarMonth.month + 1).padStart(2, "0")}`;

  const profitChartData = useMemo(() => {
    if (filteredDailyPnl.length === 0) return [];
    const maxAbs = Math.max(...filteredDailyPnl.map((d) => Math.abs(d.pnl)), 1);
    return filteredDailyPnl.map((d) => ({
      ...d,
      heightPercent: Math.abs(d.pnl) / maxAbs * 100,
    }));
  }, [filteredDailyPnl]);

  const netWorthChartRange = useMemo(() => {
    if (netWorthData.length === 0) return { min: 0, max: 0 };
    const vals = netWorthData.map((d) => d.value);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const padding = (max - min) * 0.1 || 100;
    return { min: min - padding, max: max + padding };
  }, [netWorthData]);

  if (loadingHistory) {
    return (
      <LayoutShell>
        <div className="flex items-center justify-center h-[60vh]">
          <Loader2 className="w-10 h-10 animate-spin text-[#f0b90b]" />
        </div>
      </LayoutShell>
    );
  }

  function formatPnl(val: number) {
    const sign = val >= 0 ? "+" : "";
    return `${sign}$${Math.abs(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function formatPercent(val: number) {
    const sign = val >= 0 ? "+" : "";
    return `${sign}${val.toFixed(2)}%`;
  }

  const pnlColor = (val: number) => (val >= 0 ? "text-[#0ecb81]" : "text-[#f6465d]");

  return (
    <LayoutShell>
      <div className="px-3 py-3 md:p-6 max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-4">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => navigate("/assets")}
            data-testid="button-back-to-assets"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-xl font-bold text-foreground" data-testid="text-futures-pnl-title">Futures PNL Analysis</h1>
        </div>

        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm text-muted-foreground">Futures Account Value (USDT)</span>
            </div>
            <div className="flex items-baseline gap-2 mb-3 flex-wrap">
              <span className="text-2xl sm:text-3xl font-bold text-foreground font-mono" data-testid="text-futures-pnl-total-value">
                {currentValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <div className="text-sm text-muted-foreground mb-4">
              ~ ${currentValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>

            <div className="grid grid-cols-3 gap-2 sm:gap-4 border-t border-border pt-3">
              <div className="min-w-0">
                <div className="text-[10px] sm:text-xs text-muted-foreground mb-1 border-b border-dotted border-muted-foreground/30 pb-1 inline-block">Today</div>
                <div className={`text-xs sm:text-sm font-semibold font-mono ${pnlColor(todayPnl)}`} data-testid="text-futures-pnl-today-percent">
                  {formatPercent(todayPnlPercent)}
                </div>
                <div className={`text-[10px] sm:text-xs font-mono truncate ${pnlColor(todayPnl)}`}>
                  {formatPnl(todayPnl)}
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-[10px] sm:text-xs text-muted-foreground mb-1 border-b border-dotted border-muted-foreground/30 pb-1 inline-block">7D</div>
                <div className={`text-xs sm:text-sm font-semibold font-mono ${pnlColor(weeklyPnl)}`} data-testid="text-futures-pnl-7d-percent">
                  {formatPercent(weeklyPnlPercent)}
                </div>
                <div className={`text-[10px] sm:text-xs font-mono truncate ${pnlColor(weeklyPnl)}`}>
                  {formatPnl(weeklyPnl)}
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-[10px] sm:text-xs text-muted-foreground mb-1 border-b border-dotted border-muted-foreground/30 pb-1 inline-block">Cumulative</div>
                <div className={`text-xs sm:text-sm font-semibold font-mono ${pnlColor(cumulativePnl)}`} data-testid="text-futures-pnl-cumulative-percent">
                  {formatPercent(cumulativePnlPercent)}
                </div>
                <div className={`text-[10px] sm:text-xs font-mono truncate ${pnlColor(cumulativePnl)}`}>
                  {formatPnl(cumulativePnl)}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center gap-2 mb-4 border-b border-border pb-2">
          {(["7D", "30D", "90D"] as PeriodTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setPeriod(tab)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                period === tab
                  ? "bg-card text-foreground border border-border"
                  : "text-muted-foreground"
              }`}
              data-testid={`tab-futures-period-${tab}`}
            >
              {tab}
            </button>
          ))}
        </div>

        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="mb-1">
              <span className="text-base font-bold text-foreground">Cumulative PNL</span>
            </div>
            <div className="text-xs text-muted-foreground mb-2">{new Date().toISOString().split("T")[0]}</div>
            <div className={`text-xl font-bold font-mono mb-4 ${pnlColor(cumulativePnl)}`} data-testid="text-futures-cumulative-value">
              {formatPnl(cumulativePnl)}
            </div>

            {netWorthData.length > 1 ? (
              <div className="relative h-32" data-testid="chart-futures-cumulative">
                <div className="absolute left-0 top-0 text-[10px] text-muted-foreground font-mono">
                  {netWorthChartRange.max.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </div>
                <div className="absolute left-0 bottom-0 text-[10px] text-muted-foreground font-mono">
                  {netWorthChartRange.min.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </div>
                <svg
                  viewBox={`0 0 ${netWorthData.length - 1} 100`}
                  className="w-full h-full ml-12"
                  preserveAspectRatio="none"
                >
                  <defs>
                    <linearGradient id="futuresCumGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#F0B90B" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="#F0B90B" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path
                    d={netWorthData
                      .map((d, i) => {
                        const x = i;
                        const range = netWorthChartRange.max - netWorthChartRange.min;
                        const y = range > 0 ? 100 - ((d.value - netWorthChartRange.min) / range) * 100 : 50;
                        return `${i === 0 ? "M" : "L"} ${x} ${y}`;
                      })
                      .join(" ") + ` L ${netWorthData.length - 1} 100 L 0 100 Z`}
                    fill="url(#futuresCumGradient)"
                  />
                  <path
                    d={netWorthData
                      .map((d, i) => {
                        const x = i;
                        const range = netWorthChartRange.max - netWorthChartRange.min;
                        const y = range > 0 ? 100 - ((d.value - netWorthChartRange.min) / range) * 100 : 50;
                        return `${i === 0 ? "M" : "L"} ${x} ${y}`;
                      })
                      .join(" ")}
                    fill="none"
                    stroke="#F0B90B"
                    strokeWidth="1.5"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
                <div className="flex justify-between mt-1 text-[10px] text-muted-foreground font-mono ml-12">
                  <span>{netWorthData[0]?.date.slice(5)}</span>
                  <span>{netWorthData[netWorthData.length - 1]?.date.slice(5)}</span>
                </div>
              </div>
            ) : (
              <div className="h-32 flex items-center justify-center text-sm text-muted-foreground">
                Not enough data for chart
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-base font-bold text-foreground">Daily PNL</span>
              <div className="flex items-center gap-1">
                <Button
                  size="icon"
                  variant={dailyViewMode === "chart" ? "default" : "ghost"}
                  onClick={() => setDailyViewMode("chart")}
                  data-testid="button-futures-daily-chart-view"
                >
                  <BarChart3 className="w-4 h-4" />
                </Button>
                <Button
                  size="icon"
                  variant={dailyViewMode === "calendar" ? "default" : "ghost"}
                  onClick={() => setDailyViewMode("calendar")}
                  data-testid="button-futures-daily-calendar-view"
                >
                  <CalendarDays className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <div className="text-xs text-muted-foreground mb-2">{new Date().toISOString().split("T")[0]}</div>
            <div className={`text-xl font-bold font-mono mb-4 ${pnlColor(periodPnl)}`} data-testid="text-futures-period-pnl">
              {formatPnl(periodPnl)}
            </div>

            {dailyViewMode === "calendar" ? (
              <div>
                <div className="flex items-center justify-center gap-4 mb-3">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() =>
                      setCalendarMonth((prev) => {
                        const d = new Date(prev.year, prev.month - 1, 1);
                        return { year: d.getFullYear(), month: d.getMonth() };
                      })
                    }
                    data-testid="button-futures-prev-month"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <span className="text-sm font-medium text-foreground" data-testid="text-futures-calendar-month">
                    {monthLabel}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() =>
                      setCalendarMonth((prev) => {
                        const d = new Date(prev.year, prev.month + 1, 1);
                        return { year: d.getFullYear(), month: d.getMonth() };
                      })
                    }
                    data-testid="button-futures-next-month"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>

                <div className="grid grid-cols-7 gap-1 text-center mb-2">
                  {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                    <div key={i} className="text-xs text-muted-foreground font-medium py-1">
                      {d}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-1">
                  {calendarDays.map((cell, i) => {
                    if (!cell) return <div key={`empty-${i}`} className="aspect-square" />;
                    const dayPnl = dailyPnlMap[cell.dateKey];
                    const hasTrade = dayPnl !== undefined;
                    const isPositive = hasTrade && dayPnl >= 0;
                    const isNegative = hasTrade && dayPnl < 0;

                    return (
                      <div
                        key={cell.dateKey}
                        className={`aspect-square rounded-md flex flex-col items-center justify-center text-xs p-0.5 ${
                          hasTrade
                            ? isPositive
                              ? "bg-[#0ecb81]/15 border border-[#0ecb81]/30"
                              : "bg-[#f6465d]/15 border border-[#f6465d]/30"
                            : ""
                        }`}
                        data-testid={`futures-calendar-day-${cell.dateKey}`}
                      >
                        <span className={`font-medium ${hasTrade ? "text-foreground" : "text-muted-foreground"}`}>
                          {cell.day}
                        </span>
                        {hasTrade && (
                          <span
                            className={`text-[9px] font-mono leading-tight ${
                              isPositive ? "text-[#0ecb81]" : "text-[#f6465d]"
                            }`}
                          >
                            {isNegative ? "-" : "+"}${Math.abs(dayPnl).toFixed(2)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="space-y-1" data-testid="chart-futures-daily-bars">
                {profitChartData.length > 0 ? (
                  <div className="flex items-end gap-[2px] h-32">
                    {profitChartData.map((d) => (
                      <div
                        key={d.date}
                        className="flex-1 flex flex-col justify-end h-full"
                      >
                        <div
                          className={`w-full rounded-sm ${d.pnl >= 0 ? "bg-[#0ecb81]" : "bg-[#f6465d]"}`}
                          style={{ height: `${Math.max(d.heightPercent, 2)}%` }}
                          title={`${d.date}: ${formatPnl(d.pnl)}`}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="h-32 flex items-center justify-center text-sm text-muted-foreground">
                    No trade data for this period
                  </div>
                )}
                {profitChartData.length > 0 && (
                  <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
                    <span>{profitChartData[0]?.date.slice(5)}</span>
                    <span>{profitChartData[profitChartData.length - 1]?.date.slice(5)}</span>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="mb-1">
              <span className="text-base font-bold text-foreground">Profits</span>
            </div>
            <div className="text-xs text-muted-foreground mb-2">{new Date().toISOString().split("T")[0]}</div>
            <div className={`text-xl font-bold font-mono mb-4 ${pnlColor(periodPnl)}`} data-testid="text-futures-profits-value">
              {formatPnl(periodPnl)}
            </div>

            {profitChartData.length > 0 ? (
              <div data-testid="chart-futures-profits">
                <div className="flex items-end gap-[2px] h-24">
                  {profitChartData.map((d) => (
                    <div
                      key={d.date}
                      className="flex-1 flex flex-col justify-end h-full"
                    >
                      <div
                        className={`w-full rounded-sm ${d.pnl >= 0 ? "bg-[#F0B90B]" : "bg-[#f6465d]"}`}
                        style={{ height: `${Math.max(d.heightPercent, 2)}%` }}
                        title={`${d.date}: ${formatPnl(d.pnl)}`}
                      />
                    </div>
                  ))}
                </div>
                <div className="flex justify-between mt-1 text-[10px] text-muted-foreground font-mono">
                  <span>{profitChartData[0]?.date.slice(5)}</span>
                  <span>{profitChartData[profitChartData.length - 1]?.date.slice(5)}</span>
                </div>
              </div>
            ) : (
              <div className="h-24 flex items-center justify-center text-sm text-muted-foreground">
                No trade data for this period
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </LayoutShell>
  );
}
