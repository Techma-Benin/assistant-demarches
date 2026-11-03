import type { Metadata } from 'next';
import { MyCases } from '@/components/app/MyCases';

export const metadata: Metadata = { title: 'Mes démarches' };

export default function Page() {
  return <MyCases />;
}
