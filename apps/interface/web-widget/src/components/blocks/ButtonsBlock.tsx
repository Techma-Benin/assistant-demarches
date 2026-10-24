'use client';

import { useState } from 'react';
import { Chip } from '@techma/ui';
import type { components } from '@techma/contracts-ts';

type Block = components['schemas']['Block'];
type Props = {
  block: Extract<Block, { type: 'buttons' }>;
  interactive: boolean;
  onButton: (item: { id: string; label: string }) => void;
};

export function ButtonsBlock({ block, interactive, onButton }: Props) {
  const [clickedId, setClickedId] = useState<string | null>(null);
  const disabled = !interactive || clickedId !== null;
  return (
    <div className="flex flex-wrap gap-2">
      {block.items.slice(0, 3).map((item) => (
        <Chip
          key={item.id}
          disabled={disabled}
          selected={clickedId === item.id}
          onClick={() => {
            if (disabled) return;
            setClickedId(item.id);
            onButton(item);
          }}
        >
          {item.label}
        </Chip>
      ))}
    </div>
  );
}
