import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Route } from "@/generators/routes-generator";
import { notifyWorldChanged } from "../world-state";
import { RoutesOverview } from "./RoutesOverview";

const globalScope = globalThis as Record<string, unknown>;

// Three displayable routes plus a point-less stub the legacy overview skipped
// (it renders no row but IS counted in the footer totals).
let routesData: Route[];

function makeRoutes(): Route[] {
  return [
    {
      i: 1,
      group: "roads",
      feature: 1,
      points: [
        [0, 0, 1],
        [10, 0, 2]
      ],
      name: "North Road",
      length: 200
    },
    {
      i: 2,
      group: "trails",
      feature: 1,
      points: [
        [0, 5, 3],
        [8, 5, 4]
      ],
      name: "Goat Trail",
      length: 50,
      lock: true
    },
    {
      i: 3,
      group: "searoutes",
      feature: 2,
      points: [
        [0, 9, 5],
        [20, 9, 6]
      ],
      name: "Amber Lane",
      length: 120
    },
    { i: 4, group: "roads", feature: 1, points: [[1, 1, 7]], name: "Broken Stub", length: undefined }
  ] as Route[];
}

beforeEach(() => {
  routesData = makeRoutes();
  globalScope.pack = { routes: routesData, cells: { routes: {} } };
  globalScope.distanceScale = 1;
  globalScope.distanceUnitInput = { value: "km" };
  globalScope.customization = 0;
  globalScope.tip = vi.fn();
  globalScope.Routes = {
    generateName: vi.fn(() => "Fresh Way"),
    getLength: vi.fn(() => 77),
    remove: vi.fn((route: Route) => {
      const index = routesData.indexOf(route);
      if (index >= 0) routesData.splice(index, 1);
    }),
    buildLinks: vi.fn(() => ({}))
  };
});

afterEach(() => {
  globalScope.pack = undefined;
  globalScope.distanceScale = undefined;
  globalScope.distanceUnitInput = undefined;
  globalScope.customization = undefined;
  globalScope.tip = undefined;
  globalScope.Routes = undefined;
  globalScope.confirmationDialog = undefined;
  globalScope.downloadFile = undefined;
  globalScope.getFileName = undefined;
  globalScope.editRoute = undefined;
});

function rowNames(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll(".states")).map(row => row.getAttribute("data-name"));
}

