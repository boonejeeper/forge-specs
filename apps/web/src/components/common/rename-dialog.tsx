"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Generic inline rename dialog used for projects and documents. */
export function RenameDialog({
  open,
  onOpenChange,
  title,
  label,
  initialValue,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  label: string;
  initialValue: string;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = React.useState(initialValue);

  // Reset to the latest initial value each time the dialog opens.
  React.useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next = value.trim();
    if (!next) return;
    onSubmit(next);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rename-input">{label}</Label>
            <Input
              id="rename-input"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!value.trim()}>
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
