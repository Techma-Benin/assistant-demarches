'use client';

import { useState } from 'react';
import { Card, ThemeToggle, cn } from '@techma/ui';
import { BlockRenderer, isBareBlock } from '@/components/blocks/BlockRenderer';
import { fixtures } from '@/dev/fixtures';
import { formatFileSize } from '@/lib/files';

export function BlocksGallery() {
  const [log, setLog] = useState<string[]>([]);
  const push = (line: string) => setLog((previous) => [...previous, line]);

  return (
    <main className="mx-auto max-w-md space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-[22px] font-extrabold">Galerie des blocs (dev)</h1>
        <ThemeToggle />
      </div>
      {fixtures.map((message) =>
        message.blocks.map((block, index) => (
          <Card key={`${message.id}-${index}`} className={cn(isBareBlock(block) && 'border-0 bg-transparent p-0')}>
            <BlockRenderer
              block={block}
              interactive
              onButton={(item) => push(`button: ${item.id}`)}
              onForm={(formId, values, summary) => push(`form ${formId}: ${JSON.stringify(values)} (${summary})`)}
              onFile={(file) => push(`fichier: ${file.name} (${formatFileSize(file.size)})`)}
            />
          </Card>
        )),
      )}
      <section aria-label="Journal des callbacks">
        <h2 className="font-semibold">Journal</h2>
        <ul className="text-[13px] text-ink-muted">
          {log.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
