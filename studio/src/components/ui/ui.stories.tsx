import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Button, Modal, Select, Textarea, TextField, Toast } from '.';

const meta = {
  title: 'Studio/Component Library',
  component: Button,
  parameters: { layout: 'padded' }
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Buttons: Story = {
  render: () => <div style={{ display: 'flex', gap: 12 }}><Button>Primary</Button><Button variant="secondary">Secondary</Button><Button variant="danger">Danger</Button></div>
};

export const FormFields: Story = {
  render: () => <div style={{ display: 'grid', gap: 16, width: 360 }}><TextField label="Test name" hint="Use a descriptive name" /><Textarea label="Description" error="Description is required" /><Select label="Browser" options={[{ value: 'chromium', label: 'Chromium' }, { value: 'firefox', label: 'Firefox' }]} /></div>
};

export const Dialog: Story = {
  render: function DialogStory() {
    const [open, setOpen] = useState(false);
    return <><Button onClick={() => setOpen(true)}>Open dialog</Button><Modal open={open} title="Create test" onClose={() => setOpen(false)}>Configure your new PROVA test.</Modal></>;
  }
};

export const Notifications: Story = {
  render: () => <Toast tone="success" message="Test saved successfully" />
};
