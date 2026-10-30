import { notFound } from 'next/navigation';
import { DesignGuide } from './guide';

export default function DesignPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <DesignGuide />;
}
