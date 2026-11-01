import { CitationMark, SourcePill, cn } from '@techma/ui';
import type { components } from '@techma/contracts-ts';
import { toSourceInfo } from '@/lib/dossier';
import { BLOCK_STEP_MS, MAX_WORD_REVEAL, textRevealDuration, wordCount, wordDelay } from '@/lib/reveal';

type Block = components['schemas']['Block'];
type Props = {
  block: Extract<Block, { type: 'text' }>;
  /** Start delay (ms) of the progressive reveal; undefined renders the text at once (history, reduced motion is CSS). */
  revealDelay?: number;
};

export type Segment =
  | { kind: 'paragraph'; text: string; heading?: boolean }
  | { kind: 'list'; ordered: boolean; items: string[] };

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'link'; href: string; label: string };

const ORDERED_ITEM = /^\s*\d+\.\s+(\S.*)$/;
const BULLET_ITEM = /^\s*[-•*]\s+(\S.*)$/;
const HEADING = /^\s*#{2,3}\s+(\S.*)$/;
const INLINE = /\*\*([^*\s](?:[^*\n]*[^*\s])?)\*\*|https?:\/\/\S+/g;
const TRAILING_PUNCTUATION = '.,;:!?)»';
const MAX_LINK_LABEL = 48;

/** Splits the text into paragraphs, headings (as bold paragraphs) and ordered or bullet lists. */
export function parseBlocks(text: string): Segment[] {
  const segments: Segment[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) segments.push({ kind: 'paragraph', text: paragraph.join('\n') });
    paragraph = [];
  };
  const addItem = (ordered: boolean, item: string) => {
    flush();
    const last = segments.at(-1);
    if (last?.kind === 'list' && last.ordered === ordered) last.items.push(item);
    else segments.push({ kind: 'list', ordered, items: [item] });
  };
  for (const line of text.split('\n')) {
    const ordered = ORDERED_ITEM.exec(line);
    const bullet = BULLET_ITEM.exec(line);
    const heading = HEADING.exec(line);
    if (ordered) addItem(true, ordered[1]);
    else if (bullet) addItem(false, bullet[1]);
    else if (heading) {
      flush();
      segments.push({ kind: 'paragraph', text: heading[1].trim(), heading: true });
    } else if (line.trim() === '') flush();
    else paragraph.push(line);
  }
  flush();
  return segments;
}

/** Drops trailing punctuation that is not part of the URL (a closing parenthesis stays when balanced). */
function trimUrl(raw: string): string {
  let url = raw;
  while (url.length > 0 && TRAILING_PUNCTUATION.includes(url.at(-1) as string)) {
    if (url.at(-1) === ')' && url.split(')').length <= url.split('(').length) break;
    url = url.slice(0, -1);
  }
  return url;
}

