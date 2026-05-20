// useSpawnerVisibility — persists the Spawner-column-visible flag to
// localStorage('alo:spawner-visible'). Default true (panel visible) on
// first launch. The actual permanent right column lands in Task 2.4;
// for Phase 2.1 this hook just records the user's intent.

import { useState, useCallback } from "react";

const KEY = "alo:spawner-visible";

function readInitial(): boolean {
  const v = localStorage.getItem(KEY);
  if (v === "true") return true;
  if (v === "false") return false;
  return true; // default visible
}

export function useSpawnerVisibility() {
  const [visible, setVisible] = useState<boolean>(() => readInitial());

  const toggle = useCallback(() => {
    setVisible((v) => {
      const next = !v;
      localStorage.setItem(KEY, String(next));
      return next;
    });
  }, []);

  return { visible, toggle };
}
