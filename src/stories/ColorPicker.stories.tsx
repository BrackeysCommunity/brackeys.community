import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { ColorPicker } from '../components/ColorPicker';
import { RAINBOW_PALETTE, getColorGradient } from '../lib/colors';

const meta = {
  title: 'UI/ColorPicker',
  component: ColorPicker,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    selectedColor: {
      control: 'select',
      options: RAINBOW_PALETTE,
    },
    onColorSelect: { action: 'color selected' },
  },
} satisfies Meta<typeof ColorPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    selectedColor: RAINBOW_PALETTE[0],
  },
};

export const PreselectedColor: Story = {
  args: {
    selectedColor: RAINBOW_PALETTE[5], // Pre-select a different color
  },
};

export const Interactive: Story = {
  render: () => {
    const [selectedColor, setSelectedColor] = useState(RAINBOW_PALETTE[0]);

    return (
      <div className="space-y-4">
        <ColorPicker
          selectedColor={selectedColor}
          onColorSelect={setSelectedColor}
        />
        <div className="text-center space-y-2">
          <p className="text-sm text-gray-400">Selected color:</p>
          <div className="flex items-center justify-center gap-2">
            <div
              className="w-8 h-8 rounded-full border-2"
              style={{
                background: getColorGradient(selectedColor),
                borderColor: selectedColor,
              }}
            />
            <code className="text-sm">{selectedColor}</code>
          </div>
        </div>
      </div>
    );
  },
};

export const WithCustomStyles: Story = {
  render: () => {
    const [selectedColor, setSelectedColor] = useState(RAINBOW_PALETTE[2]);

    return (
      <div className="p-6 bg-gray-800 rounded-lg">
        <h3 className="text-white mb-4">Choose your theme color</h3>
        <ColorPicker
          selectedColor={selectedColor}
          onColorSelect={setSelectedColor}
          className="mb-4"
        />
        <p className="text-gray-400 text-sm">
          This color will be used throughout your profile
        </p>
      </div>
    );
  },
};

export const MultipleInstances: Story = {
  render: () => {
    const [primaryColor, setPrimaryColor] = useState(RAINBOW_PALETTE[0]);
    const [secondaryColor, setSecondaryColor] = useState(RAINBOW_PALETTE[6]);

    return (
      <div className="space-y-6">
        <div>
          <h4 className="text-white mb-2">Primary Color</h4>
          <ColorPicker
            selectedColor={primaryColor}
            onColorSelect={setPrimaryColor}
          />
        </div>
        <div>
          <h4 className="text-white mb-2">Secondary Color</h4>
          <ColorPicker
            selectedColor={secondaryColor}
            onColorSelect={setSecondaryColor}
          />
        </div>
        <div className="pt-4 border-t border-gray-700">
          <p className="text-sm text-gray-400 mb-2">Color combination preview:</p>
          <div className="flex gap-2">
            <div
              className="w-20 h-20 rounded-lg border-2"
              style={{
                background: getColorGradient(primaryColor),
                borderColor: primaryColor,
              }}
            />
            <div
              className="w-20 h-20 rounded-lg border-2"
              style={{
                background: getColorGradient(secondaryColor),
                borderColor: secondaryColor,
              }}
            />
          </div>
        </div>
      </div>
    );
  },
};

export const ColorPalette: Story = {
  render: () => (
    <div className="space-y-4">
      <h3 className="text-white text-lg font-semibold">Available Colors</h3>
      <div className="grid grid-cols-6 gap-4">
        {RAINBOW_PALETTE.map((color, index) => (
          <div key={color} className="text-center space-y-2">
            <div
              className="w-12 h-12 rounded-full border-2 mx-auto"
              style={{
                background: getColorGradient(color),
                borderColor: color,
              }}
            />
            <code className="text-xs text-gray-400">{color}</code>
          </div>
        ))}
      </div>
    </div>
  ),
};
