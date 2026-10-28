import { Global, Module } from '@nestjs/common';
import { BUTTON_ID_MAP, CONVERSATION_DIRECTORY, DEDUPE_STORE, FORM_SESSION_STORE } from '../tokens.js';
import {
  InMemoryButtonIdMap,
  InMemoryConversationDirectory,
  InMemoryDedupeStore,
  InMemoryFormSessionStore,
} from './in-memory.js';

// Implémentations en mémoire : à remplacer par Redis/PostgreSQL lors de la tâche de persistance.
@Global()
@Module({
  providers: [
    { provide: DEDUPE_STORE, useFactory: () => new InMemoryDedupeStore() },
    { provide: CONVERSATION_DIRECTORY, useFactory: () => new InMemoryConversationDirectory() },
    { provide: FORM_SESSION_STORE, useFactory: () => new InMemoryFormSessionStore() },
    { provide: BUTTON_ID_MAP, useFactory: () => new InMemoryButtonIdMap() },
  ],
  exports: [DEDUPE_STORE, CONVERSATION_DIRECTORY, FORM_SESSION_STORE, BUTTON_ID_MAP],
})
export class StorageModule {}
