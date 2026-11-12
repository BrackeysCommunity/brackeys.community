import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  SidebarLeftIcon,
  SidebarRightIcon,
} from "@hugeicons/core-free-icons";
import { useEffect, useMemo, type CSSProperties } from "react";

import {
  cx,
  IconButton,
  MenuItem,
  MenuSeparator,
  TabPanel,
  Tabs,
  type TabItem,
} from "../kit/index";
import {
  movePanel,
  selectTab,
  toggleColumn,
  toggleGroup,
  type Side,
  type Viewport,
} from "../layout/model";
import type { LayoutState } from "../layout/use-layout";
import { PANELS, type PanelContext, type PanelDef } from "../panels/registry";
import { usePendingTasks } from "../pending/use-pending";
import { usePanelBadges } from "./badges";

export type PanelGroupProps = {
  side: Side;
  /** The column's top (0) or bottom (1) group. */
  index: 0 | 1;
  /** The viewer's layout, from `useLayout`; every tab, move and collapse edits it. */
  layout: LayoutState;
  /** The window the layout is fitted to, for opening and closing the column. */
  viewport: Viewport;
  ctx: PanelContext;
  /** The panels the layout's ids name; default `PANELS`. */
  panels?: readonly PanelDef[];
  /** Draws each panel's skeleton in place of its body. */
  booting?: boolean;
  className?: string;
  /** The fitted position and size, as inline px. */
  style?: CSSProperties;
};

/**
 * One tab group of a column: its strip (title, badge, busy spinner, the
 * tab's menu, collapse) over the panels' bodies. Every panel in the group
 * stays mounted; only the active one shows.
 */
export function PanelGroup({
  side,
  index,
  layout: state,
  viewport,
  ctx,
  panels = PANELS,
  booting = false,
  className,
  style,
}: PanelGroupProps) {
  const { layout, update, reset } = state;
  const column = layout[side];
  const group = column.groups[index];
  const ids = group?.panels;
  const defs = useMemo(
    () =>
      (ids ?? []).flatMap((id) => {
        const def = panels.find((p) => p.id === id);
        return def ? [def] : [];
      }),
    [ids, panels],
  );
  const badges = usePanelBadges(defs, ctx);
  const tasks = usePendingTasks();

  useEffect(() => {
    const offs = defs.flatMap((def) =>
      def.follow ? [def.follow(ctx, () => update((l) => selectTab(l, def.id)))] : [],
    );
    return () => {
      for (const off of offs) off();
    };
  }, [defs, ctx, update]);

  if (!group || defs.length === 0) return null;

  const active = defs.some((d) => d.id === group.active) ? group.active : defs[0]!.id;
  const otherGroup: 0 | 1 = index === 0 ? 1 : 0;
  const lonely = column.groups.length === 1 && defs.length === 1;
  const where = side === "left" ? "Left" : "Right";
  const sideIcon = side === "left" ? SidebarLeftIcon : SidebarRightIcon;

  const items: TabItem[] = defs.map((def, i) => ({
    value: def.id,
    label: def.title,
    icon: def.icon,
    badge: badges[i] ?? null,
    busy: def.busyScope ? tasks.some((t) => t.scope === def.busyScope) : false,
    menu: (
      <>
        <MenuItem
          disabled={lonely}
          onClick={() => update((l) => movePanel(l, def.id, { side, group: otherGroup }))}
        >
          {otherGroup === 0 ? "Move to top group" : "Move to bottom group"}
        </MenuItem>
        <MenuSeparator />
        <MenuItem onClick={reset}>Reset layout</MenuItem>
      </>
    ),
  }));

  return (
    <div
      data-je-region=""
      data-collapsed={group.collapsed || undefined}
      className={cx("je-island je-panel-group", className)}
      style={style}
    >
      <Tabs
        label={`${where} column, ${index === 0 ? "top" : "bottom"} group`}
        value={active}
        onValueChange={(id) => update((l) => selectTab(l, id))}
        items={items}
        end={
          <>
            <IconButton
              size="icon-xs"
              variant="ghost"
              icon={group.collapsed ? ArrowRight01Icon : ArrowDown01Icon}
              label={group.collapsed ? "Expand group" : "Collapse group"}
              aria-expanded={!group.collapsed}
              onClick={() => update((l) => toggleGroup(l, side, index))}
            />
            {index === 0 ? (
              <IconButton
                size="icon-xs"
                variant="ghost"
                icon={sideIcon}
                label={`Collapse the ${side} column`}
                onClick={() => update((l) => toggleColumn(l, side, viewport))}
              />
            ) : null}
          </>
        }
      >
        {defs.map((def) => (
          <TabPanel key={def.id} value={def.id} className="je-panel-body">
            {booting && def.skeleton ? def.skeleton() : def.render(ctx)}
          </TabPanel>
        ))}
      </Tabs>
    </div>
  );
}
