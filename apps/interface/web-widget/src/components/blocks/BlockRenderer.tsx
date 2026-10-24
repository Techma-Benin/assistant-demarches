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
};

export function BlockRenderer({ block, interactive, onButton, onForm }: BlockRendererProps) {
  switch (block.type) {
    case 'text':
      return <TextBlock block={block} />;
    case 'buttons':
      return <ButtonsBlock block={block} interactive={interactive} onButton={onButton} />;
    case 'form':
      return <FormBlock block={block} interactive={interactive} onForm={onForm} />;
    case 'fileRequest':
      return <FileRequestBlock block={block} />;
    case 'statusCard':
      return <StatusCardBlock block={block} />;
    default: {
      const unreachable: never = block;
      return unreachable;
    }
  }
}
