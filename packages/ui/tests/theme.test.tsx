import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeToggle } from '../src/index';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('ThemeToggle', () => {
  it('cycles system, light, dark and persists', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    await user.click(screen.getByRole('button', { name: 'Thème : système' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('techma-theme')).toBe('light');
    await user.click(screen.getByRole('button', { name: 'Thème : clair' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('techma-theme')).toBe('dark');
    await user.click(screen.getByRole('button', { name: 'Thème : sombre' }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem('techma-theme')).toBeNull();
  });

  it('reads the stored value after mount', async () => {
    localStorage.setItem('techma-theme', 'dark');
    render(<ThemeToggle />);
    expect(await screen.findByRole('button', { name: 'Thème : sombre' })).toBeInTheDocument();
  });

  it('survives localStorage throwing', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const user = userEvent.setup();
    render(<ThemeToggle />);
    await user.click(screen.getByRole('button', { name: 'Thème : système' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(screen.getByRole('button', { name: 'Thème : clair' })).toBeInTheDocument();
  });
});
