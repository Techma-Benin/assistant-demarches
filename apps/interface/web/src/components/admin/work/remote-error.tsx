'use client';

import { Button, InlineAlert } from '@techma/ui';
import { errorMessage } from '@/components/admin/paginated-table';

export function RemoteError({ error, noun, onRetry }: { error: unknown; noun: string; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <InlineAlert>{errorMessage(error, noun)}</InlineAlert>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        Réessayer
      </Button>
    </div>
  );
}
