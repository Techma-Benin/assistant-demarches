'use client';

import { useState } from 'react';
import { Button } from '@techma/ui';
import type { Schemas } from '@techma/contracts-ts';

type Block = Schemas['Block'];
type Props = {
  block: Extract<Block, { type: 'buttons' }>;
  interactive: boolean;
  onButton: (item: { id: string; label: string }) => void;
};

export function ButtonsBlock({ block, interactive, onButton }: Props) {
  const [clickedId, setClickedId] = useState<string | null>(null);
  const disabled = !interactive || clickedId !== null;
  return (
    <div className="flex flex-wrap gap-2.5">
      {block.items.slice(0, 3).map((item, index) => (
        <Button
          key={item.id}
          variant={index === 0 ? 'primary' : 'secondary'}
          disabled={disabled}
          aria-pressed={clickedId === null ? undefined : clickedId === item.id}
          className="min-h-[52px] whitespace-normal px-6 text-base font-bold"
          onClick={() => {
            if (disabled) return;
            setClickedId(item.id);
            onButton(item);
          }}
        >
          {item.label}
        </Button>
      ))}
    </div>
  );
}
