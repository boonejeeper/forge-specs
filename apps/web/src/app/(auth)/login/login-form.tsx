"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn } from "@/lib/auth/client";

export interface SsoButton {
  providerId: string;
  label: string;
}

export function LoginForm({ ssoProviders }: { ssoProviders: SsoButton[] }) {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function onEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const { error } = await signIn.email({ email, password });
    setPending(false);
    if (error) {
      setError(error.message ?? "Sign in failed.");
      return;
    }
    router.push("/home");
  }

  async function onSocial(provider: "github" | "google") {
    setError(null);
    await signIn.social({ provider, callbackURL: "/home" });
  }

  async function onSso(providerId: string) {
    setError(null);
    try {
      // The ssoClient plugin redirects to the IdP and returns via the callback.
      await signIn.sso({ providerId, callbackURL: "/home" });
    } catch {
      setError("SSO sign-in failed. Contact your administrator.");
    }
  }

  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      <div className="mb-6 space-y-1 text-center">
        <h1 className="text-xl font-semibold">Sign in to ForgeSpecs</h1>
        <p className="text-sm text-muted-foreground">
          Welcome back. Enter your details to continue.
        </p>
      </div>

      <div className="space-y-3">
        <Button
          variant="outline"
          className="w-full"
          onClick={() => onSocial("github")}
        >
          <GithubIcon />
          Continue with GitHub
        </Button>
        <Button
          variant="outline"
          className="w-full"
          onClick={() => onSocial("google")}
        >
          <GoogleIcon />
          Continue with Google
        </Button>
        {ssoProviders.map((p) => (
          <Button
            key={p.providerId}
            variant="outline"
            className="w-full"
            onClick={() => onSso(p.providerId)}
          >
            <KeyRound className="size-4" />
            {p.label}
          </Button>
        ))}
      </div>

      <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        OR
        <div className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={onEmailSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        No account?{" "}
        <Link href="/signup" className="font-medium text-foreground underline">
          Create one
        </Link>
      </p>
    </div>
  );
}

function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.09.68-.22.68-.49 0-.24-.01-.87-.01-1.71-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.36-2.22-.26-4.55-1.14-4.55-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.27 2.75 1.05A9.36 9.36 0 0 1 12 6.84c.85 0 1.71.12 2.51.34 1.91-1.32 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.48-.01 2.82 0 .27.18.59.69.49A10.02 10.02 0 0 0 22 12.25C22 6.58 17.52 2 12 2z"
      />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12.48 10.92v3.28h7.84c-.24 1.84-.85 3.18-1.73 4.1-1.02 1.05-2.62 2.2-5.4 2.2-4.31 0-7.7-3.47-7.7-7.74s3.39-7.74 7.7-7.74c2.31 0 4 .91 5.24 2.08l2.31-2.31C18.16 2.96 15.78 2 12.48 2 6.96 2 2.31 6.5 2.31 12s4.65 10 10.17 10c2.97 0 5.21-.97 6.97-2.79 1.81-1.81 2.37-4.36 2.37-6.42 0-.64-.05-1.23-.15-1.72h-9.16z"
      />
    </svg>
  );
}
