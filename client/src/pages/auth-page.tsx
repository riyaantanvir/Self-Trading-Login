import { useAuth } from "@/hooks/use-auth";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Redirect } from "wouter";
import { Loader2, TrendingUp } from "lucide-react";
import { insertUserSchema } from "@shared/schema";

const loginSchema = insertUserSchema.pick({ username: true, password: true });
type LoginForm = z.infer<typeof loginSchema>;

export default function AuthPage() {
  const { user, loginMutation } = useAuth();
  
  const form = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: "",
      password: "",
    },
  });

  if (user) {
    return <Redirect to="/" />;
  }

  function onSubmit(data: LoginForm) {
    loginMutation.mutate(data);
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left: Form Side */}
      <div className="flex items-center justify-center p-8 bg-background relative overflow-hidden">
        {/* Decorative background elements */}
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_top_left,_var(--tw-gradient-stops))] from-primary/5 via-background to-background" />
        
        <Card className="w-full max-w-md border-white/10 bg-card/50 backdrop-blur-xl shadow-2xl relative z-10">
          <CardHeader className="space-y-1">
            <div className="flex items-center gap-2 mb-2 text-primary">
              <TrendingUp className="w-8 h-8" />
              <span className="text-xl font-bold tracking-tight">Self Treding</span>
            </div>
            <CardTitle className="text-2xl font-bold">Welcome back</CardTitle>
            <CardDescription>Enter your credentials to access your dashboard</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Username</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="trader1" 
                          {...field} 
                          className="bg-background/50 border-white/10 focus:border-primary/50"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <Input 
                          type="password" 
                          placeholder="••••••••" 
                          {...field} 
                          className="bg-background/50 border-white/10 focus:border-primary/50"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button 
                  type="submit" 
                  className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-lg shadow-primary/20 transition-all duration-300" 
                  disabled={loginMutation.isPending}
                >
                  {loginMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Authenticating...
                    </>
                  ) : (
                    "Sign In"
                  )}
                </Button>
              </form>
            </Form>

            <div className="mt-6 text-center text-sm text-muted-foreground">
              <p>Demo Account:</p>
              <div className="mt-2 p-2 bg-secondary/50 rounded text-xs font-mono border border-white/5">
                User: admin <span className="mx-2">|</span> Pass: admin
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Right: Visual Side */}
      <div className="hidden lg:flex flex-col justify-center p-12 bg-muted relative">
        <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1611974765270-ca1258634369?q=80&w=2564&auto=format&fit=crop')] bg-cover bg-center opacity-10 mix-blend-overlay"></div>
        {/* Descriptive HTML Comment for Stock Image */}
        {/* Abstract financial chart background image with dark overlay */}
        
        <div className="relative z-10 max-w-lg">
          <h2 className="text-4xl font-display font-bold mb-6 text-white leading-tight">
            Advanced Analytics for <br/>
            <span className="text-primary">Professional Traders</span>
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            Execute trades with precision. Monitor your portfolio in real-time. 
            Access institutional-grade tools designed for individual investors.
          </p>
          
          <div className="grid grid-cols-2 gap-6">
            <div className="glass-panel p-4 rounded-xl">
              <div className="text-3xl font-bold text-white mb-1">0.1ms</div>
              <div className="text-sm text-muted-foreground">Latency Execution</div>
            </div>
            <div className="glass-panel p-4 rounded-xl">
              <div className="text-3xl font-bold text-white mb-1">24/7</div>
              <div className="text-sm text-muted-foreground">Market Access</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
