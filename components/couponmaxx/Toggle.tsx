'use client';

import { Checkbox } from '@shopify/polaris';

type ToggleProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
};

export function Toggle({ checked, onChange, disabled, label }: ToggleProps) {
  return (
    <Checkbox
      label={label ?? 'Toggle'}
      labelHidden={!label}
      checked={checked}
      onChange={onChange}
      disabled={disabled}
    />
  );
}
