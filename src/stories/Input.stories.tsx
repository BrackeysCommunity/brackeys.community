import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { User, Mail, Lock, Search, Phone, CreditCard, Copy, Send, Filter, Settings } from 'lucide-react';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';

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

        {/* With Button Prefixes */}
        <div>
          <h3 className="text-lg font-semibold text-white mb-4">With Button Prefixes</h3>
          <div className="grid grid-cols-2 gap-4">
            <Input
              type="text"
              placeholder="Search with action..."
              value={searchInput}
              onChange={setSearchInput}
              prefixButton={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => alert('Search clicked!')}
                  className="border-none bg-transparent hover:bg-gray-600 px-3 py-3 rounded-none"
                >
                  <Search className="w-4 h-4" />
                </Button>
              }
            />
            <Input
              type="text"
              placeholder="Copy to clipboard..."
              value={cardInput}
              onChange={setCardInput}
              prefixButton={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigator.clipboard.writeText(cardInput)}
                  disabled={!cardInput}
                  className="border-none bg-transparent hover:bg-gray-600 disabled:hover:bg-transparent px-3 py-3 rounded-none"
                >
                  <Copy className="w-4 h-4" />
                </Button>
              }
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

// Button Prefix Examples
export const WithButtonPrefix: Story = {
  render: () => {
    const [searchValue, setSearchValue] = useState('');
    const [urlValue, setUrlValue] = useState('');
    const [messageValue, setMessageValue] = useState('');
    const [filterValue, setFilterValue] = useState('');

    const handleCopy = () => {
      navigator.clipboard.writeText(urlValue);
      alert('Copied to clipboard!');
    };

    const handleSend = () => {
      alert(`Sending message: ${messageValue}`);
      setMessageValue('');
    };

    const handleFilter = () => {
      alert(`Filtering by: ${filterValue}`);
    };

    const handleSettings = () => {
      alert('Opening search settings...');
    };

    return (
      <div className="flex flex-col gap-4 w-96">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Search with settings</label>
          <Input
            type="text"
            placeholder="Search with advanced options..."
            value={searchValue}
            onChange={setSearchValue}
            prefixButton={
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSettings}
                className="border-none bg-transparent hover:bg-gray-600 px-3 py-3 rounded-none"
              >
                <Settings className="w-4 h-4" />
              </Button>
            }
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">URL with copy</label>
          <Input
            type="text"
            placeholder="Enter URL to copy..."
            value={urlValue}
            onChange={setUrlValue}
            prefixButton={
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopy}
                disabled={!urlValue}
                className="border-none bg-transparent hover:bg-gray-600 disabled:hover:bg-transparent px-3 py-3 rounded-none"
              >
                <Copy className="w-4 h-4" />
              </Button>
            }
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Message with send</label>
          <Input
            type="text"
            placeholder="Type your message..."
            value={messageValue}
            onChange={setMessageValue}
            prefixButton={
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSend}
                disabled={!messageValue.trim()}
                className="border-none bg-transparent hover:bg-purple-600 disabled:hover:bg-transparent px-3 py-3 rounded-none"
              >
                <Send className="w-4 h-4" />
              </Button>
            }
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Filter input</label>
          <Input
            type="text"
            placeholder="Enter filter criteria..."
            value={filterValue}
            onChange={setFilterValue}
            prefixButton={
              <Button
                variant="ghost"
                size="sm"
                onClick={handleFilter}
                className="border-none bg-transparent hover:bg-gray-600 px-3 py-3 rounded-none"
              >
                <Filter className="w-4 h-4" />
              </Button>
            }
          />
        </div>
      </div>
    );
  },
};

export const ButtonPrefixStates: Story = {
  render: () => {
    const [normalValue, setNormalValue] = useState('');
    const [errorValue, setErrorValue] = useState('Error state');
    const [disabledValue, setDisabledValue] = useState('Disabled input');

    const handleAction = () => {
      alert('Button clicked!');
    };

    return (
      <div className="flex flex-col gap-4 w-96">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Normal state</label>
          <Input
            type="text"
            placeholder="Normal input with button..."
            value={normalValue}
            onChange={setNormalValue}
            prefixButton={
              <Button
                variant="ghost"
                size="sm"
                onClick={handleAction}
                className="border-none bg-transparent hover:bg-gray-600 px-3 py-3 rounded-none"
              >
                <Search className="w-4 h-4" />
              </Button>
            }
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Error state</label>
          <Input
            type="text"
            placeholder="Error input with button..."
            value={errorValue}
            onChange={setErrorValue}
            error
            prefixButton={
              <Button
                variant="ghost"
                size="sm"
                onClick={handleAction}
                className="border-none bg-transparent hover:bg-gray-600 px-3 py-3 rounded-none"
              >
                <Search className="w-4 h-4" />
              </Button>
            }
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Disabled state</label>
          <Input
            type="text"
            placeholder="Disabled input with button..."
            value={disabledValue}
            onChange={setDisabledValue}
            disabled
            prefixButton={
              <Button
                variant="ghost"
                size="sm"
                onClick={handleAction}
                disabled
                className="border-none bg-transparent hover:bg-gray-600 disabled:hover:bg-transparent px-3 py-3 rounded-none"
              >
                <Search className="w-4 h-4" />
              </Button>
            }
          />
        </div>
      </div>
    );
  },
};

export const ButtonPrefixVariations: Story = {
  render: () => {
    const [textValue, setTextValue] = useState('');
    const [passwordValue, setPasswordValue] = useState('');
    const [numberValue, setNumberValue] = useState('');

    const handleAction = (action: string) => {
      alert(`${action} clicked!`);
    };

    return (
      <div className="flex flex-col gap-4 w-96">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Text input with button</label>
          <Input
            type="text"
            placeholder="Search documents..."
            value={textValue}
            onChange={setTextValue}
            prefixButton={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleAction('Search')}
                className="border-none bg-transparent hover:bg-blue-600 px-3 py-3 rounded-none"
              >
                <Search className="w-4 h-4" />
              </Button>
            }
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Password input with button</label>
          <Input
            type="password"
            placeholder="Enter secure password..."
            value={passwordValue}
            onChange={setPasswordValue}
            prefixButton={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleAction('Generate Password')}
                className="border-none bg-transparent hover:bg-green-600 px-3 py-3 rounded-none"
              >
                <Lock className="w-4 h-4" />
              </Button>
            }
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Number input with button</label>
          <Input
            type="number"
            placeholder="Enter amount..."
            value={numberValue}
            onChange={setNumberValue}
            min={0}
            prefixButton={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleAction('Calculate')}
                className="border-none bg-transparent hover:bg-yellow-600 px-3 py-3 rounded-none text-xs"
              >
                $
              </Button>
            }
          />
        </div>
      </div>
    );
  },
}; 