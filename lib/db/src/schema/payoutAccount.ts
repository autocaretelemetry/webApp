/**
 * Shape stored in the `payout_account` jsonb column on service_centers,
 * vendors, and users. Mirrors `PayoutAccountSnapshot` (history) but is the
 * live, editable record. Defined here as a sibling type so multiple owning
 * tables can share it without cycling through the seller_payouts module.
 */
export type PayoutAccount = {
  kind: "bank" | "momo";
  accountName: string;
  accountNumber: string;
  bank?: string;
  network?: string;
};
