import { notFound } from 'next/navigation';
import { BlocksGallery } from './gallery';

export default function BlocksPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <BlocksGallery />;
}
