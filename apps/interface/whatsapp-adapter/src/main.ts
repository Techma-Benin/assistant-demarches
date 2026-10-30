import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { ConfigError, loadConfig } from './config/config.js';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(config), { bodyParser: false });
  configureApp(app, config);
  await app.listen(config.port);
  logger.log(
    `Adaptateur WhatsApp démarré sur le port ${config.port} (${config.nodeEnv}) ; envoi Meta : ${config.meta.useGraphApi ? 'API Graph' : 'simulé en mémoire'}`,
  );
}

await bootstrap();
