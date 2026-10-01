import { useReactFlow, useStore } from "@xyflow/react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const PRESETS = [0.5, 1, 2];

/** The zoom percent, and a menu to change it. */
export function ZoomMenu() {
  const flow = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  const percent = `${Math.round(zoom * 100)}%`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Zoom, ${percent}`}
        render={<Button variant="ghost" size="sm" className="w-14 tabular-nums" tooltip="Zoom" />}
      >
        {percent}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="min-w-48">
        <DropdownMenuItem onClick={() => void flow.zoomIn({ duration: 150 })}>
          Zoom in
          <DropdownMenuShortcut>⌘+</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void flow.zoomOut({ duration: 150 })}>
          Zoom out
          <DropdownMenuShortcut>⌘−</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void flow.fitView({ duration: 200 })}>
          Fit to screen
          <DropdownMenuShortcut>⌘0</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {PRESETS.map((level) => (
          <DropdownMenuItem key={level} onClick={() => void flow.zoomTo(level, { duration: 150 })}>
            {level * 100}%
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
