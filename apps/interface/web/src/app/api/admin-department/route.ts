import { switchDepartment } from '@/server/admin-department';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = (request: Request): Promise<Response> => switchDepartment(request);
