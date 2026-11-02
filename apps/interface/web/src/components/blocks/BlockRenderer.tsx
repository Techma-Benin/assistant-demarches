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
  onFiles: (files: File[]) => void;
  /** Progressive reveal of a live answer: start delay (ms) of this block. Undefined = shown at once. */
  revealDelay?: number;
};

export function BlockRenderer({ block, interactive, onButton, onForm, onFiles, revealDelay }: BlockRendererProps) {
  if (block.type === 'text') return <TextBlock block={block} revealDelay={revealDelay} />;
  const content = (() => {
    switch (block.type) {
      case 'buttons':
        return <ButtonsBlock block={block} interactive={interactive} onButton={onButton} />;
      case 'form':
        return <FormBlock block={block} interactive={interactive} onForm={onForm} />;
      case 'fileRequest':
        return <FileRequestBlock block={block} interactive={interactive} onFiles={onFiles} />;
      case 'statusCard':
        return <StatusCardBlock block={block} />;
      default: {
        const unreachable: never = block;
        return unreachable;
      }
    }
  })();
  if (revealDelay === undefined) return content;
  return (
    <div className="chat-reveal" style={{ animationDelay: `${revealDelay}ms` }}>
      {content}
    </div>
  );
}
