import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider } from "@/hooks/use-auth";
import { ProtectedRoute } from "./lib/protected-route";

import NotFound from "@/pages/not-found";
import AuthPage from "@/pages/auth-page";
import Dashboard from "@/pages/dashboard";
import PortfolioPage from "@/pages/portfolio-page";
import HistoryPage from "@/pages/history-page";
import TokenDetail from "@/pages/token-detail";
import AssetsPage from "@/pages/assets-page";
import AdminPanel from "@/pages/admin-panel";
import AlertsPage from "@/pages/alerts-page";
import PnlPage from "@/pages/pnl-page";
import SettingsPage from "@/pages/settings-page";
import FuturesHistoryPage from "@/pages/futures-history-page";

function Router() {
  return (
    <Switch>
      <Route path="/auth" component={AuthPage} />
      <ProtectedRoute path="/" component={Dashboard} />
      <ProtectedRoute path="/trade/:symbol" component={TokenDetail} />
      <ProtectedRoute path="/assets" component={AssetsPage} />
      <ProtectedRoute path="/portfolio" component={PortfolioPage} />
      <ProtectedRoute path="/history" component={HistoryPage} />
      <ProtectedRoute path="/futures-history" component={FuturesHistoryPage} />
      <ProtectedRoute path="/alerts" component={AlertsPage} />
      <ProtectedRoute path="/pnl" component={PnlPage} />
      <ProtectedRoute path="/settings" component={SettingsPage} />
      <ProtectedRoute path="/admin" component={AdminPanel} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Router />
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
