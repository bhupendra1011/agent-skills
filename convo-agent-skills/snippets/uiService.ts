// src/services/uiService.ts
// Toast notification helper. Reads/writes directly from Zustand store
// so it can be called from non-component code (API layers, hooks).

import useAppStore from "@/store/useAppStore";
import type { ToastType } from "@/store/useAppStore";

export const showToast = (
  message: string,
  type: ToastType = "success"
): void => {
  useAppStore.getState().addToast(message, type);
};
