"use client";

import { useCallback, useEffect, useState } from "react";

/** Keep an unsent text draft across reloads in this tab. The browser clears it when the tab closes. */
export function useTabDraft(key: string, initialValue = "") {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    try {
      setValue(window.sessionStorage.getItem(key) ?? initialValue);
    } catch {
      // Keep the composer usable when storage is disabled.
    }
  }, [initialValue, key]);

  const update = useCallback(
    (next: string) => {
      setValue(next);
      try {
        if (next) window.sessionStorage.setItem(key, next);
        else window.sessionStorage.removeItem(key);
      } catch {
        // The in-memory composer still works when storage is disabled.
      }
    },
    [key],
  );

  const clear = useCallback(
    (next = "") => {
      setValue(next);
      try {
        window.sessionStorage.removeItem(key);
      } catch {
        // The in-memory composer still works when storage is disabled.
      }
    },
    [key],
  );

  return [value, update, clear] as const;
}
