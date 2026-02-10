import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { BarChart3, Wallet, History, TrendingUp, Briefcase, Bell, Settings, Send, Zap, LayoutGrid, X } from "lucide-react";
import { NotificationBell } from "@/components/notification-bell";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

function useTradingMode() {
  const [mode, setMode] = useState<"spot" | "futures">(() => {
    try { return (localStorage.getItem("trading_mode") as "spot" | "futures") || "spot"; } catch { return "spot"; }
  });

  useEffect(() => {
    const handler = () => {
      try { setMode((localStorage.getItem("trading_mode") as "spot" | "futures") || "spot"); } catch {}
    };
    window.addEventListener("storage", handler);
    window.addEventListener("trading_mode_changed", handler);
    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener("trading_mode_changed", handler);
    };
  }, []);

  const toggle = useCallback((newMode: "spot" | "futures") => {
    setMode(newMode);
    try {
      localStorage.setItem("trading_mode", newMode);
      window.dispatchEvent(new Event("trading_mode_changed"));
    } catch {}
  }, []);

  return { mode, toggle };
}

const primaryNavItems = [
  { label: "Market", icon: BarChart3, href: "/" },
  { label: "Assets", icon: Briefcase, href: "/assets" },
  { label: "Portfolio", icon: Wallet, href: "/portfolio" },
  { label: "Alerts", icon: Bell, href: "/alerts" },
  { label: "Autopilot", icon: Zap, href: "/autopilot" },
];

const moreNavItems = [
  { label: "Pay", icon: Send, href: "/pay" },
  { label: "History", icon: History, href: "/history" },
  { label: "Settings", icon: Settings, href: "/settings" },
];

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [location] = useLocation();
  const { mode: tradingMode, toggle: setTradingMode } = useTradingMode();
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    setMoreOpen(false);
  }, [location]);

  if (!user) return <>{children}</>;

  const isMoreActive = moreNavItems.some((item) => location === item.href);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="h-12 sm:h-14 border-b border-border flex items-center justify-between px-3 sm:px-4 gap-2 sm:gap-4 bg-card/50 sticky top-0 z-[9999]">
        <div className="flex items-center gap-4 sm:gap-6">
          <Link href="/">
            <div className="flex items-center gap-1.5 sm:gap-2 cursor-pointer" data-testid="link-home">
              <TrendingUp className="w-5 h-5 sm:w-6 sm:h-6 text-[#0ecb81]" />
              <span className="text-base sm:text-lg font-bold text-foreground hidden xs:inline">Self Treding</span>
            </div>
          </Link>
          <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5 flex-shrink-0" data-testid="header-trading-mode">
            <button
              className={`text-[10px] sm:text-xs font-medium px-2 sm:px-3 py-1 rounded-sm transition-colors ${tradingMode === "spot" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
              onClick={() => setTradingMode("spot")}
              data-testid="header-mode-spot"
            >
              Spot
            </button>
            <button
              className={`text-[10px] sm:text-xs font-medium px-2 sm:px-3 py-1 rounded-sm transition-colors ${tradingMode === "futures" ? "bg-[#f0b90b] text-black shadow-sm" : "text-muted-foreground"}`}
              onClick={() => setTradingMode("futures")}
              data-testid="header-mode-futures"
            >
              Futures
            </button>
          </div>
          <nav className="hidden md:flex items-center gap-1">
            {primaryNavItems.map((item) => (
              <Link key={item.href} href={item.href}>
                <Button
                  variant={location === item.href ? "secondary" : "ghost"}
                  size="sm"
                  data-testid={`link-${item.label.toLowerCase()}`}
                  className="gap-2"
                >
                  <item.icon className="w-4 h-4" />
                  {item.label}
                </Button>
              </Link>
            ))}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant={isMoreActive ? "secondary" : "ghost"}
                  size="sm"
                  data-testid="link-more-desktop"
                  className="gap-2"
                >
                  <LayoutGrid className="w-4 h-4" />
                  More
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-48 p-1" align="start">
                {moreNavItems.map((item) => (
                  <Link key={item.href} href={item.href}>
                    <Button
                      variant={location === item.href ? "secondary" : "ghost"}
                      size="sm"
                      className="w-full justify-start gap-2"
                      data-testid={`link-${item.label.toLowerCase()}`}
                    >
                      <item.icon className="w-4 h-4" />
                      {item.label}
                    </Button>
                  </Link>
                ))}
              </PopoverContent>
            </Popover>
          </nav>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          <NotificationBell />
          <div className="text-right">
            <div className="text-[10px] sm:text-xs text-muted-foreground leading-none">Balance</div>
            <div className="text-xs sm:text-sm font-mono font-semibold text-[#0ecb81]" data-testid="text-balance">
              ${Number(user.balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
          <span className="text-sm text-muted-foreground hidden lg:inline" data-testid="text-username">{user.username}</span>
        </div>
      </header>

      <main className="pb-20 md:pb-4">
        {children}
      </main>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-[9999] bg-card border-t border-border flex items-stretch pb-safe" data-testid="nav-bottom-tabs">
        {primaryNavItems.map((item) => {
          const isActive = location === item.href;
          return (
            <Link key={item.href} href={item.href} className="flex-1">
              <div
                className={`flex flex-col items-center justify-center py-1.5 gap-0.5 transition-colors ${
                  isActive ? "text-[#0ecb81]" : "text-muted-foreground"
                }`}
                data-testid={`link-mobile-${item.label.toLowerCase()}`}
              >
                <item.icon className={`w-5 h-5 ${isActive ? "text-[#0ecb81]" : ""}`} />
                <span className="text-[10px] font-medium leading-none">{item.label}</span>
              </div>
            </Link>
          );
        })}
        <div className="flex-1">
          <Popover open={moreOpen} onOpenChange={setMoreOpen}>
            <PopoverTrigger asChild>
              <button
                className={`w-full flex flex-col items-center justify-center py-1.5 gap-0.5 transition-colors ${
                  isMoreActive || moreOpen ? "text-[#0ecb81]" : "text-muted-foreground"
                }`}
                data-testid="link-mobile-more"
              >
                <LayoutGrid className={`w-5 h-5 ${isMoreActive || moreOpen ? "text-[#0ecb81]" : ""}`} />
                <span className="text-[10px] font-medium leading-none">More</span>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-44 p-1 mb-1" align="end" side="top">
              <div className="space-y-0.5">
                {moreNavItems.map((item) => {
                  const isActive = location === item.href;
                  return (
                    <Link key={item.href} href={item.href}>
                      <Button
                        variant={isActive ? "secondary" : "ghost"}
                        size="sm"
                        className="w-full justify-start gap-2"
                        data-testid={`link-mobile-${item.label.toLowerCase()}`}
                      >
                        <item.icon className="w-4 h-4" />
                        {item.label}
                      </Button>
                    </Link>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </nav>
    </div>
  );
}
