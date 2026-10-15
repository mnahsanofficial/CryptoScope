import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { RISK_LEVELS, RiskLevel } from '../risk/risk.types';
import { Scan } from '../scans/scan.entity';

export const ENVIRONMENTS = ['production', 'staging', 'development'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

/** Something we scan: one TLS endpoint (host + port). */
@Entity('assets')
@Unique('uq_assets_host_port', ['host', 'port'])
@Index('idx_assets_latest_risk_score', ['latestRiskScore'])
@Index('idx_assets_latest_scan_id', ['latestScanId'])
export class Asset {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'pk_assets' })
  id: string;

  @Column({ type: 'varchar', length: 253 })
  host: string;

  @Column({ type: 'integer', default: 443 })
  port: number;

  @Column({ type: 'varchar', length: 100, nullable: true })
  label: string | null;

  @Column({ type: 'enum', enum: ENVIRONMENTS, enumName: 'asset_environment', default: 'production' })
  environment: Environment;

  // Denormalised copy of the latest scan's result, so listing/sorting assets by risk needs no join.
  @Column({ type: 'smallint', nullable: true })
  latestRiskScore: number | null;

  @Column({ type: 'enum', enum: RISK_LEVELS, enumName: 'risk_level', nullable: true })
  latestRiskLevel: RiskLevel | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastScannedAt: Date | null;

  /** Newest successful scan: its findings are the asset's "current" findings. */
  @Column({ type: 'uuid', nullable: true })
  latestScanId: string | null;

  @ManyToOne(() => Scan, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'latest_scan_id', foreignKeyConstraintName: 'fk_assets_latest_scan_id' })
  latestScan: Scan | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => Scan, (scan) => scan.asset)
  scans: Scan[];
}
