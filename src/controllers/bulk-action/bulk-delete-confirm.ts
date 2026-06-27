import type { CascadeSummary } from "./bulk-entity-adapter";

/**
 * Show the bulk-delete confirmation dialog built from a cascade summary, reusing
 * the app's confirmationDialog helper. Calls onConfirm only when the user commits.
 * (The optional "also delete contained burgs" checkbox, gated on childKind, arrives
 * in a later slice.)
 */
export function bulkDeleteConfirm(params: { typeLabel: string; summary: CascadeSummary; onConfirm: () => void }): void {
  const { typeLabel, summary, onConfirm } = params;

  if (!summary.deletable) {
    tip(`Nothing to delete — all selected ${typeLabel} are locked.`, true, "error");
    return;
  }

  const items = summary.lines.map(line => `<li>${line}</li>`).join("");
  const skipped = summary.skippedLocked
    ? `<p><i>${summary.skippedLocked} locked row${summary.skippedLocked === 1 ? "" : "s"} will be skipped.</i></p>`
    : "";
  const message = `<ul style="margin: 0.4em 0; padding-left: 1.2em">${items}</ul>${skipped}<p>This action cannot be reverted.</p>`;

  confirmationDialog({ title: `Delete ${typeLabel}`, message, confirm: "Delete", onConfirm });
}
