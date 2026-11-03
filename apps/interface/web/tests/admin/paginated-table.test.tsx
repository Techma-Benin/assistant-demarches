import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PaginatedTable, type Column } from '@/components/admin/paginated-table';
import { AdminError } from '@/lib/admin/errors';

interface Row {
  id: string;
}
const columns: Column<Row>[] = [{ header: 'Identifiant', cell: (row) => row.id }];

function renderTable(load: (cursor: string | null) => Promise<{ items: Row[]; nextCursor: string | null }>) {
  return render(
    <PaginatedTable label="Test" noun="les lignes" columns={columns} rowKey={(row) => row.id} load={load} />,
  );
}

describe('PaginatedTable', () => {
  it('shows a skeleton while loading, then the rows', async () => {
    let resolve!: (page: { items: Row[]; nextCursor: null }) => void;
    const load = vi.fn(() => new Promise<{ items: Row[]; nextCursor: null }>((r) => (resolve = r)));
    renderTable(load);
    expect(screen.getByRole('table', { name: 'Test' })).toHaveAttribute('aria-busy', 'true');
    resolve({ items: [{ id: 'a' }], nextCursor: null });
    expect(await screen.findByText('a')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Test' })).toHaveAttribute('aria-busy', 'false');
    expect(load).toHaveBeenCalledWith(null);
    expect(screen.queryByRole('button', { name: 'Charger plus' })).toBeNull();
  });

  it('loads more with nextCursor and hides the button at the end', async () => {
    const load = vi.fn(async (cursor: string | null) =>
      cursor === null ? { items: [{ id: 'a' }], nextCursor: 'c1' } : { items: [{ id: 'b' }], nextCursor: null },
    );
    renderTable(load);
    await screen.findByText('a');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Charger plus' }));
    expect(await screen.findByText('b')).toBeInTheDocument();
    expect(screen.getByText('a')).toBeInTheDocument();
    expect(load).toHaveBeenLastCalledWith('c1');
    expect(screen.queryByRole('button', { name: 'Charger plus' })).toBeNull();
  });

  it('shows an empty state', async () => {
    renderTable(async () => ({ items: [], nextCursor: null }));
    expect(await screen.findByText('Aucun élément à afficher.')).toBeInTheDocument();
  });

  it('shows a generic error and retries', async () => {
    const load = vi
      .fn<(cursor: string | null) => Promise<{ items: Row[]; nextCursor: null }>>()
      .mockRejectedValueOnce(new AdminError(500))
      .mockResolvedValueOnce({ items: [{ id: 'a' }], nextCursor: null });
    renderTable(load);
    expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de charger les lignes.');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('a')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403])('shows "Vous n’avez pas accès à cette page." on %i', async (status) => {
    renderTable(async () => {
      throw new AdminError(status);
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Vous n’avez pas accès à cette page.');
  });

  it('keeps loaded rows when load more fails and retries the same cursor', async () => {
    const load = vi
      .fn<(cursor: string | null) => Promise<{ items: Row[]; nextCursor: string | null }>>()
      .mockResolvedValueOnce({ items: [{ id: 'a' }], nextCursor: 'c1' })
      .mockRejectedValueOnce(new AdminError(503))
      .mockResolvedValueOnce({ items: [{ id: 'b' }], nextCursor: null });
    renderTable(load);
    await screen.findByText('a');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Charger plus' }));
    await screen.findByRole('alert');
    expect(screen.getByText('a')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Réessayer' }));
    await waitFor(() => expect(screen.getByText('b')).toBeInTheDocument());
    expect(load).toHaveBeenLastCalledWith('c1');
  });

  it('shows « Chargement… » on the load more button while loading', async () => {
    let resolve!: (page: { items: Row[]; nextCursor: null }) => void;
    const load = vi
      .fn<(cursor: string | null) => Promise<{ items: Row[]; nextCursor: string | null }>>()
      .mockResolvedValueOnce({ items: [{ id: 'a' }], nextCursor: 'c1' })
      .mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    renderTable(load);
    await screen.findByText('a');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Charger plus' }));
    expect(screen.getByRole('button', { name: 'Chargement…' })).toBeDisabled();
    resolve({ items: [{ id: 'b' }], nextCursor: null });
    expect(await screen.findByText('b')).toBeInTheDocument();
  });
});

describe('PaginatedTable filter', () => {
  it('filters the loaded rows client-side, reports them, and keeps load more', async () => {
    const load = vi.fn(async (cursor: string | null) =>
      cursor === null ? { items: [{ id: 'a' }, { id: 'b' }], nextCursor: 'c1' } : { items: [{ id: 'c' }], nextCursor: null },
    );
    const seen: Row[][] = [];
    render(
      <PaginatedTable
        label="Test"
        noun="les lignes"
        columns={columns}
        rowKey={(row) => row.id}
        load={load}
        filter={(row) => row.id !== 'a'}
        onItemsChange={(items) => seen.push(items)}
      />,
    );
    await screen.findByText('b');
    expect(screen.queryByText('a')).toBeNull();
    expect(seen.at(-1)).toEqual([{ id: 'a' }, { id: 'b' }]);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Charger plus' }));
    expect(await screen.findByText('c')).toBeInTheDocument();
    expect(seen.at(-1)).toHaveLength(3);
  });

  it('says so when the filter hides everything that was loaded', async () => {
    render(
      <PaginatedTable
        label="Test"
        noun="les lignes"
        columns={columns}
        rowKey={(row) => row.id}
        load={async () => ({ items: [{ id: 'a' }], nextCursor: null })}
        filter={() => false}
      />,
    );
    expect(await screen.findByText('Aucun élément chargé ne correspond à ce filtre.')).toBeInTheDocument();
  });
});
