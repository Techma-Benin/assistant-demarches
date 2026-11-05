import { redirect } from 'next/navigation';

// Former address of the status page, now the landing page of the console.
export default function Page() {
  redirect('/operateur');
}
