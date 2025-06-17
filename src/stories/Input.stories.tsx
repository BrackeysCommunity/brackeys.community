import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { User, Mail, Lock, Search, Phone, Calendar, CreditCard } from 'lucide-react';
import { Input } from '../components/ui/Input';

const meta = {
  title: 'UI/Input',
  component: Input,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    type: {
      control: 'select',
      options: ['text', 'email', 'password', 'number'],
    },
    disabled: {
      control: 'boolean',
    },
    error: {
      control: 'boolean',
    },
    autoFocus: {
      control: 'boolean',
    },
  },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

// Basic Input Types
export const Text: Story = {
  render: () => {
    const [value, setValue] = useState('');
    return (
      <Input
        type="text"
        placeholder="Enter your name"
        value={value}
        onChange={setValue}
      />
    );
  },
};

export const Email: Story = {
  render: () => {
    const [value, setValue] = useState('');
    return (
      <Input
        type="email"
        placeholder="Enter your email"
        value={value}
        onChange={setValue}
      />
    );
  },
};

export const Password: Story = {
  render: () => {
    const [value, setValue] = useState('');
    return (
      <Input
        type="password"
        placeholder="Enter your password"
        value={value}
        onChange={setValue}
      />
    );
  },
};

export const Number: Story = {
  render: () => {
    const [value, setValue] = useState('');
    return (
      <Input
        type="number"
        placeholder="Enter a number"
        value={value}
        onChange={setValue}
        min={0}
      />
    );
  },
};

// Input States
export const States: Story = {
  render: () => {
    const [normalValue, setNormalValue] = useState('');
    const [errorValue, setErrorValue] = useState('Invalid input');
    const [focusedValue, setFocusedValue] = useState('');

    return (
      <div className="flex flex-col gap-4 w-80">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Normal state</label>
          <Input
            type="text"
            placeholder="Normal state"
            value={normalValue}
            onChange={setNormalValue}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Disabled state</label>
          <Input
            type="text"
            placeholder="Disabled state"
            value="Cannot edit this"
            disabled
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Error state</label>
          <Input
            type="text"
            placeholder="Error state"
            value={errorValue}
            onChange={setErrorValue}
            error
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Auto focused</label>
          <Input
            type="text"
            placeholder="Auto focused"
            value={focusedValue}
            onChange={setFocusedValue}
            autoFocus
          />
        </div>
      </div>
    );
  },
};

// With Icons
export const WithIcons: Story = {
  render: () => {
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [search, setSearch] = useState('');
    const [phone, setPhone] = useState('');

    return (
      <div className="flex flex-col gap-4 w-80">
        <Input
          type="text"
          placeholder="Username"
          value={username}
          onChange={setUsername}
          prefixIcon={User}
        />
        <Input
          type="email"
          placeholder="Email address"
          value={email}
          onChange={setEmail}
          prefixIcon={Mail}
        />
        <Input
          type="password"
          placeholder="Password"
          value={password}
          onChange={setPassword}
          prefixIcon={Lock}
        />
        <Input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={setSearch}
          prefixIcon={Search}
        />
        <Input
          type="text"
          placeholder="Phone number"
          value={phone}
          onChange={setPhone}
          prefixIcon={Phone}
        />
      </div>
    );
  },
};

// Interactive Example
export const Interactive: Story = {
  render: () => {
    const [value, setValue] = useState('');

    return (
      <div className="flex flex-col gap-4 w-80">
        <Input
          type="text"
          placeholder="Type something..."
          value={value}
          onChange={setValue}
        />
        <p className="text-sm text-gray-400">
          Current value: {value || '(empty)'}
        </p>
      </div>
    );
  },
};

