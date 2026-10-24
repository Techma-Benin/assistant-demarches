'use client';

import { useState } from 'react';
import { BlockRenderer } from '@/components/blocks/BlockRenderer';
import { fixtures } from '@/dev/fixtures';

export function BlocksGallery() {
  const [log, setLog] = useState<string[]>([]);
  const push = (line: string) => setLog((previous) => [...previous, line]);

  return (
    <main className="mx-auto max-w-md space-y-4 p-4">
      <h1 className="text-lg font-semibold">Galerie des blocs (dev)</h1>
      {fixtures.map((message) =>
        message.blocks.map((block, index) => (
          <div key={`${message.id}-${index}`} className="rounded border border-slate-300 bg-white p-3">
            <BlockRenderer
              block={block}
              interactive
              onButton={(item) => push(`button: ${item.id}`)}
              onForm={(formId, values, summary) => push(`form ${formId}: ${JSON.stringify(values)} (${summary})`)}
            />
          </div>
        )),
      )}
      <section aria-label="Journal des callbacks">
        <h2 className="font-semibold">Journal</h2>
        <ul className="text-xs">
          {log.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
