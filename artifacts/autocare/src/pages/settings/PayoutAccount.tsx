import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Building2, Smartphone } from "lucide-react";

type Account = {
  kind: "bank" | "momo";
  accountName: string;
  accountNumber: string;
  bank?: string;
  network?: string;
};

type Option =
  | { kind: "owner"; subscriberId: string; name: string }
  | { kind: "center"; subscriberId: string; name: string }
  | { kind: "vendor"; subscriberId: string; name: string }
  | { kind: "organization"; subscriberId: string; name: string };

const endpointFor = (opt: Option) => {
  if (opt.kind === "owner") return "/api/me/payout-account";
  if (opt.kind === "center") return `/api/service-centers/${opt.subscriberId}/payout-account`;
  if (opt.kind === "vendor") return `/api/vendors/${opt.subscriberId}/payout-account`;
  return null;
};

function PayoutForm({ opt }: { opt: Option }) {
  const endpoint = endpointFor(opt);
  const [account, setAccount] = useState<Account>({
    kind: "momo",
    accountName: "",
    accountNumber: "",
    network: "MTN",
  });
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!endpoint) return;
    void fetch(endpoint, { credentials: "include" })
      .then((r) => r.json())
      .then((b: { payoutAccount: Account | null }) => {
        if (b.payoutAccount) setAccount(b.payoutAccount);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [endpoint]);

  if (!endpoint) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Organization payouts are settled through the org admin's personal payout account.
          Configure it on the Personal tab.
        </CardContent>
      </Card>
    );
  }

  const save = async () => {
    setBusy(true);
    try {
      const body =
        account.kind === "bank"
          ? {
              kind: "bank",
              accountName: account.accountName,
              accountNumber: account.accountNumber,
              bank: account.bank ?? "",
            }
          : {
              kind: "momo",
              accountName: account.accountName,
              accountNumber: account.accountNumber,
              network: account.network ?? "MTN",
            };
      const res = await fetch(endpoint, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(err.error ?? "Failed to save payout account");
        return;
      }
      toast.success("Payout account saved. We'll attempt any pending payouts now.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 py-6">
        <div className="space-y-2">
          <Label>Payout method</Label>
          <Select
            value={account.kind}
            onValueChange={(v) =>
              setAccount((a) => ({ ...a, kind: v as "bank" | "momo" }))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="momo"><Smartphone className="size-4 mr-1 inline" /> Mobile money</SelectItem>
              <SelectItem value="bank"><Building2 className="size-4 mr-1 inline" /> Bank account</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Account name</Label>
          <Input
            value={account.accountName}
            onChange={(e) => setAccount((a) => ({ ...a, accountName: e.target.value }))}
            placeholder="As registered"
          />
        </div>
        <div className="space-y-2">
          <Label>Account number</Label>
          <Input
            value={account.accountNumber}
            onChange={(e) => setAccount((a) => ({ ...a, accountNumber: e.target.value }))}
            placeholder={account.kind === "momo" ? "024 000 0000" : "1234567890"}
          />
        </div>
        {account.kind === "bank" ? (
          <div className="space-y-2">
            <Label>Bank</Label>
            <Input
              value={account.bank ?? ""}
              onChange={(e) => setAccount((a) => ({ ...a, bank: e.target.value }))}
              placeholder="e.g. GCB Bank"
            />
          </div>
        ) : (
          <div className="space-y-2">
            <Label>Network</Label>
            <Select
              value={account.network ?? "MTN"}
              onValueChange={(v) => setAccount((a) => ({ ...a, network: v }))}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="MTN">MTN</SelectItem>
                <SelectItem value="VODAFONE">Telecel (Vodafone)</SelectItem>
                <SelectItem value="AIRTELTIGO">AirtelTigo</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        <Button onClick={save} disabled={busy || !loaded || !account.accountName || !account.accountNumber}>
          {busy ? "Saving..." : "Save payout account"}
        </Button>
      </CardContent>
    </Card>
  );
}

export default function PayoutAccountPage() {
  const { data, isLoading } = useQuery<{ options: Option[] }>({
    queryKey: ["me", "subscriber-options"],
    queryFn: () =>
      fetch("/api/me/subscriber-options", { credentials: "include" }).then((r) => r.json()),
  });
  const options = data?.options ?? [];

  return (
    <div className="max-w-2xl mx-auto py-8 space-y-6">
      <PageHeader
        title="Payout settings"
        description="Where AutoCare sends your share of online payments (parts, service invoices, or rentals)."
      />
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && options.length === 0 && (
        <Card><CardContent className="py-6 text-sm text-muted-foreground">
          You don't have a payout-eligible identity on file yet.
        </CardContent></Card>
      )}
      {options.map((opt) => (
        <div key={`${opt.kind}:${opt.subscriberId}`} className="space-y-2">
          <h2 className="font-semibold">
            {opt.kind === "owner" ? "Personal (rental owner)" :
             opt.kind === "center" ? `Service center — ${opt.name}` :
             opt.kind === "vendor" ? `Vendor — ${opt.name}` :
             `Organization — ${opt.name}`}
          </h2>
          <PayoutForm opt={opt} />
        </div>
      ))}
    </div>
  );
}
