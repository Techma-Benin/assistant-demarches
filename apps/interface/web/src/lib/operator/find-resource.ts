const PAGE_LIMIT = 100;

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** C3 has no GET-by-id: walks the list pages until `match` finds the item (null when absent). */
export async function findInPages<T>(
  list: (params: { cursor: string | null; limit: number }) => Promise<Page<T>>,
  match: (item: T) => boolean,
): Promise<T | null> {
  let cursor: string | null = null;
  do {
    const page: Page<T> = await list({ cursor, limit: PAGE_LIMIT });
    const found = page.items.find(match);
    if (found) return found;
    cursor = page.nextCursor;
  } while (cursor !== null);
  return null;
}

/** Route params may still be percent-encoded depending on the runtime. */
export function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
