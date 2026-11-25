"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./Icons";

export type ConfirmOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
};

export function useConfirmDialog() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const confirm = useCallback((messageOrOptions: string | ConfirmOptions) => {
    const opts: ConfirmOptions =
      typeof messageOrOptions === "string"
        ? { message: messageOrOptions }
        : messageOrOptions;
    setOptions(opts);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  useEffect(() => {
    if (options && dialogRef.current && !dialogRef.current.open) {
      dialogRef.current.showModal();
    }
  }, [options]);

  const close = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOptions(null);
    dialogRef.current?.close();
  }, []);

  const dialog = options ? (
    <dialog
      ref={dialogRef}
      className="confirm-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-message"
      onClose={() => close(false)}
    >
      <div className="confirm-dialog-heading">
        <span className="confirm-dialog-icon" aria-hidden="true">
          <Icon name={options.tone === "danger" ? "alert" : "info"} size={21} />
        </span>
        <div>
          <span className="eyebrow">Confirmation</span>
          <h3 id="confirm-dialog-title">{options.title || "Please confirm"}</h3>
        </div>
      </div>
      <p id="confirm-dialog-message">{options.message}</p>
      <div className="confirm-dialog-actions">
        <button
          type="button"
          className="btn btn-outline"
          autoFocus
          onClick={() => close(false)}
        >
          {options.cancelLabel || "Cancel"}
        </button>
        <button
          type="button"
          className={`btn ${options.tone === "danger" ? "btn-danger" : "btn-primary"}`}
          onClick={() => close(true)}
        >
          {options.confirmLabel || "Confirm"}
        </button>
      </div>
    </dialog>
  ) : null;

  return { confirm, dialog };
}