import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Redirect } from "wouter";
import { Loader2, TrendingUp } from "lucide-react";

export default function AuthPage() {
  const { user, loginMutation, registerMutation } = useAuth();
  const [activeTab, setActiveTab] = useState<"login" | "signup">("login");

  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [signupUsername, setSignupUsername] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupError, setSignupError] = useState("");

  if (user) {
    return <Redirect to="/" />;
  }

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!loginUsername || !loginPassword) return;
    loginMutation.mutate({ username: loginUsername, password: loginPassword });
  }

  function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    if (signupUsername.length < 3) {
      setSignupError("Username must be at least 3 characters");
      return;
    }
    if (signupPassword.length < 6) {
      setSignupError("Password must be at least 6 characters");
      return;
    }
    setSignupError("");
    registerMutation.mutate({ username: signupUsername, password: signupPassword, email: "" });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-4">
            <TrendingUp className="w-10 h-10 text-[#0ecb81]" />
          </div>
          <h1 className="text-3xl font-bold text-foreground">Self Treding</h1>
          <p className="text-sm text-muted-foreground mt-2">Simulated Crypto Trading Platform</p>
        </div>

        <Card className="border-border">
          <CardHeader className="pb-3">
            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => setActiveTab("login")}
                className={`text-base font-semibold pb-1 cursor-pointer ${
                  activeTab === "login"
                    ? "text-foreground border-b-2 border-[#0ecb81]"
                    : "text-muted-foreground"
                }`}
                data-testid="tab-login"
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("signup")}
                className={`text-base font-semibold pb-1 cursor-pointer ${
                  activeTab === "signup"
                    ? "text-foreground border-b-2 border-[#0ecb81]"
                    : "text-muted-foreground"
                }`}
                data-testid="tab-signup"
              >
                Sign Up
              </button>
            </div>
          </CardHeader>
          <CardContent>
            {activeTab === "login" ? (
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Username</label>
                  <Input
                    value={loginUsername}
                    onChange={(e) => setLoginUsername(e.target.value)}
                    placeholder="Enter username"
                    data-testid="input-login-username"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Password</label>
                  <Input
                    type="password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="Enter password"
                    data-testid="input-login-password"
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full bg-[#0ecb81] text-white font-semibold"
                  disabled={loginMutation.isPending}
                  data-testid="button-login"
                >
                  {loginMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "Log In"
                  )}
                </Button>
              </form>
            ) : (
              <form onSubmit={handleSignup} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Username</label>
                  <Input
                    value={signupUsername}
                    onChange={(e) => setSignupUsername(e.target.value)}
                    placeholder="Choose a username"
                    data-testid="input-signup-username"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Password</label>
                  <Input
                    type="password"
                    value={signupPassword}
                    onChange={(e) => setSignupPassword(e.target.value)}
                    placeholder="Min 6 characters"
                    data-testid="input-signup-password"
                  />
                </div>
                {signupError && (
                  <p className="text-sm text-destructive" data-testid="text-signup-error">{signupError}</p>
                )}
                <Button
                  type="submit"
                  className="w-full bg-[#0ecb81] text-white font-semibold"
                  disabled={registerMutation.isPending}
                  data-testid="button-signup"
                >
                  {registerMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "Create Account"
                  )}
                </Button>
              </form>
            )}

            {activeTab === "login" && (
              <div className="mt-6 text-center text-xs text-muted-foreground">
                <p>Admin credentials:</p>
                <div className="mt-1 p-2 bg-muted rounded-md font-mono text-xs" data-testid="text-demo-credentials">
                  User: Admin | Pass: Admin
                </div>
              </div>
            )}

            <div className="mt-4 text-center text-xs text-muted-foreground">
              {activeTab === "login" ? (
                <p>
                  Don't have an account?{" "}
                  <button
                    type="button"
                    onClick={() => setActiveTab("signup")}
                    className="text-[#0ecb81] font-medium"
                    data-testid="link-switch-to-signup"
                  >
                    Sign Up
                  </button>
                </p>
              ) : (
                <p>
                  Already have an account?{" "}
                  <button
                    type="button"
                    onClick={() => setActiveTab("login")}
                    className="text-[#0ecb81] font-medium"
                    data-testid="link-switch-to-login"
                  >
                    Sign In
                  </button>
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
