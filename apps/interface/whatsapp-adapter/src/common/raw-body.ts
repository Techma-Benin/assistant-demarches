import type { Request, Response } from 'express';

export type RawBodyRequest = Request & { rawBody?: Buffer };

export type TooLargeHandler = (req: RawBodyRequest, res: Response) => void;

/**
 * Middleware qui conserve les octets bruts du corps dans `req.rawBody` (nécessaire pour la
 * signature Meta, vérifiée avant tout parsing JSON). Dépassement de `limitBytes` : `onTooLarge`
 * répond immédiatement, le reste du flux est lu et ignoré sans être mis en mémoire.
 */
export function rawBodyMiddleware(limitBytes: number, onTooLarge: TooLargeHandler) {
  return (req: RawBodyRequest, res: Response, next: (err?: unknown) => void): void => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      next();
      return;
    }
    const declared = Number(req.headers['content-length']);
    const chunks: Buffer[] = [];
    let size = 0;
    let rejected = false;
    const reject = () => {
      if (rejected) return;
      rejected = true;
      chunks.length = 0;
      onTooLarge(req, res);
    };
    if (Number.isFinite(declared) && declared > limitBytes) reject();
    req.on('data', (chunk: Buffer) => {
      if (rejected) return;
      size += chunk.length;
      if (size > limitBytes) {
        reject();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (rejected) return;
      req.rawBody = Buffer.concat(chunks);
      next();
    });
    req.on('error', (err) => {
      if (!rejected) next(err);
    });
  };
}
