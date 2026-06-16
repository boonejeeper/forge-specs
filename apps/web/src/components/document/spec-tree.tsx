"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { DocumentType } from "@forgespecs/db";
import {
  DOC_TYPE_ORDER,
  nextStatuses,
} from "@forgespecs/core";
import {
  FileText,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspace, useProject } from "@/lib/context/workspace-context";
import {
  useDocumentTree,
  useChangeDocumentStatus,
  useDeleteDocument,
  useRenameDocument,
  useReorderDocuments,
} from "@/lib/query/use-documents";
import { StatusBadge, STATUS_LABEL } from "@/components/document/status-badge";
import { CreateDocumentDialog } from "@/components/document/create-document-dialog";
import { RenameDialog } from "@/components/common/rename-dialog";
import type { DocumentTreeItem } from "@/lib/data/documents";

/**
 * Spec repository tree. RSC-seeds the document list into the Query cache, then
 * renders documents grouped by DocType in canonical order. Each group is a
 * dnd-kit sortable list (reorder within type); per-doc actions (rename, delete,
 * status) are optimistic mutations. Documents deep-link to their spec view.
 */
export function SpecTree() {
  const { data: docs = [] } = useDocumentTree(useProject().projectId);
  const [createType, setCreateType] = React.useState<DocumentType | undefined>(
    undefined,
  );
  const [createOpen, setCreateOpen] = React.useState(false);

  const byType = React.useMemo(() => {
    const map = new Map<DocumentType, DocumentTreeItem[]>();
    for (const d of docs) {
      const arr = map.get(d.type) ?? [];
      arr.push(d);
      map.set(d.type, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
    }
    return map;
  }, [docs]);

  function openCreate(type?: DocumentType) {
    setCreateType(type);
    setCreateOpen(true);
  }

  return (
    <div className="space-y-4">
      {DOC_TYPE_ORDER.map((meta) => (
        <TypeGroup
          key={meta.type}
          type={meta.type}
          label={meta.label}
          docs={byType.get(meta.type) ?? []}
          onAdd={() => openCreate(meta.type)}
        />
      ))}

      <CreateDocumentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultType={createType}
      />
    </div>
  );
}

function TypeGroup({
  type,
  label,
  docs,
  onAdd,
}: {
  type: DocumentType;
  label: string;
  docs: DocumentTreeItem[];
  onAdd: () => void;
}) {
  const { workspaceId } = useWorkspace();
  const { projectId } = useProject();
  const reorder = useReorderDocuments({ workspaceId, projectId });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Local order mirror so the drag is smooth; the mutation persists on drop.
  const ids = docs.map((d) => d.id);

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(active.id as string);
    const newIndex = ids.indexOf(over.id as string);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(ids, oldIndex, newIndex);
    reorder.mutate(next);
  }

  return (
    <div>
      <div className="group/header flex items-center justify-between px-1 py-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
          <span className="ml-1.5 font-normal opacity-60">{docs.length}</span>
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 opacity-0 group-hover/header:opacity-100"
          aria-label={`Add ${label}`}
          onClick={onAdd}
        >
          <Plus className="size-4" />
        </Button>
      </div>

      {docs.length === 0 ? (
        <button
          type="button"
          onClick={onAdd}
          className="w-full rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent"
        >
          Add {label.toLowerCase()}…
        </button>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul className="space-y-0.5">
              {docs.map((doc) => (
                <SortableDocRow key={doc.id} doc={doc} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

function SortableDocRow({ doc }: { doc: DocumentTreeItem }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: doc.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  return (
    <li ref={setNodeRef} style={style}>
      <DocRow doc={doc} dragHandleProps={{ ...attributes, ...listeners }} />
    </li>
  );
}

function DocRow({
  doc,
  dragHandleProps,
}: {
  doc: DocumentTreeItem;
  dragHandleProps: Record<string, unknown>;
}) {
  const { workspaceId, workspaceSlug } = useWorkspace();
  const { projectId, projectSlug } = useProject();
  const pathname = usePathname();
  const [renameOpen, setRenameOpen] = React.useState(false);

  const rename = useRenameDocument({ workspaceId, projectId });
  const del = useDeleteDocument({ workspaceId, projectId });
  const changeStatus = useChangeDocumentStatus({ workspaceId, projectId });

  const href = `/${workspaceSlug}/${projectSlug}/specs/${doc.id}`;
  const active = pathname.startsWith(href);
  const optimistic = doc.id.startsWith("optimistic-");

  return (
    <div
      className={cn(
        "group flex items-center gap-1 rounded-md pr-1",
        active ? "bg-accent" : "hover:bg-accent/60",
      )}
    >
      <button
        type="button"
        className="cursor-grab px-1 text-muted-foreground opacity-0 group-hover:opacity-100"
        aria-label="Reorder"
        {...dragHandleProps}
      >
        <GripVertical className="size-4" />
      </button>
      <Link
        href={href}
        className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-sm"
        aria-disabled={optimistic}
      >
        <FileText className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{doc.title}</span>
        <StatusBadge status={doc.status} className="shrink-0" />
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 shrink-0 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
            aria-label="Document actions"
            disabled={optimistic}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
            <Pencil className="size-4" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Change status</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuLabel>{STATUS_LABEL[doc.status]}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {nextStatuses(doc.status).map((status) => (
                <DropdownMenuItem
                  key={status}
                  onSelect={() =>
                    changeStatus.mutate({ documentId: doc.id, status })
                  }
                >
                  {STATUS_LABEL[status]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => del.mutate(doc.id)}
          >
            <Trash2 className="size-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <RenameDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title="Rename document"
        label="Title"
        initialValue={doc.title}
        onSubmit={(title) => rename.mutate({ documentId: doc.id, title })}
      />
    </div>
  );
}
