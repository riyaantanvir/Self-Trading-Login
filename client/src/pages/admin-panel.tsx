import { useAuth } from "@/hooks/use-auth";
import { LayoutShell } from "@/components/layout-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Redirect } from "wouter";
import {
  Users,
  Wallet,
  Settings,
  Shield,
  BarChart3,
  Bell,
  Lock,
} from "lucide-react";

const adminSections = [
  {
    title: "User Management",
    description: "View all registered users, edit profiles, and manage accounts",
    icon: Users,
    status: "Coming Soon",
  },
  {
    title: "Balance Top-up",
    description: "Add funds to user accounts, manage deposits and withdrawals",
    icon: Wallet,
    status: "Coming Soon",
  },
  {
    title: "Trading Controls",
    description: "Set trading limits, manage fees, and configure trading pairs",
    icon: BarChart3,
    status: "Coming Soon",
  },
  {
    title: "Security Settings",
    description: "Manage authentication, session settings, and access controls",
    icon: Shield,
    status: "Coming Soon",
  },
  {
    title: "Notifications",
    description: "Configure alerts, announcements, and system notifications",
    icon: Bell,
    status: "Coming Soon",
  },
  {
    title: "Access Control",
    description: "Manage admin roles, permissions, and API key access",
    icon: Lock,
    status: "Coming Soon",
  },
  {
    title: "Platform Settings",
    description: "General platform configuration, branding, and preferences",
    icon: Settings,
    status: "Coming Soon",
  },
];

export default function AdminPanel() {
  const { user } = useAuth();

  if (!user?.isAdmin) {
    return <Redirect to="/" />;
  }

  return (
    <LayoutShell>
      <div className="p-4 md:p-6 max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground" data-testid="text-page-title">
            Admin Panel
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your platform settings and users
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {adminSections.map((section) => (
            <Card
              key={section.title}
              className="hover-elevate cursor-pointer"
              data-testid={`card-admin-${section.title.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-md bg-[#0ecb81]/10 flex items-center justify-center flex-shrink-0">
                    <section.icon className="w-5 h-5 text-[#0ecb81]" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-foreground text-sm">
                      {section.title}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {section.description}
                    </p>
                    <span className="inline-block mt-2 text-[10px] font-medium text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-md">
                      {section.status}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </LayoutShell>
  );
}
