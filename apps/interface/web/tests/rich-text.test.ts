import { describe, expect, it } from 'vitest';
import { parseBlocks, parseInline } from '@/components/blocks/TextBlock';

describe('parseInline', () => {
  it('parses bold', () => {
    expect(parseInline('un **mot** gras')).toEqual([
      { kind: 'text', text: 'un ' },
      { kind: 'strong', text: 'mot' },
      { kind: 'text', text: ' gras' },
    ]);
  });

  it('keeps unbalanced markers literal', () => {
    expect(parseInline('a **b')).toEqual([{ kind: 'text', text: 'a **b' }]);
    expect(parseInline('** b **')).toEqual([{ kind: 'text', text: '** b **' }]);
  });

  it('links urls and trims trailing punctuation', () => {
    expect(parseInline('Voir https://service-public.fr/x, puis.')).toEqual([
      { kind: 'text', text: 'Voir ' },
      { kind: 'link', href: 'https://service-public.fr/x', label: 'service-public.fr/x' },
      { kind: 'text', text: ', puis.' },
    ]);
    expect(parseInline('(https://a.fr/b)')).toEqual([
      { kind: 'text', text: '(' },
      { kind: 'link', href: 'https://a.fr/b', label: 'a.fr/b' },
      { kind: 'text', text: ')' },
    ]);
  });

  it('keeps a balanced closing parenthesis', () => {
    const [link] = parseInline('https://a.fr/x_(y)');
    expect(link).toMatchObject({ kind: 'link', href: 'https://a.fr/x_(y)' });
  });

  it('truncates long labels in the middle', () => {
    const url = `https://example.fr/${'a'.repeat(60)}/fin.pdf`;
    const link = parseInline(url)[0];
    expect(link.kind).toBe('link');
    if (link.kind === 'link') {
      expect(link.label).toHaveLength(48);
      expect(link.label.startsWith('example.fr/')).toBe(true);
      expect(link.label.endsWith('fin.pdf')).toBe(true);
      expect(link.label).toContain('…');
    }
  });

  it('always shows the full host, even for a long crafted host', () => {
    const url = `https://service-public.bj.${'x'.repeat(40)}.example.com/${'a'.repeat(60)}`;
    const link = parseInline(url)[0];
    expect(link.kind).toBe('link');
    if (link.kind === 'link') expect(link.label.startsWith(new URL(url).host)).toBe(true);
  });

  it('does not link urls with credentials', () => {
    expect(parseInline('https://service-public.bj@example.com/x')).toEqual([
      { kind: 'text', text: 'https://service-public.bj@example.com/x' },
    ]);
  });

  it('does not link other protocols', () => {
    expect(parseInline('javascript:alert(1) ftp://x.fr')).toEqual([{ kind: 'text', text: 'javascript:alert(1) ftp://x.fr' }]);
  });
});

describe('parseBlocks', () => {
  it('parses bullets of every marker', () => {
    expect(parseBlocks('- a\n• b\n* c')).toEqual([{ kind: 'list', ordered: false, items: ['a', 'b', 'c'] }]);
  });

  it('does not take bold for a bullet', () => {
    expect(parseBlocks('**gras** début')).toEqual([{ kind: 'paragraph', text: '**gras** début' }]);
  });

  it('splits mixed ordered and bullet lists', () => {
    expect(parseBlocks('1. a\n2. b\n- c')).toEqual([
      { kind: 'list', ordered: true, items: ['a', 'b'] },
      { kind: 'list', ordered: false, items: ['c'] },
    ]);
  });

  it('turns headings into bold paragraphs', () => {
    expect(parseBlocks('## Titre\ntexte\n### Sous')).toEqual([
      { kind: 'paragraph', text: 'Titre', heading: true },
      { kind: 'paragraph', text: 'texte' },
      { kind: 'paragraph', text: 'Sous', heading: true },
    ]);
  });

  it('keeps the written number of a list split by bullets', () => {
    expect(parseBlocks('1. **A**\n - x\n\n2. **B**\n - y')).toEqual([
      { kind: 'list', ordered: true, items: ['**A**'] },
      { kind: 'list', ordered: false, items: ['x'] },
      { kind: 'list', ordered: true, items: ['**B**'], start: 2 },
      { kind: 'list', ordered: false, items: ['y'] },
    ]);
  });

  it('ignores an out-of-range written number', () => {
    expect(parseBlocks('2026. Texte')).toEqual([{ kind: 'list', ordered: true, items: ['Texte'] }]);
  });
});
