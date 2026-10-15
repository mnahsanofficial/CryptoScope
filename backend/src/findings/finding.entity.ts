import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Asset } from '../assets/asset.entity';
import { FINDING_CATEGORIES, Finding as RiskFinding, FindingCategory, SEVERITIES, Severity } from '../risk/risk.types';
import { Scan } from '../scans/scan.entity';

/** One risk finding produced by one scan. */
@Entity('findings')
@Index('idx_findings_scan_id', ['scanId'])
@Index('idx_findings_asset_id_created_at', ['assetId', 'createdAt'])
// Added in a separate migration as the query-optimisation demo (see docs/query-optimization.md):
// serves "findings with severity X, newest first" without scanning and sorting the whole table.
// `id` is included because the API uses it as the tie-breaker in ORDER BY.
@Index('idx_findings_severity_created_at', ['severity', 'createdAt', 'id'])
export class Finding {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'pk_findings' })
  id: string;

  @Column({ type: 'uuid' })
  scanId: string;

  @ManyToOne(() => Scan, (scan) => scan.findings, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'scan_id', foreignKeyConstraintName: 'fk_findings_scan_id' })
  scan: Scan;

  // Denormalised (also reachable via scan.asset_id) so "findings for asset X" needs no join.
  @Column({ type: 'uuid' })
  assetId: string;

  @ManyToOne(() => Asset, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'asset_id', foreignKeyConstraintName: 'fk_findings_asset_id' })
  asset: Asset;

  @Column({ type: 'varchar', length: 50 })
  ruleId: string;

  // Postgres enums sort in declaration order (critical < high < medium < low), so ORDER BY works.
  @Column({ type: 'enum', enum: SEVERITIES, enumName: 'finding_severity' })
  severity: Severity;

  @Column({ type: 'enum', enum: FINDING_CATEGORIES, enumName: 'finding_category' })
  category: FindingCategory;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'text' })
  recommendation: string;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  evidence: RiskFinding['evidence'];

  // Plain column (not @CreateDateColumn) so the seed script can back-date rows.
  @Column({ type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
}
