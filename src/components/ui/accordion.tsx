import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion";
import { ArrowDown01Icon, ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import * as React from "react";

import { playReveal } from "@/lib/sound";
import { cn } from "@/lib/utils";

function Accordion({ className, onValueChange, ...props }: AccordionPrimitive.Root.Props) {
  // The callback reports only the new set of open panels, not whether this
  // change opened or closed one — which is the whole question the cue asks.
  // Hence the previous set. With `openMultiple` off, switching panels reads
  // as an open, which is what it sounds like.
  const openRef = React.useRef(props.value ?? props.defaultValue ?? []);

  return (
    <AccordionPrimitive.Root
      data-slot="accordion"
      className={cn("flex w-full flex-col", className)}
      onValueChange={(value, eventDetails) => {
        const opened = value.some((item) => !openRef.current.includes(item));
        openRef.current = value;
        // Programmatic changes stay silent — only a press on the trigger.
        if (eventDetails.reason === "trigger-press") playReveal(opened);
        onValueChange?.(value, eventDetails);
      }}
      {...props}
    />
  );
}

function AccordionItem({ className, ...props }: AccordionPrimitive.Item.Props) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn("not-last:border-b", className)}
      {...props}
    />
  );
}

function AccordionTrigger({ className, children, ...props }: AccordionPrimitive.Trigger.Props) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          "group/accordion-trigger relative flex flex-1 items-start justify-between rounded-none border border-transparent py-2.5 text-left text-xs font-medium transition-all outline-none hover:underline focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:after:border-ring disabled:pointer-events-none disabled:opacity-50 **:data-[slot=accordion-trigger-icon]:ml-auto **:data-[slot=accordion-trigger-icon]:size-4 **:data-[slot=accordion-trigger-icon]:text-muted-foreground",
          className,
        )}
        {...props}
      >
        {children}
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          strokeWidth={2}
          data-slot="accordion-trigger-icon"
          className="pointer-events-none shrink-0 group-aria-expanded/accordion-trigger:hidden"
        />
        <HugeiconsIcon
          icon={ArrowUp01Icon}
          strokeWidth={2}
          data-slot="accordion-trigger-icon"
          className="pointer-events-none hidden shrink-0 group-aria-expanded/accordion-trigger:inline"
        />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

function AccordionContent({ className, children, ...props }: AccordionPrimitive.Panel.Props) {
  return (
    <AccordionPrimitive.Panel
      data-slot="accordion-content"
      className="overflow-hidden text-xs data-closed:animate-accordion-up data-open:animate-accordion-down"
      {...props}
    >
      <div
        className={cn(
          "h-(--accordion-panel-height) pt-0 pb-2.5 data-ending-style:h-0 data-starting-style:h-0 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4",
          className,
        )}
      >
        {children}
      </div>
    </AccordionPrimitive.Panel>
  );
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };
