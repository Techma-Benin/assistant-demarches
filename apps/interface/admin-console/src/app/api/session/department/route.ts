import { switchDepartment } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = (request: Request): Promise<Response> => switchDepartment(request);
