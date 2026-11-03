import { switchAdministration } from '@/server/admin-administration';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = (request: Request): Promise<Response> => switchAdministration(request);
