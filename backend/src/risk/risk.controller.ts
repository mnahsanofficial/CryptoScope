import { Controller, Get } from '@nestjs/common';
import { RiskEngine, SEVERITY_WEIGHTS } from './risk-engine';

@Controller('risk')
export class RiskController {
  constructor(private readonly engine: RiskEngine) {}

  // GET /api/risk/rules — documents every rule and how severities turn into a score
  @Get('rules')
  rules() {
    return { severityWeights: SEVERITY_WEIGHTS, maxScore: 100, rules: this.engine.listRules() };
  }
}
