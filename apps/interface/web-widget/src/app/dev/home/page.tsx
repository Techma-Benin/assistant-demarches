'use client';

import { FrontDoor } from '@/components/home/FrontDoor';

export default function DevHomePage() {
  if (process.env.NODE_ENV === 'production') return null;
  return <FrontDoor onAsk={() => {}} />;
}
