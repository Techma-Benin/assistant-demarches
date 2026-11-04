import type { Schemas } from '@techma/contracts-ts';
import { ConsentCard } from '@/components/chat/ConsentCard';
import { noopConsent, type ConsentControls } from '@/lib/consent';
import { ButtonsBlock } from './ButtonsBlock';
import { CaseCardBlock } from './CaseCardBlock';
import { FileRequestBlock } from './FileRequestBlock';
import { FormBlock } from './FormBlock';
import { LoginRequiredBlock } from './LoginRequiredBlock';
import { RequestCardBlock } from './RequestCardBlock';
import { TextBlock } from './TextBlock';

type Block = Schemas['Block'];

export type BlockRendererProps = {
  block: Block;
  interactive: boolean;
  onButton: (item: { id: string; label: string }) => void;
  onForm: (formId: string, values: Record<string, string>, summary: string) => void;
  onFiles: (files: File[], documentType: string) => void;
  /** Consent answers (`consent` block). */
  consent?: ConsentControls;
  /** Conversation to attach after login (`loginRequired` block). */
  conversationId?: string | null;
  /** `fileRequest` only: this block may stay active even when it is not in the last agent message. */
  fileRequestActive?: boolean;
  /** `fileRequest` only: a later request card shows the document as received. */
  fileRequestReceived?: boolean;
  /** Progressive reveal of a live answer: start delay (ms) of this block. Undefined = shown at once. */
  revealDelay?: number;
};

export function BlockRenderer({
  block,
  interactive,
  onButton,
  onForm,
  onFiles,
  consent = noopConsent,
  conversationId = null,
  fileRequestActive = false,
  fileRequestReceived,
  revealDelay,
}: BlockRendererProps) {
  if (block.type === 'text') return <TextBlock block={block} revealDelay={revealDelay} />;
  const content = (() => {
    switch (block.type) {
      case 'buttons':
        return <ButtonsBlock block={block} interactive={interactive} onButton={onButton} />;
      case 'form':
        return <FormBlock block={block} interactive={interactive} onForm={onForm} />;
      case 'fileRequest':
        return <FileRequestBlock block={block} interactive={interactive || fileRequestActive} received={fileRequestReceived} onFiles={onFiles} />;
      case 'loginRequired':
        return <LoginRequiredBlock block={block} conversationId={conversationId} />;
      case 'consent':
        return <ConsentCard challenge={block.challenge} consent={consent} interactive={interactive} />;
      case 'requestCard':
        return <RequestCardBlock block={block} />;
      case 'caseCard':
        return <CaseCardBlock block={block} />;
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
