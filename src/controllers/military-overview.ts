import { openSurface } from "@/ui/app-shell/registry";
import { notifyWorldChanged } from "@/ui/world-state";
import { ensureEl, sanitizeId } from "../utils";

/**
 * open — the preserved trigger seam for the Military Overview surface.
 *
 * The signature is unchanged from the legacy version so the callers (the menu's
 * `overviewMilitary()` in editors.js, the tools button, and the Shift+M hotkey)
 * keep calling `MilitaryOverview.open()` untouched. The body keeps the legacy
 * open side-effects — no-op during customization, close other legacy dialogs,
 * and force the states/borders/military layers on so the region and army
 * elements exist for the row-hover highlights — then dispatches into the App
 * shell, which mounts the React <MilitaryOverview> surface. All world reads and
 * the war-alert mutation live inside the surface, behind the World-State
 * accessor; the legacy `refresh` entry point is gone — editors signal
 * `notifyWorldChanged()` instead and the surface re-reads.
 */
function open(): void {
  if (customization) return;
  closeDialogs(".stable");
  if (!layerIsOn("toggleStates")) toggleStates();
  if (!layerIsOn("toggleBorders")) toggleBorders();
  if (!layerIsOn("toggleMilitary")) toggleMilitary();
  openSurface("military-overview", { anchor: "svg" });
}

/**
 * openOptions — the legacy "Edit Military Units" dialog (`#militaryOptions`),
 * unchanged apart from its exit: applying now regenerates forces through the
 * domain core and signals `notifyWorldChanged()` so the React overview re-reads
 * (instead of the deleted updateHeaders/refresh pair). This is a still-legacy
 * sibling dialog, not part of the overview surface — it converts in Phase 4
 * with the other mutating editors.
 */
