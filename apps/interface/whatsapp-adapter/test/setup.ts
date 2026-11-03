import { Logger } from '@nestjs/common';

// Journaux Nest coupés par défaut ; les tests de confidentialité installent leur propre logger.
Logger.overrideLogger(false);
