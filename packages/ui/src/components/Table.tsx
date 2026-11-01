import type { CSSProperties, HTMLAttributes, TableHTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '../cn';

/** Dense data table (console). The wrapper scrolls horizontally only (entering rows must not flash a vertical bar). */
export function Table({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto overflow-y-hidden rounded-card border border-line bg-surface">
      <table className={cn('w-full border-collapse text-left text-sm text-ink', className)} {...props} />
    </div>
  );
}

export function TableHead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('bg-sunken', className)} {...props} />;
}

export function TableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody
      className={cn(
        '[&>tr]:transition-colors [&>tr]:duration-(--ui-dur-fast) [&>tr]:ease-[ease] [&>tr]:hover:bg-sunken/60 [&>tr:last-child]:border-b-0',
        className,
      )}
      {...props}
    />
  );
}

export type TableRowProps = HTMLAttributes<HTMLTableRowElement> & {
  /** Position in the entering batch: the row enters staggered (delay capped at index 9). */
  enterIndex?: number;
};

export function TableRow({ className, enterIndex, style, ...props }: TableRowProps) {
  return (
    <tr
      className={cn('h-11 border-b border-line', enterIndex !== undefined && 'ui-row-enter', className)}
      style={enterIndex === undefined ? style : ({ '--i': Math.min(enterIndex, 9), ...style } as CSSProperties)}
      {...props}
    />
  );
}

export function TableHeaderCell({ className, scope = 'col', ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope={scope}
      className={cn('px-4 py-2 text-[13px] font-semibold whitespace-nowrap text-ink-muted', className)}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-4 py-2 align-middle', className)} {...props} />;
}
