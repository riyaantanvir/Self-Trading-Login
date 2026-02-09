import { useAuth } from "@/hooks/use-auth";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { BarChart3, Wallet, History, LogOut, TrendingUp, Briefcase } from "lucide-react";

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const { user, logoutMutation } = useAuth();
  const [location] = useLocation();

  if (!user) return <>{children}</>;

  const navItems = [
    { label: "Market", icon: BarChart3, href: "/" },
    { label: "Assets", icon: Briefcase, href: "/assets" },
    { label: "Portfolio", icon: Wallet, href: "/portfolio" },
    { label: "History", icon: History, href: "/history" },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="h-14 border-b border-border flex items-center justify-between px-4 gap-4 flex-wrap bg-card/50 sticky top-0 z-50">
        <div className="flex items-center gap-6">
          <Link href="/">
            <div className="flex items-center gap-2 cursor-pointer" data-testid="link-home">
              <TrendingUp className="w-6 h-6 text-[#0ecb81]" />
              <span className="text-lg font-bold text-foreground">Self Treding</span>
            </div>
          </Link>
          <nav className="hidden sm:flex items-center gap-1">
            {navItems.map((item) => (
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
          </nav>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Balance</div>
            <div className="text-sm font-mono font-semibold text-[#0ecb81]" data-testid="text-balance">
              ${Number(user.balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground hidden md:inline" data-testid="text-username">{user.username}</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => logoutMutation.mutate()}
              data-testid="button-logout"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <nav className="sm:hidden flex items-center gap-1 p-2 border-b border-border bg-card/30">
        {navItems.map((item) => (
          <Link key={item.href} href={item.href}>
            <Button
              variant={location === item.href ? "secondary" : "ghost"}
              size="sm"
              className="gap-2 flex-1"
              data-testid={`link-mobile-${item.label.toLowerCase()}`}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </Button>
          </Link>
        ))}
      </nav>

      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
