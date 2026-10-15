import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
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

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => Scan, (scan) => scan.asset)
  scans: Scan[];
}
