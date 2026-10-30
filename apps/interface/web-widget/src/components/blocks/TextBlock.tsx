import { CitationMark, SourcePill } from '@techma/ui';
import type { components } from '@techma/contracts-ts';
import { toSourceInfo } from '@/lib/dossier';

type Block = components['schemas']['Block'];
type Props = { block: Extract<Block, { type: 'text' }> };

type Segment = { kind: 'paragraph'; text: string } | { kind: 'list'; items: string[] };

const LIST_ITEM = /^\s*\d+\.\s+(\S.*)$/;

/** Splits the text into paragraphs and ordered lists (lines starting « 1. », « 2. »…). */
function parse(text: string): Segment[] {
  const segments: Segment[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) segments.push({ kind: 'paragraph', text: paragraph.join('\n') });
    paragraph = [];
  };
  for (const line of text.split('\n')) {
    const item = LIST_ITEM.exec(line);
    if (item) {
      flush();
      const last = segments.at(-1);
      if (last?.kind === 'list') last.items.push(item[1]);
      else segments.push({ kind: 'list', items: [item[1]] });
    } else if (line.trim() === '') {
      flush();
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return segments;
}

export function TextBlock({ block }: Props) {
  const segments = parse(block.text);
  const sources = block.sources.map((source, index) => toSourceInfo(source, index));
  const marks = sources.map((source) => <CitationMark key={source.index} index={source.index} />);
  const lastIndex = segments.length - 1;
  const endsWithParagraph = segments[lastIndex]?.kind === 'paragraph';

  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-col gap-4 text-[19px] leading-[1.6] text-ink">
        {segments.map((segment, index) =>
          segment.kind === 'paragraph' ? (
            <p key={index} className="whitespace-pre-wrap break-words">
              {segment.text}
              {index === lastIndex && marks}
            </p>
          ) : (
            <ol key={index} className="m-0 flex list-none flex-col gap-2.5 p-0">
              {segment.items.map((item, itemIndex) => (
                <li key={itemIndex} className="flex items-start gap-4 rounded-[22px] bg-sunken px-5 py-[18px]">
                  <span
                    aria-hidden="true"
                    className="w-7 shrink-0 font-display text-[26px] font-extrabold leading-none tracking-[-0.04em]"
                  >
                    {itemIndex + 1}
                  </span>
                  <span className="min-w-0 break-words text-[17px] font-bold leading-snug">{item}</span>
                </li>
              ))}
            </ol>
          ),
        )}
        {sources.length > 0 && !endsWithParagraph && <p className="text-base">{marks}</p>}
      </div>
      {sources.length > 0 && (
        <ul aria-label="Sources de la réponse" className="m-0 flex list-none flex-wrap gap-2 p-0">
          {sources.map((source) => (
            <li key={source.index}>
              <SourcePill {...source} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
