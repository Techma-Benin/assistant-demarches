import { Global, Module } from '@nestjs/common';
import { ProceduresModule } from '../procedures/procedures.module.js';
import { ResourcesModule } from '../resources/resources.module.js';
import { ConnectorRegistry, SimulatedConnector } from './connector.js';
import { ConnectorWorker } from './connector-worker.js';

@Global()
@Module({
  imports: [ProceduresModule, ResourcesModule],
  providers: [ConnectorRegistry, SimulatedConnector, ConnectorWorker],
  exports: [ConnectorRegistry],
})
export class ConnectorsModule {}
