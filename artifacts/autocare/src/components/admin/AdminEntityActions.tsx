import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ToggleLeft, ToggleRight, Trash2 } from "lucide-react";

type Props = {
  entityLabel: string;
  active: boolean;
  onToggleActive: (next: boolean) => Promise<void> | void;
  onDelete: () => Promise<void> | void;
  busy?: boolean;
};

export function AdminEntityActions({
  entityLabel,
  active,
  onToggleActive,
  onDelete,
  busy,
}: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      <Button
        size="sm"
        variant={active ? "outline" : "default"}
        onClick={() => onToggleActive(!active)}
        disabled={busy}
        className="gap-1.5"
      >
        {active ? (
          <>
            <ToggleRight className="h-4 w-4" /> Suspend
          </>
        ) : (
          <>
            <ToggleLeft className="h-4 w-4" /> Reactivate
          </>
        )}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setConfirmDelete(true)}
        disabled={busy}
        className="text-destructive hover:text-destructive hover:bg-destructive/10"
        aria-label={`Delete ${entityLabel}`}
      >
        <Trash2 className="h-4 w-4" />
      </Button>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {entityLabel}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the {entityLabel.toLowerCase()} from the platform. If it has
              active records the platform will block the deletion and suggest suspending instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setConfirmDelete(false);
                await onDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
