import type { Schemas } from '@techma/contracts-ts';

/** `GET /v1/admin/me`: `{ official, administration, permissions }`. */
export type AdminProfile = Schemas['Me'];
export type Official = Schemas['Official'];
export type OfficialRole = Schemas['OfficialRole'];
export type Administration = Schemas['Administration'];
export type Permission = Schemas['Permission'];
