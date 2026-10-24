import type { components } from '@techma/contracts-ts';
import { ButtonsBlock } from './ButtonsBlock';
import { FileRequestBlock } from './FileRequestBlock';
import { FormBlock } from './FormBlock';
import { StatusCardBlock } from './StatusCardBlock';
import { TextBlock } from './TextBlock';

type Block = components['schemas']['Block'];

export type BlockRendererProps = {
  block: Block;
  interactive: boolean;
  onButton: (item: { id: string; label: string }) => void;
  onForm: (formId: string, values: Record<string, string>, summary: string) => void;
  onFile: (file: File) => void;
};

/** Blocks that carry their own container (card, quick replies): rendered without a chat bubble. */
export function isBareBlock(block: Block): boolean {
  return block.type === 'buttons' || block.type === 'fileRequest' || block.type === 'statusCard';
}

export function BlockRenderer({ block, interactive, onButton, onForm, onFile }: BlockRendererProps) {
  switch (block.type) {
    case 'text':
      return <TextBlock block={block} />;
    case 'buttons':
      return <ButtonsBlock block={block} interactive={interactive} onButton={onButton} />;
    case 'form':
      return <FormBlock block={block} interactive={interactive} onForm={onForm} />;
    case 'fileRequest':
      return <FileRequestBlock block={block} interactive={interactive} onFile={onFile} />;
    case 'statusCard':
      return <StatusCardBlock block={block} />;
    default: {
      const unreachable: never = block;
      return unreachable;
    }
  }
}
