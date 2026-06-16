"use client";

import * as React from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/kbd";
import { useUiStore } from "@/lib/store/ui";
import {
  formatKeys,
  useKeyboardRegistry,
  type Shortcut,
} from "@/lib/keyboard/registry";

/** The `?` overlay — lists every registered shortcut, grouped. */
export function ShortcutHelp() {
  const open = useUiStore((s) => s.shortcutHelpOpen);
  const setOpen = useUiStore((s) => s.setShortcutHelpOpen);
  const shortcuts = useKeyboardRegistry((s) => s.shortcuts);

  const groups = React.useMemo(() => {
    const byGroup = new Map<string, Shortcut[]>();
    for (const s of shortcuts.values()) {
      const arr = byGroup.get(s.group) ?? [];
      arr.push(s);
      byGroup.set(s.group, arr);
    }
    // Stable, sensible group ordering; unknown groups fall to the end alphabetically.
    const ORDER = ["General", "Navigation", "AI", "Editor"];
    const rank = (g: string) => {
      const i = ORDER.indexOf(g);
      return i === -1 ? ORDER.length : i;
    };
    return [...byGroup.entries()]
      .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
      .map(
        ([group, items]) =>
          [group, items.slice().sort((x, y) => x.label.localeCompare(y.label))] as const,
      );
  }, [shortcuts]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Press the keys shown to trigger an action.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {groups.map(([group, items]) => (
            <div key={group}>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group}
              </h4>
              <ul className="space-y-1.5">
                {items.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-4 text-sm"
                  >
                    <span>{s.label}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {s.keys.map((k, i) => (
                        <React.Fragment key={k}>
                          {i > 0 ? (
                            <span className="text-xs text-muted-foreground">or</span>
                          ) : null}
                          <Kbd>{formatKeys(k)}</Kbd>
                        </React.Fragment>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
