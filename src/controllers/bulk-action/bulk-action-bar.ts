import { bulkDeleteConfirm } from "./bulk-delete-confirm";
import type { BulkEntityAdapter } from "./bulk-entity-adapter";
import { BulkSelection } from "./bulk-selection";

/**
 * DOM glue for one list menu. Mounts a per-row checkbox column and a bulk bar
 * (always-visible "select all" + an actions group shown only when something is
 * selected) onto the menu's `<div class="table">` container. Wires DOM events to a
 * shared BulkSelection and the menu's BulkEntityAdapter, and re-syncs after the
 * list re-renders (selection survives the refresh). Attaches to both legacy-JS and
 * migrated-TS lists, which share the same `.table` of row `<div>`s shape.
 */
export class BulkActionBar {
  private readonly adapter: BulkEntityAdapter;
  private readonly selection: BulkSelection;
  private container: HTMLElement | null = null;
  private bar: HTMLElement | null = null;
  private selectAllCheckbox: HTMLInputElement | null = null;
  private actionsGroup: HTMLElement | null = null;
  private countLabel: HTMLElement | null = null;

  constructor(adapter: BulkEntityAdapter) {
    this.adapter = adapter;
    this.selection = new BulkSelection(id => adapter.isDeletable(id));
  }

  /** Create the bar (idempotent) and wire events. Call once the container exists. */
  mount(): void {
    this.container = document.getElementById(this.adapter.containerId);
    if (!this.container) return;
    if (this.bar) {
      this.sync();
      return;
    }

    const canLock = typeof this.adapter.setLock === "function";
    const canColor = this.adapter.supportsColor && typeof this.adapter.setColor === "function";
    const lockButtons = canLock
      ? /* html */ `
        <button type="button" class="bulkLock" data-tip="Lock selected rows (protects from regeneration and bulk delete)">Lock</button>
        <button type="button" class="bulkUnlock" data-tip="Unlock selected rows">Unlock</button>`
      : "";
    const colorButton = canColor
      ? /* html */ `<button type="button" class="bulkColor" data-tip="Set color of selected rows">Set color</button>`
      : "";

    const bar = document.createElement("div");
    bar.className = "bulkActionBar";
    bar.innerHTML = /* html */ `
      <label class="bulkSelectAll" data-tip="Select or deselect all visible rows">
        <input type="checkbox" class="bulkSelectAllCheckbox" /> Select all
      </label>
      <span class="bulkActions" style="display: none">
        <span class="bulkCount">0 selected</span>
        <button type="button" class="bulkDelete" data-tip="Delete selected rows">Delete</button>
        ${lockButtons}
        ${colorButton}
      </span>`;
    this.container.insertAdjacentElement("afterend", bar);

    this.bar = bar;
    this.selectAllCheckbox = bar.querySelector(".bulkSelectAllCheckbox");
    this.actionsGroup = bar.querySelector(".bulkActions");
    this.countLabel = bar.querySelector(".bulkCount");

    this.selectAllCheckbox?.addEventListener("change", () => this.onToggleSelectAll());
    bar.querySelector(".bulkDelete")?.addEventListener("click", () => this.onDelete());
    bar.querySelector(".bulkLock")?.addEventListener("click", () => this.onSetLock(true));
    bar.querySelector(".bulkUnlock")?.addEventListener("click", () => this.onSetLock(false));
    bar.querySelector(".bulkColor")?.addEventListener("click", () => this.onSetColor());

    // delegate per-row checkbox changes from the container
    this.container.addEventListener("change", event => {
      const target = event.target as HTMLElement;
      if (!target.classList?.contains("bulkRowCheckbox")) return;
      const row = target.parentElement as HTMLElement | null;
      const id = row && this.adapter.getRowId(row);
      if (id === null || id === undefined) return;
      this.selection.toggle(id);
      this.updateBar();
    });

    this.sync();
  }

  /** Re-add per-row checkboxes after a list re-render and restore their checked state. */
  sync(): void {
    if (!this.container || !this.bar) return;
    const rows = Array.from(this.container.children) as HTMLElement[];
    rows.forEach(row => {
      const id = this.adapter.getRowId(row);
      if (id === null || !this.adapter.isDeletable(id)) return;

      let checkbox = row.querySelector<HTMLInputElement>(":scope > input.bulkRowCheckbox");
      if (!checkbox) {
        checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "bulkRowCheckbox";
        row.insertBefore(checkbox, row.firstChild);
      }
      checkbox.checked = this.selection.isSelected(id);
    });
    this.updateBar();
  }

  private onToggleSelectAll(): void {
    const visibleIds = this.getSelectableVisibleIds();
    if (this.selectAllCheckbox?.checked) {
      this.selection.selectAll(visibleIds);
    } else {
      visibleIds.forEach(id => {
        this.selection.remove(id);
      });
    }
    this.sync();
  }

  private onDelete(): void {
    const ids = this.selection.getSelected();
    const summary = this.adapter.describeCascade(ids);
    bulkDeleteConfirm({
      typeLabel: this.adapter.type,
      summary,
      onConfirm: () => {
        ids
          .filter(id => this.adapter.isDeletable(id) && !this.adapter.isLocked(id))
          .forEach(id => {
            this.adapter.deleteEntity(id);
          });
        this.selection.clear();
        this.adapter.redraw(); // single redraw + list refresh (which re-syncs the bar)
        this.sync();
      }
    });
  }

  private onSetLock(locked: boolean): void {
    if (!this.adapter.setLock) return;
    this.selection.getSelected().forEach(id => {
      this.adapter.setLock?.(id, locked);
    });
    this.selection.clear();
    this.adapter.redraw();
    this.sync();
  }

  private onSetColor(): void {
    if (!this.adapter.setColor) return;
    const ids = this.selection.getSelected();
    if (!ids.length) return;
    openPicker("#ffffff", chosenColor => {
      ids.forEach(id => {
        this.adapter.setColor?.(id, chosenColor);
      });
      this.selection.clear();
      this.adapter.redraw();
      this.sync();
    });
  }

  private getSelectableVisibleIds(): number[] {
    if (!this.container) return [];
    const ids: number[] = [];
    (Array.from(this.container.children) as HTMLElement[]).forEach(row => {
      if (row.classList.contains("hidden") || row.style.display === "none") return;
      const id = this.adapter.getRowId(row);
      if (id !== null && this.adapter.isDeletable(id)) ids.push(id);
    });
    return ids;
  }

  private updateBar(): void {
    if (!this.bar) return;
    const count = this.selection.count;
    if (this.countLabel) this.countLabel.textContent = `${count} selected`;
    if (this.actionsGroup) this.actionsGroup.style.display = count > 0 ? "inline-flex" : "none";

    const visibleIds = this.getSelectableVisibleIds();
    const allSelected = visibleIds.length > 0 && visibleIds.every(id => this.selection.isSelected(id));
    if (this.selectAllCheckbox) {
      this.selectAllCheckbox.checked = allSelected;
      this.selectAllCheckbox.indeterminate = count > 0 && !allSelected;
    }
  }
}
