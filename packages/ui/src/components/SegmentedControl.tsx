import { cn } from '../cn';

export type SegmentedControlProps = {
  'aria-label': string;
  options: { value: string; label: string }[];
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
};

/** Pill group of mutually exclusive options (buttons with aria-pressed). */
export function SegmentedControl({ options, value, onValueChange, className, ...props }: SegmentedControlProps) {
  return (
    <div
      role="group"
      aria-label={props['aria-label']}
      className={cn('inline-flex gap-1 rounded-pill bg-sunken p-1', className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onValueChange(option.value)}
            className={cn(
              'min-h-11 rounded-pill px-4 text-[14px] font-semibold ui-press transition-colors duration-(--ui-dur-fast) ease-(--ui-ease-out)',
              active ? 'bg-action text-on-action' : 'text-ink hover:bg-surface',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
