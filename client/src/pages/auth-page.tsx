import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Redirect } from "wouter";
import { Loader2, TrendingUp } from "lucide-react";

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});
type LoginForm = z.infer<typeof loginSchema>;

const signupSchema = z.object({
  email: z.string().email("Enter a valid email"),
  username: z.string().min(3, "Username must be at least 3 characters"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});
type SignupForm = z.infer<typeof signupSchema>;

export default function AuthPage() {
  const { user, loginMutation, registerMutation } = useAuth();
  const [activeTab, setActiveTab] = useState<"login" | "signup">("login");

  const loginForm = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  });

  const signupForm = useForm<SignupForm>({
    resolver: zodResolver(signupSchema),
    defaultValues: { email: "", username: "", password: "" },
  });

  if (user) {
    return <Redirect to="/" />;
  }

  function onLogin(data: LoginForm) {
    loginMutation.mutate(data);
  }

  function onSignup(data: SignupForm) {
    registerMutation.mutate(data);
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
                onClick={() => setActiveTab("login")}
                className={`text-base font-semibold pb-1 ${
                  activeTab === "login"
                    ? "text-foreground border-b-2 border-[#0ecb81]"
                    : "text-muted-foreground"
                }`}
                data-testid="tab-login"
              >
                Sign In
              </button>
              <button
                onClick={() => setActiveTab("signup")}
                className={`text-base font-semibold pb-1 ${
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
              <Form {...loginForm}>
                <form onSubmit={loginForm.handleSubmit(onLogin)} className="space-y-4">
                  <FormField
                    control={loginForm.control}
                    name="username"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Username</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Enter username"
                            {...field}
                            className="bg-background border-border"
                            data-testid="input-login-username"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={loginForm.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <Input
                            type="password"
                            placeholder="Enter password"
                            {...field}
                            className="bg-background border-border"
                            data-testid="input-login-password"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
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
              </Form>
            ) : (
              <Form {...signupForm}>
                <form onSubmit={signupForm.handleSubmit(onSignup)} className="space-y-4" autoComplete="off">
                  <FormField
                    control={signupForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input
                            type="email"
                            placeholder="Enter email"
                            autoComplete="new-email"
                            {...field}
                            className="bg-background border-border"
                            data-testid="input-signup-email"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={signupForm.control}
                    name="username"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Username</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Choose a username"
                            autoComplete="new-username"
                            {...field}
                            className="bg-background border-border"
                            data-testid="input-signup-username"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={signupForm.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <Input
                            type="password"
                            placeholder="Min 6 characters"
                            autoComplete="new-password"
                            {...field}
                            className="bg-background border-border"
                            data-testid="input-signup-password"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
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
              </Form>
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
