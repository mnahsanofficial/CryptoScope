import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Asset } from '../assets/asset.entity';
import { Finding } from '../findings/finding.entity';
import { RISK_LEVELS, RiskLevel } from '../risk/risk.types';
import { Certificate } from './certificate.entity';

export const SCAN_STATUSES = ['success', 'failed'] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

/** One scan of one asset at a point in time. Kept forever, so we have history. */
@Entity('scans')
// Postgres does NOT index foreign keys automatically. These serve "scans of asset X, newest first"
// and keep ON DELETE CASCADE / SET NULL from scanning the whole table.
@Index('idx_scans_asset_id_scanned_at', ['assetId', 'scannedAt'])
@Index('idx_scans_certificate_id', ['certificateId'])
export class Scan {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'pk_scans' })
  id: string;

  @Column({ type: 'uuid' })
  assetId: string;

  @ManyToOne(() => Asset, (asset) => asset.scans, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'asset_id', foreignKeyConstraintName: 'fk_scans_asset_id' })
  asset: Asset;

  @Column({ type: 'enum', enum: SCAN_STATUSES, enumName: 'scan_status' })
  status: ScanStatus;

  @Column({ type: 'timestamptz' })
  scannedAt: Date;

  @Column({ type: 'integer' })
  durationMs: number;

  // --- TLS details (null when the scan failed) ---
  @Column({ type: 'varchar', length: 16, nullable: true })
  protocol: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  cipher: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  keyExchange: string | null;

  @Column({ type: 'boolean', nullable: true })
  postQuantumKeyExchange: boolean | null;

  @Column({ type: 'boolean', nullable: true })
  trustAuthorized: boolean | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  trustError: string | null;

  // --- Failure details (null when the scan succeeded) ---
  @Column({ type: 'varchar', length: 50, nullable: true })
  errorCode: string | null;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  // --- Risk assessment of this scan ---
  @Column({ type: 'smallint', nullable: true })
  riskScore: number | null;

  @Column({ type: 'enum', enum: RISK_LEVELS, enumName: 'risk_level', nullable: true })
  riskLevel: RiskLevel | null;

  @Column({ type: 'uuid', nullable: true })
  certificateId: string | null;

  // If a certificate row is ever deleted, keep the scan history but drop the link.
  @ManyToOne(() => Certificate, (cert) => cert.scans, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'certificate_id', foreignKeyConstraintName: 'fk_scans_certificate_id' })
  certificate: Certificate | null;

  @OneToMany(() => Finding, (finding) => finding.scan)
  findings: Finding[];
}
