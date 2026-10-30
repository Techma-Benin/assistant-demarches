import type { DepartmentAdminPaths } from '@techma/contracts-ts';

type Ok<Op extends { responses: { 200: { content: { 'application/json': unknown } } } }> =
  Op['responses'][200]['content']['application/json'];

/** `GET /v1/admin/me`. */
export type AdminProfile = Ok<NonNullable<DepartmentAdminPaths['/v1/admin/me']['get']>>;
export type AdminMembership = AdminProfile['memberships'][number];
/** `GET /v1/admin/departments` item. */
export type Department = Ok<NonNullable<DepartmentAdminPaths['/v1/admin/departments']['get']>>['items'][number];

export interface SessionOption {
  id: string;
  label: string;
}
