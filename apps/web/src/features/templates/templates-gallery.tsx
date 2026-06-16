"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Layers,
  Loader2,
  Store,
  Bot,
  GraduationCap,
  ShoppingCart,
  Boxes,
  Radio,
  Network,
  Box,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { TemplateGalleryItem } from "@forgespecs/core/templates";
import { applyTemplate } from "@/lib/actions/templates";

interface ProjectOption {
  id: string;
  name: string;
  slug: string;
}

/**
 * Static icon map for the (small, fixed) set of template icons. Replaces the old
 * `import * as Icons from "lucide-react"` which pulled the ENTIRE lucide icon set
 * (~197 kB) into the client bundle. Template icon names come from core's
 * definitions (Layers/Store/Bot/GraduationCap/ShoppingCart/Boxes/Radio/Network/
 * Box), so only these are bundled now.
 */
const TEMPLATE_ICONS: Record<string, LucideIcon> = {
  Layers,
  Store,
  Bot,
  GraduationCap,
  ShoppingCart,
  Boxes,
  Radio,
  Network,
  Box,
};

function TemplateIcon({ name, className }: { name: string; className?: string }) {
  const Icon = TEMPLATE_ICONS[name] ?? Layers;
  return <Icon className={className} />;
}

export function TemplatesGallery({
  templates,
  workspaceId,
  workspaceSlug,
  projects,
}: {
  templates: TemplateGalleryItem[];
  workspaceId: string;
  workspaceSlug: string;
  projects: ProjectOption[];
}) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<TemplateGalleryItem | null>(null);
  const [projectId, setProjectId] = React.useState<string>(projects[0]?.id ?? "");
  const [applying, setApplying] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const open = (t: TemplateGalleryItem) => {
    setSelected(t);
    setProjectId(projects[0]?.id ?? "");
    setError(null);
  };

  const onApply = async () => {
    if (!selected || !projectId) return;
    setApplying(true);
    setError(null);
    try {
      const result = await applyTemplate({
        workspaceId,
        projectId,
        templateId: selected.id,
      });
      const project = projects.find((p) => p.id === projectId);
      setSelected(null);
      if (project) {
        router.push(`/${workspaceSlug}/${project.slug}`);
      }
      router.refresh();
      void result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to apply template.");
    } finally {
      setApplying(false);
    }
  };

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((t) => (
          <div
            key={t.id}
            className="flex flex-col rounded-lg border bg-card p-5 transition-colors hover:border-foreground/20"
          >
            <div className="mb-3 flex size-10 items-center justify-center rounded-md bg-muted">
              <TemplateIcon name={t.icon} className="size-5 text-foreground" />
            </div>
            <h3 className="text-base font-semibold">{t.name}</h3>
            <p className="mt-1 flex-1 text-sm text-muted-foreground">{t.description}</p>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {t.docCount} docs · {t.edgeCount} links
              </span>
              <Button size="sm" variant="outline" onClick={() => open(t)}>
                Use template
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={selected !== null} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply “{selected?.name}” template</DialogTitle>
            <DialogDescription>
              Creates {selected?.docCount} starter documents and {selected?.edgeCount}{" "}
              dependency links in the selected project.
            </DialogDescription>
          </DialogHeader>

          {projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Create a project first, then apply a template.
            </p>
          ) : (
            <div className="space-y-2">
              <label htmlFor="tpl-project" className="text-sm font-medium">
                Project
              </label>
              <select
                id="tpl-project"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setSelected(null)} disabled={applying}>
              Cancel
            </Button>
            <Button
              onClick={onApply}
              disabled={applying || projects.length === 0 || !projectId}
            >
              {applying ? <Loader2 className="size-4 animate-spin" /> : null}
              Apply template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