// Form Examples
export const FormExamples: Story = {
  render: () => {
    const [formData, setFormData] = useState({
      username: '',
      email: '',
      password: '',
      confirmPassword: '',
      age: '',
    });

    const [errors, setErrors] = useState({
      email: false,
      password: false,
      confirmPassword: false,
    });

    const handleChange = (field: string) => (value: string) => {
      setFormData(prev => ({ ...prev, [field]: value }));

      // Basic validation
      if (field === 'email') {
        setErrors(prev => ({ ...prev, email: !value.includes('@') }));
      }
      if (field === 'password') {
        setErrors(prev => ({ ...prev, password: value.length < 6 }));
      }
      if (field === 'confirmPassword') {
        setErrors(prev => ({ ...prev, confirmPassword: value !== formData.password }));
      }
    };

    return (
      <div className="flex flex-col gap-4 w-80">
        <h3 className="text-lg font-semibold text-white mb-2">Registration Form</h3>

        <Input
          type="text"
          placeholder="Username"
          value={formData.username}
          onChange={handleChange('username')}
          prefixIcon={User}
        />

        <Input
          type="email"
          placeholder="Email"
          value={formData.email}
          onChange={handleChange('email')}
          prefixIcon={Mail}
          error={errors.email}
        />

        <Input
          type="password"
          placeholder="Password (min 6 chars)"
          value={formData.password}
          onChange={handleChange('password')}
          prefixIcon={Lock}
          error={errors.password}
        />

        <Input
          type="password"
          placeholder="Confirm Password"
          value={formData.confirmPassword}
          onChange={handleChange('confirmPassword')}
          prefixIcon={Lock}
          error={errors.confirmPassword}
        />

        <Input
          type="number"
          placeholder="Age"
          value={formData.age}
          onChange={handleChange('age')}
          min={13}
        />

        <div className="mt-4 p-3 bg-gray-700 rounded text-sm">
          <h4 className="font-medium text-white mb-2">Form Data:</h4>
          <pre className="text-gray-300 text-xs overflow-auto">
            {JSON.stringify(formData, null, 2)}
          </pre>
        </div>
      </div>
    );
  },
};

// All Input Variations
export const AllVariations: Story = {
  render: () => {
    const [textInput, setTextInput] = useState('');
    const [emailInput, setEmailInput] = useState('');
    const [passwordInput, setPasswordInput] = useState('');
    const [numberInput, setNumberInput] = useState('');
    const [usernameInput, setUsernameInput] = useState('');
    const [emailWithIcon, setEmailWithIcon] = useState('');
    const [searchInput, setSearchInput] = useState('');
    const [cardInput, setCardInput] = useState('');
    const [normalInput, setNormalInput] = useState('');
    const [errorInput, setErrorInput] = useState('Error example');
    const [valueInput, setValueInput] = useState('Sample text');

    return (
      <div className="flex flex-col gap-6 max-w-2xl">
        {/* Basic Types */}
        <div>
          <h3 className="text-lg font-semibold text-white mb-4">Input Types</h3>
          <div className="grid grid-cols-2 gap-4">
            <Input
              type="text"
              placeholder="Text input"
              value={textInput}
              onChange={setTextInput}
            />
            <Input
              type="email"
              placeholder="Email input"
              value={emailInput}
              onChange={setEmailInput}
            />
            <Input
              type="password"
              placeholder="Password input"
              value={passwordInput}
              onChange={setPasswordInput}
            />
            <Input
              type="number"
              placeholder="Number input"
              value={numberInput}
              onChange={setNumberInput}
              min={0}
            />
          </div>
        </div>

        {/* With Icons */}
        <div>
          <h3 className="text-lg font-semibold text-white mb-4">With Icons</h3>
          <div className="grid grid-cols-2 gap-4">
            <Input
              type="text"
              placeholder="Username"
              value={usernameInput}
              onChange={setUsernameInput}
              prefixIcon={User}
            />
            <Input
              type="email"
              placeholder="Email"
              value={emailWithIcon}
              onChange={setEmailWithIcon}
              prefixIcon={Mail}
            />
            <Input
              type="text"
              placeholder="Search"
              value={searchInput}
              onChange={setSearchInput}
              prefixIcon={Search}
            />
            <Input
              type="text"
              placeholder="Card Number"
              value={cardInput}
              onChange={setCardInput}
              prefixIcon={CreditCard}
            />
          </div>
        </div>

        {/* States */}
        <div>
          <h3 className="text-lg font-semibold text-white mb-4">States</h3>
          <div className="grid grid-cols-2 gap-4">
            <Input
              type="text"
              placeholder="Normal"
              value={normalInput}
              onChange={setNormalInput}
            />
            <Input
              type="text"
              placeholder="Disabled"
              value="Cannot edit"
              disabled
            />
            <Input
              type="text"
              placeholder="Error state"
              value={errorInput}
              onChange={setErrorInput}
              error
            />
            <Input
              type="text"
              placeholder="With value"
              value={valueInput}
              onChange={setValueInput}
            />
          </div>
        </div>
      </div>
    );
  },
}; 