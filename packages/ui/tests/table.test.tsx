import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '../src/index';

describe('Table', () => {
  it('renders an accessible table inside a horizontally scrollable container', () => {
    render(
      <Table aria-label="Démarches">
        <TableHead>
          <TableRow>
            <TableHeaderCell>Titre</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          <TableRow>
            <TableCell>Passeport</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const table = screen.getByRole('table', { name: 'Démarches' });
    expect(table.parentElement?.className).toContain('overflow-x-auto');
    expect(screen.getByRole('columnheader', { name: 'Titre' })).toHaveAttribute('scope', 'col');
    expect(screen.getByRole('cell', { name: 'Passeport' })).toBeInTheDocument();
    expect(screen.getAllByRole('row')[0].className).toContain('h-11');
  });

  it('merges custom classes', () => {
    render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell className="font-mono">x</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(screen.getByRole('cell').className).toContain('font-mono');
  });
});