function linkLabel(url: string): string {
  const label = url.replace(/^https?:\/\//, '');
  if (label.length <= MAX_LINK_LABEL) return label;
  const tail = 19;
  return `${label.slice(0, MAX_LINK_LABEL - tail - 1)}…${label.slice(-tail)}`;
}

/** Splits a line of text into plain text, `**bold**` and http(s) links. Unbalanced `**` stays literal. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const pushText = (value: string) => {
    if (value === '') return;
    const last = out.at(-1);
    if (last?.kind === 'text') last.text += value;
    else out.push({ kind: 'text', text: value });
  };
  let cursor = 0;
  for (const match of text.matchAll(INLINE)) {
    const start = match.index;
    if (start < cursor) continue;
    pushText(text.slice(cursor, start));
    if (match[1] !== undefined) {
      out.push({ kind: 'strong', text: match[1] });
      cursor = start + match[0].length;
      continue;
    }
    const url = trimUrl(match[0]);
    let valid = false;
    try {
      const { protocol } = new URL(url);
      valid = protocol === 'http:' || protocol === 'https:';
    } catch {
      valid = false;
    }
    if (valid) out.push({ kind: 'link', href: url, label: linkLabel(url) });
    else pushText(url);
    cursor = start + url.length;
  }
  pushText(text.slice(cursor));
  return out;
}

const LINK_CLASS =
  'rounded-sm text-ink underline decoration-line underline-offset-2 transition-colors hover:decoration-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink';

export function TextBlock({ block, revealDelay }: Props) {
  const segments = parseBlocks(block.text);
  const reveal = revealDelay !== undefined;
  const totalWords = segments.reduce(
    (sum, segment) => sum + (segment.kind === 'paragraph' ? wordCount(segment.text) : segment.items.reduce((n, item) => n + wordCount(item), 0)),
    0,
  );
  // The full text is always in the DOM; words only fade in. Very long texts reveal per paragraph instead.
  const byWord = reveal && totalWords <= MAX_WORD_REVEAL;
  const step = wordDelay(totalWords);
  const textEnd = (revealDelay ?? 0) + textRevealDuration(block.text);
  let wordIndex = 0;
  const words = (text: string) =>
    byWord
      ? text.split(/(\s+)/).map((part, i) =>
          part === '' || /^\s+$/.test(part) ? (
            part
          ) : (
            <span key={i} className="chat-word" style={{ animationDelay: `${Math.round((revealDelay ?? 0) + wordIndex++ * step)}ms` }}>
              {part}
            </span>
          ),
        )
      : text;
  const inline = (text: string) =>
    parseInline(text).map((part, i) => {
      if (part.kind === 'strong') return <strong key={i} className="font-semibold">{words(part.text)}</strong>;
      if (part.kind === 'link') {
        return (
          <a key={i} href={part.href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
            {words(part.label)}
          </a>
        );
      }
      return <span key={i}>{words(part.text)}</span>;
    });
  const paragraphStyle = (index: number) =>
    reveal && !byWord
      ? { animationDelay: `${(revealDelay ?? 0) + Math.min(index * BLOCK_STEP_MS, 300)}ms` }
      : undefined;
  const sources = block.sources.map((source, index) => toSourceInfo(source, index));
  const markList = sources.map((source) => <CitationMark key={source.index} index={source.index} />);
  // Citation marks and source pills come after the text.
  const marks = reveal && markList.length > 0 ? (
    <span className="chat-word" style={{ animationDelay: `${textEnd}ms` }}>
      {markList}
    </span>
  ) : (
    markList
  );
  const lastIndex = segments.length - 1;
  const endsWithParagraph = segments[lastIndex]?.kind === 'paragraph';

  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-col gap-4 text-[19px] leading-[1.6] text-ink">
        {segments.map((segment, index) => {
          if (segment.kind === 'list') {
            const ListTag = segment.ordered ? 'ol' : 'ul';
            return (
              <ListTag key={index} style={paragraphStyle(index)} className={cn('m-0 flex list-none flex-col gap-2.5 p-0', reveal && !byWord && 'chat-reveal')}>
                {segment.items.map((item, itemIndex) => (
                  <li key={itemIndex} className="flex items-start gap-4 rounded-[22px] bg-sunken px-5 py-[18px]">
                    {segment.ordered ? (
                      <span
                        aria-hidden="true"
                        className="w-7 shrink-0 font-display text-[26px] font-extrabold leading-none tracking-[-0.04em]"
                      >
                        {itemIndex + 1}
                      </span>
                    ) : (
                      <span aria-hidden="true" className="flex h-[1.4em] w-7 shrink-0 items-center justify-center text-[17px]">
                        <span className="size-2 rounded-full bg-ink" />
                      </span>
                    )}
                    <span className="min-w-0 break-words text-[17px] font-bold leading-snug">{inline(item)}</span>
                  </li>
                ))}
              </ListTag>
            );
          }
          return (
            <p
              key={index}
              style={paragraphStyle(index)}
              className={cn('whitespace-pre-wrap break-words', segment.heading && 'font-semibold', reveal && !byWord && 'chat-reveal')}
            >
              {inline(segment.text)}
              {index === lastIndex && marks}
            </p>
          );
        })}
        {sources.length > 0 && !endsWithParagraph && <p className="text-base">{marks}</p>}
      </div>
      {sources.length > 0 && (
        <ul
          aria-label="Sources de la réponse"
          className={cn('m-0 flex list-none flex-wrap gap-2 p-0', reveal && 'chat-reveal')}
          style={reveal ? { animationDelay: `${textEnd}ms` } : undefined}
        >
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
