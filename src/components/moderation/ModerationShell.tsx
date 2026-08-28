import { ViewIcon, ViewOffSlashIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MarkedText, MicroLabel, Text } from "@/components/ui/typography";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import { Well } from "@/components/ui/well";
import { useIsMobile } from "@/lib/hooks/use-mobile";
import { cn } from "@/lib/utils";

export type ModerationTab = {
  key: string;
  label: string;
  content: React.ReactNode;
};

/**
 * The chrome every staff moderation surface shares: a modal on desktop, a
 * drawer on mobile, with the sections behind a tab strip either way. Every
 * panel stays mounted so half-typed fields survive a tab switch.
 */
export function ModerationShell({
  open,
  onClose,
  title,
  description,
  tabs,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  tabs: ModerationTab[];
}) {
  const isMobile = useIsMobile();
  const [active, setActive] = useState(tabs[0]?.key ?? "");
  // The tab set can shrink under us (the admin-only tabs drop out once the
  // staff query resolves for a mod) — fall back rather than render nothing.
  const activeKey = tabs.some((t) => t.key === active) ? active : (tabs[0]?.key ?? "");

  const body = (
    <>
      <div className="shrink-0 px-5 pb-3">
        <Well
          variant="ghost"
          className="border-destructive/40 bg-destructive/5 p-3 backdrop-blur-none"
        >
          <Text size="xs" className="tracking-widest text-destructive uppercase">
            Staff override — actions are logged
          </Text>
        </Well>
      </div>
      <UnderlineTabs
        tabs={tabs.map(({ key, label }) => ({ key, label }))}
        active={activeKey}
        onSelect={setActive}
        label="Moderation section"
        className="shrink-0 px-5"
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {tabs.map((tab) => (
          <div
            key={tab.key}
            role="tabpanel"
            className={cn(tab.key === activeKey ? "flex flex-col gap-6" : "hidden")}
          >
            {tab.content}
          </div>
        ))}
      </div>
    </>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
        <DrawerContent className="max-h-[88vh] p-0">
          <DrawerDescription className="sr-only">{description}</DrawerDescription>
          <div className="flex min-h-0 flex-1 flex-col pt-3 pb-[env(safe-area-inset-bottom)]">
            <div className="shrink-0 py-3 pr-3 pl-5">
              <DrawerTitle className="text-base tracking-widest text-foreground uppercase">
                {title}
              </DrawerTitle>
            </div>
            {body}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      {/* Top-anchored: tabs vary in height, so the top edge stays put and
          only the bottom grows and shrinks with the active panel. */}
      <DialogContent className="top-24 flex max-h-[calc(100vh-8rem)] translate-y-0 flex-col gap-0 p-0 sm:max-w-3xl">
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <div className="shrink-0 py-4 pr-12 pl-5">
          <DialogTitle className="text-base tracking-widest text-foreground uppercase">
            {title}
          </DialogTitle>
        </div>
        {body}
      </DialogContent>
    </Dialog>
  );
}

export function Field({
  label,
  hint,
  action,
  className,
  children,
}: {
  label: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <MicroLabel>{label}</MicroLabel>
        <div className="flex items-center gap-2">
          {hint ? (
            <Text as="span" size="xs" variant="muted" className="text-right">
              {hint}
            </Text>
          ) : null}
          {action}
        </div>
      </div>
      {children}
    </div>
  );
}

/** The bio editor with the same EDIT/PREVIEW toggle as the profile edit
 * flyout — for fields whose value renders as markdown on the live page. */
export function MarkdownField({
  label,
  value,
  onChange,
  rows = 4,
  maxLength,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  maxLength?: number;
  className?: string;
}) {
  const [preview, setPreview] = useState(false);
  return (
    <Field
      label={label}
      hint={preview ? "preview · markdown rendered" : "markdown supported"}
      className={className}
      action={
        <Button
          variant="outline"
          size="xs"
          onClick={() => setPreview((p) => !p)}
          className="tracking-widest"
        >
          <HugeiconsIcon icon={preview ? ViewOffSlashIcon : ViewIcon} size={12} />
          {preview ? "EDIT" : "PREVIEW"}
        </Button>
      }
    >
      {preview ? (
        <Well className="min-h-24 p-3">
          {value.trim() ? (
            <MarkedText censor={false} className="text-foreground">
              {value}
            </MarkedText>
          ) : (
            <Text size="sm" variant="muted" className="italic">
              Nothing to preview yet — switch back to EDIT.
            </Text>
          )}
        </Well>
      ) : (
        <Textarea
          value={value}
          rows={rows}
          maxLength={maxLength}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

export function ReasonField({
  value,
  onChange,
  hint = "shown to the owner",
}: {
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}) {
  return (
    <Field label="REASON" hint={hint}>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={500}
        placeholder="Required"
      />
    </Field>
  );
}
