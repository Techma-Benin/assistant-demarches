import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      rounded: [{ rounded: ['pill', 'card', 'field', 'tile'] }],
      shadow: [{ shadow: ['prompt'] }],
    },
  },
});

export function cn(...classes: ClassValue[]) {
  return twMerge(clsx(...classes));
}
