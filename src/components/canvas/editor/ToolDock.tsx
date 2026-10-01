import {
  Cursor01Icon,
  DashboardSquare01Icon,
  CursorMove01Icon,
  Image01Icon,
  Link01Icon,
  Redo02Icon,
  SquareIcon,
  TextFontIcon,
  Undo02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { EntityRef } from "@/lib/canvas/json-canvas";
import { isExternalUrl } from "@/lib/external-url";

import { Island } from "../shell/CanvasShell";
import { EntityPicker } from "./EntityPicker";

/** What a click or drag on the canvas does. Text and Group place a card, then drop back to Select. */
export type CanvasTool = "select" | "hand" | "text" | "group";

/** The dock's single-key shortcuts. */
export const TOOL_KEYS = {
  v: "select",
  h: "hand",
  t: "text",
  g: "group",
  l: "link",
  i: "image",
  e: "entity",
} as const;

function LinkField({ onAdd }: { onAdd: (url: string) => void }) {
  const [url, setUrl] = useState("");
  const valid = isExternalUrl(url.trim());
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onAdd(url.trim());
      }}
    >
      <Input
        // oxlint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        type="url"
        placeholder="https://"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        aria-label="Link address"
      />
      <Button type="submit" disabled={!valid}>
        Add
      </Button>
    </form>
  );
}

function ToolButton({
  label,
  shortcut,
  icon,
  active,
  disabled,
  onClick,
}: {
  label: string;
  shortcut: string;
  icon: typeof Cursor01Icon;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant={active ? "secondary" : "ghost"}
      size="icon"
      tooltip={`${label} (${shortcut})`}
      aria-label={label}
      aria-keyshortcuts={shortcut}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      <HugeiconsIcon icon={icon} size={16} />
    </Button>
  );
}

const Divider = () => <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />;

/** Bottom centre: the tools, then undo and redo. */
export function ToolDock({
  tool,
  onTool,
  atCap,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  linkOpen,
  onLinkOpen,
  onAddLink,
  pickerOpen,
  onPickerOpen,
  onAddEntity,
  imageInput,
  onAddImage,
}: {
  tool: CanvasTool;
  onTool: (tool: CanvasTool) => void;
  atCap: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  linkOpen: boolean;
  onLinkOpen: (open: boolean) => void;
  onAddLink: (url: string) => void;
  pickerOpen: boolean;
  onPickerOpen: (open: boolean) => void;
  onAddEntity: (entity: EntityRef, url: string) => void;
  imageInput: React.RefObject<HTMLInputElement | null>;
  onAddImage: (file: File) => void;
}) {
  return (
    <Island aria-label="Tools" role="toolbar">
      <ToolButton
        label="Select"
        shortcut="V"
        icon={Cursor01Icon}
        active={tool === "select"}
        onClick={() => onTool("select")}
      />
      <ToolButton
        label="Hand"
        shortcut="H"
        icon={CursorMove01Icon}
        active={tool === "hand"}
        onClick={() => onTool("hand")}
      />
      <Divider />
      <ToolButton
        label="Text"
        shortcut="T"
        icon={TextFontIcon}
        active={tool === "text"}
        disabled={atCap}
        onClick={() => onTool("text")}
      />
      <Popover open={linkOpen} onOpenChange={onLinkOpen}>
        <PopoverTrigger
          disabled={atCap}
          aria-label="Link"
          aria-keyshortcuts="L"
          render={
            <Button variant={linkOpen ? "secondary" : "ghost"} size="icon" tooltip="Link (L)" />
          }
        >
          <HugeiconsIcon icon={Link01Icon} size={16} />
        </PopoverTrigger>
        <PopoverContent side="top" sideOffset={12} className="w-80 p-3">
          <LinkField
            onAdd={(url) => {
              onLinkOpen(false);
              onAddLink(url);
            }}
          />
        </PopoverContent>
      </Popover>
      <ToolButton
        label="Image"
        shortcut="I"
        icon={Image01Icon}
        disabled={atCap}
        onClick={() => imageInput.current?.click()}
      />
      <input
        ref={imageInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onAddImage(file);
          e.target.value = "";
        }}
      />
      <ToolButton
        label="Group"
        shortcut="G"
        icon={SquareIcon}
        active={tool === "group"}
        disabled={atCap}
        onClick={() => onTool("group")}
      />
      <ToolButton
        label="Live card: a jam, team, member or post"
        shortcut="E"
        icon={DashboardSquare01Icon}
        active={pickerOpen}
        disabled={atCap}
        onClick={() => onPickerOpen(true)}
      />
      <Divider />
      <ToolButton
        label="Undo"
        shortcut="⌘Z"
        icon={Undo02Icon}
        disabled={!canUndo}
        onClick={onUndo}
      />
      <ToolButton
        label="Redo"
        shortcut="⇧⌘Z"
        icon={Redo02Icon}
        disabled={!canRedo}
        onClick={onRedo}
      />
      {pickerOpen ? (
        <EntityPicker
          open
          onClose={() => onPickerOpen(false)}
          onPick={(entity, url) => {
            onPickerOpen(false);
            onAddEntity(entity, url);
          }}
        />
      ) : null}
    </Island>
  );
}
