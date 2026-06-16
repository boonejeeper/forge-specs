"use client";

import * as React from "react";

import { eventToChord, useKeyboardRegistry } from "./registry";

const CHORD_TIMEOUT_MS = 800;

function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return (
    el.isContentEditable ||
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT"
  );
}

/**
 * Single global keydown listener. Supports tinykeys-style chord sequences
 * (e.g. "g i") and modifier combos (e.g. "$mod+k"). Resolves bindings against
 * the keyboard registry so there is exactly one place shortcuts live.
 *
 * Mount once near the app root.
 */
export function KeyboardListener() {
  const bufferRef = React.useRef<string[]>([]);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    function reset() {
      bufferRef.current = [];
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      const chord = eventToChord(e);
      const hasModifier = e.metaKey || e.ctrlKey || e.altKey;

      // While typing in an input, only allow modifier-driven shortcuts.
      if (isEditableTarget(e.target) && !hasModifier) return;

      bufferRef.current.push(chord);
      const sequence = bufferRef.current.join(" ");

      const shortcuts = useKeyboardRegistry.getState().list();

      // Exact match on the full sequence or any alternate binding.
      const match = shortcuts.find(
        (s) =>
          (!s.when || s.when()) &&
          s.keys.some((k) => k === sequence || k === chord),
      );

      if (match) {
        e.preventDefault();
        match.handler(e);
        reset();
        return;
      }

      // Is the current buffer a viable prefix of any multi-chord binding?
      const isPrefix = shortcuts.some((s) =>
        s.keys.some((k) => k.startsWith(sequence + " ")),
      );

      if (isPrefix) {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(reset, CHORD_TIMEOUT_MS);
      } else {
        reset();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      reset();
    };
  }, []);

  return null;
}
