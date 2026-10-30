import { currentSession, switchSession } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = (request: Request): Response => currentSession(request);
export const POST = (request: Request): Promise<Response> => switchSession(request);