function openOptions(): void {
  const types = ["melee", "ranged", "mounted", "machinery", "naval", "armored", "aviation", "magical"];
  const tableBody = ensureEl("militaryOptions").querySelector("tbody")!;
  removeUnitLines();
  options.military.map(unit => addUnitLine(unit));

  $("#militaryOptions").dialog({
    title: "Edit Military Units",
    resizable: false,
    width: fitContent(),
    position: { my: "center", at: "center", of: "svg" },
    buttons: {
      Apply: applyMilitaryOptions,
      Add: () =>
        addUnitLine({
          icon: "🛡️",
          name: `custom${ensureEl<HTMLTableElement>("militaryOptionsTable").rows.length}`,
          rural: 0.2,
          urban: 0.5,
          crew: 1,
          power: 1,
          type: "melee",
          separate: 0
        }),
      Restore: restoreDefaultUnits,
      Cancel: function () {
        $(this).dialog("close");
      }
    },
    open: function () {
      const buttons = $(this).dialog("widget").find(".ui-dialog-buttonset > button");
      buttons[0].addEventListener("mousemove", () =>
        tip("Apply military units settings. <span style='color:#cb5858'>All forces will be recalculated!</span>")
      );
      buttons[1].addEventListener("mousemove", () => tip("Add new military unit to the table"));
      buttons[2].addEventListener("mousemove", () => tip("Restore default military units and settings"));
      buttons[3].addEventListener("mousemove", () => tip("Close the window without saving the changes"));
    }
  });

  if (modules.overviewMilitaryCustomize) return;
  modules.overviewMilitaryCustomize = true;

  tableBody.addEventListener("click", event => {
    const el = event.target as HTMLElement;
    if (el.tagName !== "BUTTON") return;
    const type = el.dataset.type;

    if (type === "icon") {
      selectIcon(el.textContent || "", value => {
        el.innerHTML =
          value.startsWith("http") || value.startsWith("data:image")
            ? `<img src="${value}" style="width:1.2em;height:1.2em;pointer-events:none;">`
            : value;
      });
      return;
    }

    if (type === "biomes") {
      const { i, name, color } = biomesData;
      const biomes = Array(i.length)
        .fill(null)
        .map((_, idx) => ({ i: idx, name: name[idx], color: color[idx] }));
      selectLimitation(el, biomes);
      return;
    }
    if (type === "states") return selectLimitation(el, pack.states);
    if (type === "cultures") return selectLimitation(el, pack.cultures);
    if (type === "religions") return selectLimitation(el, pack.religions);
  });

  function removeUnitLines(): void {
    tableBody.querySelectorAll("tr").forEach(el => {
      el.remove();
    });
  }

  function getLimitValue(attr?: number[]): string {
    return attr?.join(",") || "";
  }

  function getLimitText(attr?: number[]): string {
    return attr?.length ? "some" : "all";
  }

  function getLimitTip(attr: number[] | undefined, data: { name?: string }[] | undefined): string {
    if (!attr?.length) return "";
    return attr.map(i => data?.[i]?.name || "").join(", ");
  }

  function addUnitLine(unit: MilitaryUnit): void {
    const { type, icon, name, rural, urban, power, crew, separate } = unit;
    const row = document.createElement("tr");
    const typeOptions = types.map(t => `<option ${type === t ? "selected" : ""} value="${t}">${t}</option>`).join(" ");

    const getLimitButton = (attr: "biomes" | "states" | "cultures" | "religions"): string => {
      const data = attr === "biomes" ? [] : (pack[attr] as { name?: string }[]);
      return `<button
          data-tip="Select allowed ${attr}"
          data-type="${attr}"
          title="${getLimitTip(unit[attr], data)}"
          data-value="${getLimitValue(unit[attr])}">
          ${getLimitText(unit[attr])}
        </button>`;
    };

    row.innerHTML = /* html */ `<td>
          <button data-type="icon" data-tip="Click to select unit icon">
            ${
              icon.startsWith("http") || icon.startsWith("data:image")
                ? `<img src="${icon}" style="width:1.2em;height:1.2em;pointer-events:none;">`
                : icon || ""
            }
          </button>
        </td>
        <td><input data-tip="Type unit name. If name is changed for existing unit, old unit will be replaced" value="${name}" /></td>
        <td>${getLimitButton("biomes")}</td>
        <td>${getLimitButton("states")}</td>
        <td>${getLimitButton("cultures")}</td>
        <td>${getLimitButton("religions")}</td>
        <td><input data-tip="Enter conscription percentage for rural population" type="number" min="0" max="100" step=".01" value="${rural}" /></td>
        <td><input data-tip="Enter conscription percentage for urban population" type="number" min="0" max="100" step=".01" value="${urban}" /></td>
        <td><input data-tip="Enter average number of people in crew (for total personnel calculation)" type="number" min="1" step="1" value="${crew}" /></td>
        <td><input data-tip="Enter military power (used for battle simulation)" type="number" min="0" step=".1" value="${power}" /></td>
        <td>
          <select data-tip="Select unit type to apply special rules on forces recalculation">
            ${typeOptions}
          </select>
        </td>
        <td data-tip="Check if unit is <b>separate</b> and can be stacked only with the same units">
          <input id="${name}Separate" type="checkbox" class="checkbox" ${separate ? "checked" : ""} />
          <label for="${name}Separate" class="checkbox-label"></label>
        </td>
        <td data-tip="Remove the unit">
          <span data-tip="Remove unit type" class="icon-trash-empty pointer" onclick="this.parentElement.parentElement.remove();"></span>
        </td>`;
    tableBody.appendChild(row);
  }

  function restoreDefaultUnits(): void {
    removeUnitLines();
    Military.getDefaultOptions().map((unit: MilitaryUnit) => addUnitLine(unit));
  }

  function selectLimitation(
    el: HTMLElement,
    data: { i: number; name?: string; fullName?: string; color?: string; removed?: boolean }[]
  ): void {
    const type = el.dataset.type!;
    const value = el.dataset.value;
    const initial = value ? value.split(",").map(v => +v) : [];

    const filtered = data.filter(datum => datum.i && !datum.removed);
    const lines = filtered.map(
      ({ i, name, fullName, color }) => /* html */ `
          <tr data-tip="${name}">
            <td><span style="color:${color}">⬤</span></td>
            <td>
              <input data-i="${i}" id="el${i}" type="checkbox" class="checkbox"
                ${!initial.length || initial.includes(i) ? "checked" : ""} >
              <label for="el${i}" class="checkbox-label">${fullName || name}</label>
            </td>
          </tr>`
    );

    ensureEl("alertMessage").innerHTML = /* html */ `<b>Limit unit by ${type}:</b>
        <table style="margin-top:.3em">
          <tbody>
            ${lines.join("")}
          </tbody>
        </table>`;

    $("#alert").dialog({
      width: fitContent(),
      title: "Limit unit",
      buttons: {
        Invert: () => {
          alertMessage.querySelectorAll<HTMLInputElement>("input").forEach(el => {
            el.checked = !el.checked;
          });
        },
        Apply: function () {
          const inputs = Array.from(alertMessage.querySelectorAll<HTMLInputElement>("input"));
          const selected = inputs.reduce<string[]>((acc, input) => {
            if (input.checked) acc.push(input.dataset.i!);
            return acc;
          }, []);

          if (!selected.length) {
            tip("Select at least one element", false, "error");
            return;
          }

          const allAreSelected = selected.length === inputs.length;
          el.dataset.value = allAreSelected ? "" : selected.join(",");
          el.innerHTML = allAreSelected ? "all" : "some";
          el.setAttribute("title", getLimitTip(selected.map(Number), data));
          $(this).dialog("close");
        },
        Cancel: function () {
          $(this).dialog("close");
        }
      }
    });
  }

  function applyMilitaryOptions(): void {
    const unitLines = Array.from(tableBody.querySelectorAll("tr"));
    const names = unitLines.map(r => sanitizeId(r.querySelector("input")!.value));
    if (new Set(names).size !== names.length) {
      tip("All units should have unique names", false, "error");
      return;
    }

    $("#militaryOptions").dialog("close");

    options.military = unitLines.map((r, i) => {
      const elements = Array.from(
        r.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("input, button, select")
      );
      const values = elements.map(el => {
        const { type, value } = (el as HTMLElement).dataset || {};
        if (type === "icon") {
          const html = el.innerHTML.trim();
          const isImage = html.startsWith("<img");
          return isImage ? html.match(/src="([^"]*)"/)![1] : html || "⠀";
        }
        if (type) return value ? value.split(",").map(v => parseInt(v, 10)) : null;
        if ((el as HTMLInputElement).type === "number") return +(el as HTMLInputElement).value || 0;
        if ((el as HTMLInputElement).type === "checkbox") return +(el as HTMLInputElement).checked || 0;
        return (el as HTMLInputElement).value;
      }) as [
        string,
        undefined,
        number[] | null,
        number[] | null,
        number[] | null,
        number[] | null,
        number,
        number,
        number,
        number,
        string,
        number
      ];
      const [icon, , biomes, states, cultures, religions, rural, urban, crew, power, type, separate] = values;

      const unit: MilitaryUnit = {
        icon,
        name: names[i],
        rural,
        urban,
        crew,
        power,
        type,
        separate
      };
      if (biomes) unit.biomes = biomes;
      if (states) unit.states = states;
      if (cultures) unit.cultures = cultures;
      if (religions) unit.religions = religions;
      return unit;
    });
    localStorage.setItem("military", JSON.stringify(options.military));
    Military.generate();
    // The React overview (and any other open surface) re-reads on this signal —
    // it replaces the legacy updateHeaders() + refreshMilitaryOverview() pair.
    notifyWorldChanged();
  }
}

export const MilitaryOverview = { open, openOptions };
