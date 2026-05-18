import type { DeleteConflict } from "@workspace/api-client-react";

type MaybeFetchError = {
  status?: number;
  data?: unknown;
  message?: string;
};

function isDeleteConflict(data: unknown): data is DeleteConflict {
  return (
    typeof data === "object" &&
    data !== null &&
    "reason" in data &&
    (data as { reason?: unknown }).reason === "has_dependents"
  );
}

export function describeMutationError(err: unknown, fallback: string): string {
  if (typeof err === "object" && err !== null) {
    const e = err as MaybeFetchError;
    if (e.status === 409 && isDeleteConflict(e.data)) {
      const details = e.data.details;
      if (typeof details === "string" && details.trim().length > 0) {
        return `Cannot delete: ${details}`;
      }
      return "Cannot delete: there are linked records. Suspend it instead.";
    }
    if (e.message) return e.message;
  }
  return fallback;
}
