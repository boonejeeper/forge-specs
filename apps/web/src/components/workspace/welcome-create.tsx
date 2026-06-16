"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { CreateWorkspaceDialog } from "@/components/workspace/create-workspace-dialog";

export function WelcomeCreate() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Create workspace</Button>
      <CreateWorkspaceDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
