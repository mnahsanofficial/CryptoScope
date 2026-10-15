import { Module } from '@nestjs/common';
import { RiskController } from './risk.controller';
import { RiskEngine } from './risk-engine';

@Module({
  controllers: [RiskController],
  // Factory, because the engine's constructor takes a rules array that Nest can't inject by type.
  providers: [{ provide: RiskEngine, useFactory: () => new RiskEngine() }],
  exports: [RiskEngine],
})
export class RiskModule {}