describe("<RoutesOverview>", () => {
  it("renders one row per displayable route, sorted by length descending by default", () => {
    const { container } = render(<RoutesOverview onClose={() => {}} />);

    // The point-less stub renders no row; default sort is the legacy header's
    // icon-sort-number-down on Length (descending).
    expect(rowNames(container)).toEqual(["North Road", "Amber Lane", "Goat Trail"]);
    // Scaled length labels (distanceScale 1, unit km).
    expect(screen.getByText("200 km")).toBeTruthy();
  });

  it("counts every filtered route (including point-less ones) in the footer", () => {
    render(<RoutesOverview onClose={() => {}} />);
    expect(screen.getByText("4 of 4")).toBeTruthy();
    // Average = rn(mean(200, 50, 120)) = 123 (the stub has no measured length).
    expect(screen.getByText("123 km")).toBeTruthy();
  });

  it("filters rows by name or group text", () => {
    const { container } = render(<RoutesOverview onClose={() => {}} />);
    const searchInput = screen.getByRole("searchbox") as HTMLInputElement;

    // "trail" matches the Goat Trail name and the trails group.
    fireEvent.change(searchInput, { target: { value: "trail" } });
    expect(rowNames(container)).toEqual(["Goat Trail"]);
    expect(screen.getByText("1 of 4")).toBeTruthy();

    // "roads" matches the roads group: North Road plus the point-less stub
    // (counted, not rendered).
    fireEvent.change(searchInput, { target: { value: "roads" } });
    expect(rowNames(container)).toEqual(["North Road"]);
    expect(screen.getByText("2 of 4")).toBeTruthy();
  });

  it("sorts alphabetically when the Route header is clicked", () => {
    const { container } = render(<RoutesOverview onClose={() => {}} />);

    fireEvent.click(container.querySelector('[data-sortby="name"]') as HTMLElement);
    expect(rowNames(container)).toEqual(["Amber Lane", "Goat Trail", "North Road"]);
    // Clicking again flips to descending.
    fireEvent.click(container.querySelector('[data-sortby="name"]') as HTMLElement);
    expect(rowNames(container)).toEqual(["North Road", "Goat Trail", "Amber Lane"]);
  });

  it("toggles a route's lock and re-renders the lock icon", () => {
    const { container } = render(<RoutesOverview onClose={() => {}} />);

    const northRow = container.querySelector('[data-id="1"]') as HTMLElement;
    const lockIcon = northRow.querySelector(".locks") as HTMLElement;
    expect(lockIcon.classList.contains("icon-lock-open")).toBe(true);

    fireEvent.click(lockIcon);
    expect(routesData.find(route => route.i === 1)?.lock).toBe(true);
    const relockedIcon = (container.querySelector('[data-id="1"]') as HTMLElement).querySelector(".locks");
    expect(relockedIcon?.classList.contains("icon-lock")).toBe(true);
  });

  it("locks all routes, then unlocks all on the next click", () => {
    render(<RoutesOverview onClose={() => {}} />);
    const lockAll = screen.getByLabelText("Lock or unlock all routes");

    fireEvent.click(lockAll);
    expect(routesData.every(route => route.lock)).toBe(true);
    fireEvent.click(lockAll);
    expect(routesData.every(route => !route.lock)).toBe(true);
  });

  it("removes a route after confirmation and drops its row", () => {
    const confirmSpy = vi.fn((options: { onConfirm: () => void }) => options.onConfirm());
    globalScope.confirmationDialog = confirmSpy;
    const { container } = render(<RoutesOverview onClose={() => {}} />);

    const northRow = container.querySelector('[data-id="1"]') as HTMLElement;
    fireEvent.click(northRow.querySelector('[aria-label="Remove route"]') as HTMLElement);

    expect(confirmSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Remove route", confirm: "Remove" }));
    expect((globalScope.Routes as { remove: ReturnType<typeof vi.fn> }).remove).toHaveBeenCalled();
    expect(rowNames(container)).toEqual(["Amber Lane", "Goat Trail"]);
  });

  it("removes all unlocked routes (locked kept) and rebuilds the cell links", () => {
    globalScope.confirmationDialog = vi.fn((options: { title: string; onConfirm: () => void }) => {
      expect(options.title).toBe("Remove unlocked routes");
      options.onConfirm();
    });
    const { container } = render(<RoutesOverview onClose={() => {}} />);

    fireEvent.click(screen.getByLabelText("Remove all unlocked routes"));

    // Goat Trail is locked and survives; the links index is rebuilt once.
    expect(rowNames(container)).toEqual(["Goat Trail"]);
    expect((globalScope.Routes as { buildLinks: ReturnType<typeof vi.fn> }).buildLinks).toHaveBeenCalledTimes(1);
  });

  it("tips an error instead of confirming when every route is locked", () => {
    for (const route of routesData) route.lock = true;
    const confirmSpy = vi.fn();
    globalScope.confirmationDialog = confirmSpy;
    render(<RoutesOverview onClose={() => {}} />);

    fireEvent.click(screen.getByLabelText("Remove all unlocked routes"));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(globalScope.tip).toHaveBeenCalledWith(
      "All routes are locked. Unlock routes to remove them, or use Lock all to unlock first.",
      false,
      "error"
    );
  });

  it("exports the visible rows as CSV in the current sort order", () => {
    const download = vi.fn();
    globalScope.downloadFile = download;
    globalScope.getFileName = (name?: string) => name ?? "";

    render(<RoutesOverview onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("Export as CSV"));

    const expectedCsv =
      "Id,Route,Group,Length\n" +
      "1,North Road,roads,200 km\n" +
      "3,Amber Lane,searoutes,120 km\n" +
      "2,Goat Trail,trails,50 km\n";
    expect(download).toHaveBeenCalledWith(expectedCsv, "Routes.csv");
  });

  it("opens the route editor for a row through the editRoute global", () => {
    const editSpy = vi.fn();
    globalScope.editRoute = editSpy;
    const { container } = render(<RoutesOverview onClose={() => {}} />);

    const northRow = container.querySelector('[data-id="1"]') as HTMLElement;
    fireEvent.click(northRow.querySelector('[aria-label="Edit route"]') as HTMLElement);
    expect(editSpy).toHaveBeenCalledWith("route1");
  });

  it("materializes and persists a missing route name and length (legacy parity)", () => {
    routesData.push({
      i: 5,
      group: "trails",
      feature: 3,
      points: [
        [0, 0, 8],
        [4, 4, 9]
      ]
    } as Route);
    const { container } = render(<RoutesOverview onClose={() => {}} />);

    expect(rowNames(container)).toContain("Fresh Way");
    const materialized = routesData.find(route => route.i === 5);
    expect(materialized?.name).toBe("Fresh Way");
    expect(materialized?.length).toBe(77);
  });

  it("bulk mode: selects all visible rows and deletes the unlocked ones", () => {
    globalScope.confirmationDialog = vi.fn((options: { onConfirm: () => void }) => options.onConfirm());
    const { container } = render(<RoutesOverview onClose={() => {}} />);

    fireEvent.click(screen.getByLabelText("Bulk select"));
    expect(container.querySelectorAll(".bulkRowCheckbox").length).toBe(3);

    fireEvent.click(container.querySelector(".bulkSelectAllCheckbox") as HTMLElement);
    expect(screen.getByText("3 selected")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Delete selected rows"));

    // North Road and Amber Lane (unlocked) are removed; locked Goat Trail is
    // skipped and stays selected, exactly like the legacy bulk bar.
    expect(rowNames(container)).toEqual(["Goat Trail"]);
    expect(screen.getByText("1 selected")).toBeTruthy();
  });

  it("bulk mode: select-all only covers the visible (filtered) rows", () => {
    const { container } = render(<RoutesOverview onClose={() => {}} />);

    fireEvent.click(screen.getByLabelText("Bulk select"));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "trail" } });
    fireEvent.click(container.querySelector(".bulkSelectAllCheckbox") as HTMLElement);

    expect(screen.getByText("1 selected")).toBeTruthy();
  });

  it("bulk mode: locks the selected rows", () => {
    const { container } = render(<RoutesOverview onClose={() => {}} />);

    fireEvent.click(screen.getByLabelText("Bulk select"));
    const northCheckbox = (container.querySelector('[data-id="1"]') as HTMLElement).querySelector(
      ".bulkRowCheckbox"
    ) as HTMLElement;
    fireEvent.click(northCheckbox);
    fireEvent.click(screen.getByLabelText("Lock selected rows"));

    expect(routesData.find(route => route.i === 1)?.lock).toBe(true);
    expect(routesData.find(route => route.i === 3)?.lock).toBeFalsy();
  });

  it("bulk mode: exiting clears the selection", () => {
    const { container } = render(<RoutesOverview onClose={() => {}} />);

    fireEvent.click(screen.getByLabelText("Bulk select"));
    fireEvent.click(container.querySelector(".bulkSelectAllCheckbox") as HTMLElement);
    expect(screen.getByText("3 selected")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Bulk select")); // off
    fireEvent.click(screen.getByLabelText("Bulk select")); // on again
    expect(screen.getByText("0 selected")).toBeTruthy();
  });

  it("re-reads when the routes change underneath it (reactivity)", () => {
    const { container } = render(<RoutesOverview onClose={() => {}} />);
    expect(container.querySelectorAll(".states").length).toBe(3);

    act(() => {
      routesData.push({
        i: 6,
        group: "roads",
        feature: 1,
        points: [
          [0, 0, 1],
          [5, 5, 2]
        ],
        name: "New Road",
        length: 10
      } as Route);
      notifyWorldChanged();
    });

    expect(container.querySelectorAll(".states").length).toBe(4);
    expect(screen.getByText("5 of 5")).toBeTruthy();
  });

  it("renders an empty table when no world is loaded instead of throwing", () => {
    globalScope.pack = undefined;
    const { container } = render(<RoutesOverview onClose={() => {}} />);
    expect(container.querySelectorAll(".states").length).toBe(0);
    expect(screen.getByText("0 of 0")).toBeTruthy();
  });
});
