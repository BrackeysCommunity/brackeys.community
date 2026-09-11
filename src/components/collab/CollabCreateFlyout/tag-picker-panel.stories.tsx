import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

import { TagPickerPanel, type TagOption } from "./TagPickerPanel";

/**
 * The wizard's vocabulary picker, in the surface that showed its edges: a
 * short modal whose body scrolls, which is what clipped the popup before it
 * was portaled. The story exists to be looked at rather than asserted on —
 * the popup's geometry and the cursor's corner frame both need a real
 * browser (see the plan's note on §1.5 for why that is a story and not a
 * test).
 */
const meta: Meta = {
  title: "Collab/TagPickerPanel",
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj;

const ROLES: TagOption[] = [
  { id: 1, name: "Gameplay Programmer", category: "Code" },
  { id: 2, name: "Engine Programmer", category: "Code" },
  { id: 3, name: "UI Programmer", category: "Code" },
  { id: 4, name: "Tools Programmer", category: "Code" },
  { id: 5, name: "Network Programmer", category: "Code" },
  { id: 6, name: "Graphics Programmer", category: "Code" },
  { id: 7, name: "Generalist Programmer", category: "Code" },
  { id: 8, name: "Pixel Artist", category: "Art" },
  { id: 9, name: "3D Artist", category: "Art" },
  { id: 10, name: "Concept Artist", category: "Art" },
  { id: 11, name: "Animator", category: "Art" },
  { id: 12, name: "Composer", category: "Audio" },
  { id: 13, name: "Sound Designer", category: "Audio" },
  { id: 14, name: "Level Designer", category: "Design" },
  { id: 15, name: "Narrative Designer", category: "Writing" },
];

function Picker() {
  const [ids, setIds] = useState<number[]>([4]);
  return (
    <TagPickerPanel
      label="WHO YOU NEED *"
      hint={`${ids.length}/20 selected`}
      options={ROLES}
      selectedIds={ids}
      onChange={setIds}
      searchPlaceholder="Search roles…"
      emptyMessage="No roles available."
      max={20}
      atCapMessage="20 is the limit — remove one to add another."
    />
  );
}

/** In the create modal: a short box whose body is its own scroller. */
export const InModal: Story = {
  render: () => (
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        className="top-24 flex max-h-[calc(100vh-8rem)] translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
      >
        <DialogTitle className="sr-only">Post a gig</DialogTitle>
        <DialogDescription className="sr-only">Pick the roles you need.</DialogDescription>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <Picker />
        </div>
      </DialogContent>
    </Dialog>
  ),
};

/** On a plain page, where nothing clips and nothing traps focus. */
export const OnAPage: Story = {
  render: () => (
    <div className="mx-auto max-w-2xl p-10">
      <Picker />
    </div>
  ),
};
