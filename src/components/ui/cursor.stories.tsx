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
      <div className="min-h-screen w-full bg-background p-8 flex flex-col gap-8 items-center justify-center">
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
      <div className="flex flex-col gap-12 items-center">
        <div className="flex flex-col gap-4 items-center">
          <h1 className="text-4xl font-bold">Cursors</h1>
          <div className="flex gap-4 items-center">
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
          className="p-12 border-2 border-dashed rounded-xl w-full max-w-md text-center"
          data-cursor="text"
        >
          Text Selection Area
        </div>
      </div>
    </>
  ),
};
