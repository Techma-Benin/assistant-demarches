import { Logger } from '@nestjs/common';

/** Journal structuré `événement {json}` ; l’appelant ne passe jamais de numéro, texte ou jeton. */
export function line(event: string, fields: Record<string, string | number | boolean | undefined> = {}): string {
  return `${event} ${JSON.stringify(fields)}`;
}

export const loggerFor = (context: string): Logger => new Logger(context);
