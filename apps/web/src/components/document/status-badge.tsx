import { DocumentStatus } from "@forgespecs/db";

import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<DocumentStatus, string> = {
  [DocumentStatus.DRAFT]: "bg-muted text-muted-foreground",
  [DocumentStatus.REVIEW]:
    "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  [DocumentStatus.APPROVED]:
    "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  [DocumentStatus.IMPLEMENTING]:
    "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  [DocumentStatus.IMPLEMENTED]:
    "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  [DocumentStatus.DEPRECATED]:
    "bg-destructive/15 text-destructive line-through",
};

export const STATUS_LABEL: Record<DocumentStatus, string> = {
  [DocumentStatus.DRAFT]: "Draft",
  [DocumentStatus.REVIEW]: "In review",
  [DocumentStatus.APPROVED]: "Approved",
  [DocumentStatus.IMPLEMENTING]: "Implementing",
  [DocumentStatus.IMPLEMENTED]: "Implemented",
  [DocumentStatus.DEPRECATED]: "Deprecated",
};

export function StatusBadge({
  status,
  className,
}: {
  status: DocumentStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        STATUS_STYLES[status],
        className,
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
