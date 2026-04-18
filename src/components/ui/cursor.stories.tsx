import type { Meta, StoryObj } from "@storybook/react";
import { motion } from "framer-motion";
import * as React from "react";

import { useMagnetic } from "@/lib/hooks/use-cursor";

import { Button } from "./button";
import { Cursor } from "./cursor";

const meta: Meta<typeof Cursor> = {
  title: "UI/Cursor",
  component: Cursor,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div className="flex min-h-screen w-full flex-col items-center justify-center gap-8 bg-background p-8">
        <style>{`
          body {
            cursor: none !important;
          }
          button, a, [role="button"] {
            cursor: none !important;
          }
        `}</style>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Cursor>;

const MagneticButton = ({ children, variant, ...props }: React.ComponentProps<typeof Button>) => {
  const { ref, position } = useMagnetic(0.2);
  return (
    <motion.div
      ref={ref as React.Ref<HTMLDivElement>}
      animate={{ x: position.x, y: position.y }}
      transition={{ type: "spring", stiffness: 1000, damping: 30, mass: 0.1 }}
      data-magnetic
      className="inline-block"
    >
      <Button variant={variant} {...props}>
        {children}
      </Button>
    </motion.div>
  );
};

export const Showcase: Story = {
  render: () => (
    <>
      <Cursor />
      <div className="flex flex-col items-center gap-12">
        <div className="flex flex-col items-center gap-4">
          <h1 className="text-4xl font-bold">Cursors</h1>
          <div className="flex items-center gap-4">
            <Button size="lg" className="bg-foreground text-background">
              Default Pointer
            </Button>
            <Button size="lg" variant="outline" data-cursor-label="Click!">
              Custom Label
            </Button>
            <MagneticButton size="lg" className="bg-foreground text-background">
              Magnetic
            </MagneticButton>
            <MagneticButton size="lg" variant="outline">
              Magnetic Outline
            </MagneticButton>
          </div>
        </div>

        <div
          className="w-full max-w-md rounded-xl border-2 border-dashed p-12 text-center"
          data-cursor="text"
        >
          Text Selection Area
        </div>
      </div>
    </>
  ),
};
