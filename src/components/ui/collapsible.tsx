import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";

import { playReveal } from "@/lib/sound";

function Collapsible({ onOpenChange, ...props }: CollapsiblePrimitive.Root.Props) {
  return (
    <CollapsiblePrimitive.Root
      data-slot="collapsible"
      onOpenChange={(open, eventDetails) => {
        // Programmatic opens stay silent — only a press on the trigger.
        if (eventDetails.reason === "trigger-press") playReveal(open);
        onOpenChange?.(open, eventDetails);
      }}
      {...props}
    />
  );
}

function CollapsibleTrigger({ ...props }: CollapsiblePrimitive.Trigger.Props) {
  return <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />;
}

function CollapsibleContent({ ...props }: CollapsiblePrimitive.Panel.Props) {
  return <CollapsiblePrimitive.Panel data-slot="collapsible-content" {...props} />;
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
