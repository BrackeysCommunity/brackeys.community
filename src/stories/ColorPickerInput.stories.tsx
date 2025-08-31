import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { ColorPickerInput } from '../components/ColorPickerInput';
import { RAINBOW_PALETTE, getColorGradient } from '../lib/colors';

const meta = {
  title: 'UI/ColorPickerInput',
  component: ColorPickerInput,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    value: {
      control: 'text',
    },
    placeholder: {
      control: 'text',
    },
    selectedColor: {
      control: 'select',
      options: RAINBOW_PALETTE,
    },
    error: {
      control: 'boolean',
    },
    autoFocus: {
      control: 'boolean',
    },
    onChange: { action: 'text changed' },
    onColorSelect: { action: 'color selected' },
    onBlur: { action: 'input blurred' },
  },
} satisfies Meta<typeof ColorPickerInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    value: '',
    placeholder: 'Enter your name...',
    selectedColor: RAINBOW_PALETTE[0],
    error: false,
    autoFocus: false,
  },
};

export const WithValue: Story = {
  args: {
    value: 'John Doe',
    placeholder: 'Enter your name...',
    selectedColor: RAINBOW_PALETTE[3],
  },
};

export const WithError: Story = {
  args: {
    value: '',
    placeholder: 'Enter your name...',
    selectedColor: RAINBOW_PALETTE[0],
    error: true,
  },
};

export const Interactive: Story = {
  render: () => {
    const [value, setValue] = useState('');
    const [selectedColor, setSelectedColor] = useState(RAINBOW_PALETTE[0]);

    return (
      <div className="w-80 space-y-4">
        <ColorPickerInput
          value={value}
          onChange={setValue}
          selectedColor={selectedColor}
          onColorSelect={setSelectedColor}
          placeholder="Enter your display name..."
        />
        <div className="p-4 bg-gray-800 rounded-lg space-y-2">
          <p className="text-sm text-gray-400">Current values:</p>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-300">Name:</span>
            <span className="text-sm text-white font-medium">{value || '(empty)'}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-300">Color:</span>
            <div
              className="w-5 h-5 rounded-full border"
              style={{
                background: getColorGradient(selectedColor),
                borderColor: selectedColor,
              }}
            />
            <code className="text-xs">{selectedColor}</code>
          </div>
        </div>
      </div>
    );
  },
};

export const FormExample: Story = {
  render: () => {
    const [name, setName] = useState('');
    const [color, setColor] = useState(RAINBOW_PALETTE[2]);
    const [error, setError] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (!name.trim()) {
        setError(true);
        return;
      }
      setError(false);
      setSubmitted(true);
    };

    return (
      <div className="w-96">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Display Name
            </label>
            <ColorPickerInput
              value={name}
              onChange={(value) => {
                setName(value);
                setError(false);
                setSubmitted(false);
              }}
              selectedColor={color}
              onColorSelect={setColor}
              placeholder="Choose a display name..."
              error={error}
            />
            {error && (
              <p className="mt-1 text-sm text-red-400">Name is required</p>
            )}
          </div>

          <button
            type="submit"
            className="w-full px-4 py-2 bg-brackeys-purple-600 hover:bg-brackeys-purple-700 text-white rounded-md transition-colors"
          >
            Save Profile
          </button>
        </form>

        {submitted && (
          <div className="mt-4 p-4 bg-green-900/20 border border-green-800 rounded-md">
            <p className="text-sm text-green-300">
              Profile saved! Name: "{name}" with color {color}
            </p>
          </div>
        )}
      </div>
    );
  },
};

export const CustomPlaceholder: Story = {
  args: {
    value: '',
    placeholder: 'What should we call you?',
    selectedColor: RAINBOW_PALETTE[4],
  },
};

export const AutoFocused: Story = {
  args: {
    value: '',
    placeholder: 'This input is auto-focused...',
    selectedColor: RAINBOW_PALETTE[1],
    autoFocus: true,
  },
};

export const MultipleInputs: Story = {
  render: () => {
    const [player1Name, setPlayer1Name] = useState('');
    const [player1Color, setPlayer1Color] = useState(RAINBOW_PALETTE[0]);
    const [player2Name, setPlayer2Name] = useState('');
    const [player2Color, setPlayer2Color] = useState(RAINBOW_PALETTE[6]);

    return (
      <div className="space-y-6">
        <div>
          <h4 className="text-white mb-2">Player 1</h4>
          <ColorPickerInput
            value={player1Name}
            onChange={setPlayer1Name}
            selectedColor={player1Color}
            onColorSelect={setPlayer1Color}
            placeholder="Enter player 1 name..."
          />
        </div>

        <div>
          <h4 className="text-white mb-2">Player 2</h4>
          <ColorPickerInput
            value={player2Name}
            onChange={setPlayer2Name}
            selectedColor={player2Color}
            onColorSelect={setPlayer2Color}
            placeholder="Enter player 2 name..."
          />
        </div>

        <div className="pt-4 border-t border-gray-700">
          <h4 className="text-white mb-3">Game Preview</h4>
          <div className="flex gap-4">
            {player1Name && (
              <div className="flex items-center gap-2">
                <div
                  className="w-8 h-8 rounded-full border-2"
                  style={{
                    background: getColorGradient(player1Color),
                    borderColor: player1Color,
                  }}
                />
                <span className="text-white">{player1Name}</span>
              </div>
            )}
            {player1Name && player2Name && (
              <span className="text-gray-400">VS</span>
            )}
            {player2Name && (
              <div className="flex items-center gap-2">
                <div
                  className="w-8 h-8 rounded-full border-2"
                  style={{
                    background: getColorGradient(player2Color),
                    borderColor: player2Color,
                  }}
                />
                <span className="text-white">{player2Name}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  },
};
