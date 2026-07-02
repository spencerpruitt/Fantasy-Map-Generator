import { openSurface } from "@/ui/app-shell/registry";

/**
 * One stratifiable element of a hierarchy — a culture or religion record as the
 * calling editor passes it. `origins[0]` is the primary origin (the tree
 * parent); further entries are secondary origins (dashed links). The root
 * element has `i === 0`.
 */
export type HierarchyElement = {
  i: number;
  name: string;
  code?: string;
  color?: string;
  cells?: number;
  removed?: boolean;
  origins: (number | null)[];
  [key: string]: unknown;
};

export type OpenProps = {
  type: string;
  data: HierarchyElement[];
  onNodeEnter: (d: any) => void;
  onNodeLeave: (d: any) => void;
  getDescription: (dataElement: HierarchyElement) => string;
  getShape: (dataElement: HierarchyElement) => string | undefined;
};

/**
 * open — the preserved trigger seam for the Hierarchy Tree surface.
 *
 * The signature is unchanged from the legacy jQuery-UI version so its callers —
 * the cultures and religions editors' hierarchy buttons — keep calling
 * `open(props)` untouched. The body keeps the legacy open side-effects (close
 * other legacy dialogs, reject a hierarchy of fewer than three elements with
 * the same tip) and dispatches into the App shell, which mounts the React
 * <HierarchyTree> surface. The props (data array, editor callbacks, shape and
 * description getters) are carried opaquely through the registry; the tree
 * reads and mutates the SAME element objects the editor passed, exactly as the
 * legacy module did.
 */
export function open(props: OpenProps): void {
  closeDialogs(".stable");

  const validCount = props.data.filter(element => !element.removed).length;
  if (validCount < 3) {
    tip(`Not enough ${props.type} to show hierarchy`, false, "error");
    return;
  }

  openSurface("hierarchy-tree", { ...props, anchor: "svg" });
}
