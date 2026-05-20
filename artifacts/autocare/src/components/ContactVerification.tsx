import { useEffect, useState } from "react";
import {
  verifySignupCode as verifySignupCodeApi,
  resendSignupVerification as resendSignupVerificationApi,
  ApiError,
} from "@workspace/api-client-react";
import type {
  SignupVerificationStatus,
  VerifySignupCodeInputChannel,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export function channelLabel(c: VerifySignupCodeInputChannel): string {
  return c === "email" ? "Email" : "WhatsApp";
}

/**
 * One row per pending channel: code input + verify + resend (rate-limited).
 * Backed by the same /auth/signup/verify and /auth/signup/resend-verification
 * endpoints used during signup — they look the user up by id and don't
 * require an authenticated session, so the same flow works for re-verifying
 * an email or phone changed from the profile page.
 */
export function ContactChannelVerifier({
  userId,
  channel,
  recipient,
  onVerified,
}: {
  userId: string;
  channel: VerifySignupCodeInputChannel;
  recipient: string;
  onVerified: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(60);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const clean = code.trim();
    if (clean.length < 4) {
      setError("Enter the code we sent you.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = (await verifySignupCodeApi({
        userId,
        channel,
        code: clean,
      })) as SignupVerificationStatus;
      if (
        result.verifiedChannels.includes(
          channel as unknown as SignupVerificationStatus["verifiedChannels"][number],
        )
      ) {
        onVerified();
      } else {
        setError("That code didn't match. Please try again.");
      }
    } catch (err) {
      const msg =
        err instanceof ApiError && err.data && typeof err.data === "object"
          ? (err.data as { error?: string }).error
          : err instanceof Error
            ? err.message
            : null;
      setError(msg || "Could not verify that code.");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (busy || cooldown > 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = (await resendSignupVerificationApi({
        userId,
        channel,
      })) as SignupVerificationStatus & { retryAfterSeconds?: number | null };
      setCooldown(result.retryAfterSeconds ?? 60);
      toast.success(`New code sent to your ${channelLabel(channel).toLowerCase()}.`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        const data = (err.data as { retryAfterSeconds?: number } | null) ?? null;
        const wait = data?.retryAfterSeconds ?? 60;
        setCooldown(wait);
        setError(`Please wait ${wait}s before requesting another code.`);
      } else {
        const msg =
          err instanceof ApiError && err.data && typeof err.data === "object"
            ? (err.data as { error?: string }).error
            : err instanceof Error
              ? err.message
              : null;
        setError(msg || "Could not resend that code.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-md border bg-card p-4">
      <div className="flex items-baseline justify-between">
        <div className="font-medium">{channelLabel(channel)}</div>
        <div className="text-xs text-muted-foreground truncate ml-3 max-w-[60%]">
          {recipient}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Input
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={8}
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-label={`${channelLabel(channel)} verification code`}
        />
        <Button type="submit" disabled={busy}>
          {busy ? "Checking…" : "Verify"}
        </Button>
      </div>
      <div className="flex items-center justify-between text-xs">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto px-1 py-0.5 text-xs"
          disabled={busy || cooldown > 0}
          onClick={resend}
        >
          {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
        </Button>
        {error && <span className="text-destructive">{error}</span>}
      </div>
    </form>
  );
}
