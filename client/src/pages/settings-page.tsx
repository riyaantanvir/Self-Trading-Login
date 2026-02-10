import { useAuth } from "@/hooks/use-auth";
import { LayoutShell } from "@/components/layout-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Shield, LogOut, ChevronRight, User } from "lucide-react";

export default function SettingsPage() {
  const { user, logoutMutation } = useAuth();

  if (!user) return <></>;


  return (
    <LayoutShell>
      <div className="max-w-lg mx-auto p-4 space-y-4">
        <h1 className="text-lg font-bold text-foreground" data-testid="text-settings-title">Settings</h1>

        <Card className="divide-y divide-border">
          <div className="flex items-center gap-3 p-4">
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
              <User className="w-5 h-5 text-muted-foreground" />
            </div>
            <div>
              <div className="text-sm font-semibold text-foreground" data-testid="text-settings-username">{user.username}</div>
              <div className="text-xs text-muted-foreground">
                Balance: ${Number(user.balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
          </div>

          {user.isAdmin && (
            <Link href="/admin">
              <div className="flex items-center justify-between p-4 hover-elevate cursor-pointer" data-testid="link-admin-panel">
                <div className="flex items-center gap-3">
                  <Shield className="w-5 h-5 text-[#f0b90b]" />
                  <div>
                    <div className="text-sm font-medium text-foreground">Admin Panel</div>
                    <div className="text-xs text-muted-foreground">Manage users and settings</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </div>
            </Link>
          )}

          <div
            className="flex items-center justify-between p-4 hover-elevate cursor-pointer"
            onClick={() => logoutMutation.mutate()}
            data-testid="button-logout"
          >
            <div className="flex items-center gap-3">
              <LogOut className="w-5 h-5 text-[#f6465d]" />
              <div>
                <div className="text-sm font-medium text-[#f6465d]">Log Out</div>
                <div className="text-xs text-muted-foreground">Sign out of your account</div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </div>
        </Card>
      </div>
    </LayoutShell>
  );
}
