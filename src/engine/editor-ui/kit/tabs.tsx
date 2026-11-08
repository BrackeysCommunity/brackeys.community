import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { MoreHorizontalIcon } from "@hugeicons/core-free-icons";
import { useState, type ReactNode } from "react";

import { useKit } from "./context";
import { cx } from "./cx";
import { Hint } from "./hint";
import { Icon, type IconSvgElement } from "./icon";
import { MenuContent } from "./menu";
import { Spinner } from "./spinner";

export type TabBadge = { count: number; tone: "danger" | "warning" | "muted" };

export type TabItem = {
  value: string;
  label: string;
  icon?: IconSvgElement;
  /** A count after the label; hidden at zero. */
  badge?: TabBadge | null;
  /** Work in this tab's scope is running: a spinner in place of the icon. */
  busy?: boolean;
  /** The tab's menu items, opened from the strip's menu button or a right-click on the tab. */
  menu?: ReactNode;
};

export type TabsProps = {
  value: string;
  onValueChange: (value: string) => void;
  items: readonly TabItem[];
  /** The strip's accessible name. */
  label: string;
  /** Controls at the strip's end (a collapse chevron). */
  end?: ReactNode;
  className?: string;
  /** The `TabPanel`s. */
  children?: ReactNode;
};

/**
 * A tab strip (`--je-tab` tall) over its panels. Arrow keys move between
 * tabs and select as they go; each change sounds the `tab` cue.
 */
export function Tabs({ value, onValueChange, items, label, end, className, children }: TabsProps) {
  const kit = useKit();
  const [menu, setMenu] = useState<{ tab: string; anchor: Element | null } | null>(null);
  const active = items.find((item) => item.value === value);
  const menuTab = items.find((item) => item.value === (menu?.tab ?? value));

  return (
    <TabsPrimitive.Root
      value={value}
      onValueChange={(next) => {
        if (next === value || typeof next !== "string") return;
        kit.cue("tab");
        onValueChange(next);
      }}
      className={cx("je-tabs", className)}
    >
      <div className="je-tab-strip">
        <TabsPrimitive.List className="je-tab-list" activateOnFocus aria-label={label}>
          {items.map((item) => (
            <TabsPrimitive.Tab
              key={item.value}
              value={item.value}
              className="je-tab"
              aria-busy={item.busy || undefined}
              onContextMenu={(event) => {
                if (!item.menu) return;
                event.preventDefault();
                setMenu({ tab: item.value, anchor: event.currentTarget });
              }}
            >
              {item.busy ? (
                <Spinner size={12} label={null} />
              ) : item.icon ? (
                <Icon icon={item.icon} size={12} />
              ) : null}
              <span className="je-tab-label">{item.label}</span>
              {item.badge && item.badge.count > 0 ? (
                <span className="je-tab-badge" data-tone={item.badge.tone}>
                  {item.badge.count}
                </span>
              ) : null}
            </TabsPrimitive.Tab>
          ))}
        </TabsPrimitive.List>
        {active?.menu || menu ? (
          <MenuPrimitive.Root
            open={menu !== null}
            onOpenChange={(open) => setMenu(open ? { tab: value, anchor: null } : null)}
          >
            {active?.menu ? (
              <Hint content={`${active.label} options`}>
                <MenuPrimitive.Trigger
                  className="je-btn je-tab-menu"
                  data-variant="ghost"
                  data-size="icon-xs"
                  aria-label={`${active.label} options`}
                >
                  <Icon icon={MoreHorizontalIcon} size={12} />
                </MenuPrimitive.Trigger>
              </Hint>
            ) : null}
            <MenuContent align="end" anchor={menu?.anchor ?? undefined}>
              {menuTab?.menu}
            </MenuContent>
          </MenuPrimitive.Root>
        ) : null}
        {end ? <div className="je-tab-end">{end}</div> : null}
      </div>
      {children}
    </TabsPrimitive.Root>
  );
}

/** A tab's body. It stays mounted while another tab shows, so its scroll and drafts survive. */
export function TabPanel({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <TabsPrimitive.Panel value={value} keepMounted className={cx("je-tab-panel", className)}>
      {children}
    </TabsPrimitive.Panel>
  );
}
