import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { XCircle } from "lucide-react";
import { MyApprovalTimeline } from "./MyApprovalTimeline";

export default function OnboardingRejected({ note }: { note?: string | null }) {
  const { logout, user } = useAuth();
  const message = note ?? user?.approvalNote ?? null;
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <Card className="max-w-lg w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <XCircle className="h-5 w-5 text-destructive" /> Application not approved
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p>Thanks for your interest in AutoCare. Unfortunately your application was not approved at this time.</p>
          {message && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-destructive">
              <div className="text-xs uppercase tracking-wide font-semibold mb-1">Reason</div>
              <div>{message}</div>
            </div>
          )}
          <p className="text-muted-foreground text-xs">
            If you believe this is a mistake, please reach out to the AutoCare team.
          </p>
          <Button onClick={() => void logout()} variant="outline" className="w-full">
            Sign out
          </Button>
          <MyApprovalTimeline />
        </CardContent>
      </Card>
    </div>
  );
}
