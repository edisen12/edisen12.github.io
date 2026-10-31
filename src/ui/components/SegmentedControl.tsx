import React from 'react';

export interface SegmentedOption<T extends string = string> {
  value: T;
  label: string;
  count?: number;
  icon?: React.ReactNode;
  badgeTone?: 'default' | 'warn' | 'bad' | 'ok';
}

export interface SegmentedControlProps<T extends string = string> {
  options: Array<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
  size?: 'sm' | 'md';
  fullWidth?: boolean;
}

export function SegmentedControl<T extends string = string>({
  options,
  value,
  onChange,
  ariaLabel = 'Alternar visualização',
  size = 'md',
  fullWidth = false
}: SegmentedControlProps<T>) {
  return (
    <div
      className={`segmented-control segmented-${size}${fullWidth ? ' segmented-full' : ''}`}
      role="tablist"
      aria-label={ariaLabel}
    >
      {options.map(opt => {
        const isActive = opt.value === value;
        const toneClass = opt.badgeTone && opt.badgeTone !== 'default' ? ` seg-count-${opt.badgeTone}` : '';
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`segmented-btn${isActive ? ' active' : ''}`}
            onClick={() => onChange(opt.value)}
          >
            {opt.icon && <span className="segmented-icon" aria-hidden="true">{opt.icon}</span>}
            <span className="segmented-label">{opt.label}</span>
            {typeof opt.count === 'number' && (
              <span className={`segmented-count${toneClass}`}>
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
