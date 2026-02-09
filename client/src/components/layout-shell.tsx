import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { LogOut, LayoutDashboard, UserCircle, LineChart } from "lucide-react";
import { Link, useLocation } from "wouter";

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const { user, logoutMutation } = useAuth();
  const [location] = useLocation();

  if (!user) return <>{children}</>;

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-gray-900 via-background to-background text-foreground flex">
      {/* Sidebar Navigation */}
      <aside className="w-64 border-r border-white/5 bg-card/30 backdrop-blur-xl hidden md:flex flex-col">
        <div className="p-6">
          <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-emerald-200">
            Self Treding
          </h1>
        </div>

        <nav className="flex-1 px-4 space-y-2">
          <Link href="/">
            <div className={`
              flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-all duration-200
              ${location === "/" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-white/5 hover:text-foreground"}
            `}>
              <LayoutDashboard size={20} />
              <span className="font-medium">Dashboard</span>
            </div>
          </Link>
          
          <div className="px-4 py-2 mt-6">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Account
            </p>
            <div className="flex items-center gap-3 px-2 py-2 text-sm text-foreground/80">
              <UserCircle size={16} />
              <span>{user.username}</span>
              {user.isAdmin && (
                <span className="ml-auto text-[10px] bg-accent/20 text-accent px-2 py-0.5 rounded-full font-bold border border-accent/20">
                  ADMIN
                </span>
              )}
            </div>
          </div>
        </nav>

        <div className="p-4 border-t border-white/5">
          <Button
            variant="ghost"
            className="w-full justify-start gap-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
          >
            <LogOut size={18} />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Mobile Header */}
        <header className="h-16 md:hidden border-b border-white/5 flex items-center justify-between px-4 bg-card/50 backdrop-blur-md">
          <span className="font-bold text-lg text-primary">Self Treding</span>
          <Button size="sm" variant="ghost" onClick={() => logoutMutation.mutate()}>
            <LogOut size={18} />
          </Button>
        </header>

        {/* Scrollable Area */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="max-w-7xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
