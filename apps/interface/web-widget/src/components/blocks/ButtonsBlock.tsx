'use client';

import { useState } from 'react';
import type { components } from '@techma/contracts-ts';

type Block = components['schemas']['Block'];
type Props = {
  block: Extract<Block, { type: 'buttons' }>;
  interactive: boolean;
  onButton: (item: { id: string; label: string }) => void;
};

export function ButtonsBlock({ block, interactive, onButton }: Props) {
  const [clicked, setClicked] = useState(false);
  const disabled = !interactive || clicked;
  return (
    <div className="flex flex-wrap gap-2">
      {block.items.slice(0, 3).map((item) => (
        <button
          key={item.id}
          type="button"
          disabled={disabled}
          onClick={() => {
            if (disabled) return;
            setClicked(true);
            onButton(item);
          }}
          className="rounded-full border border-blue-700 px-3 py-1 text-sm text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
