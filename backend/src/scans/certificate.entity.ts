import { Column, CreateDateColumn, Entity, Index, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Scan } from './scan.entity';

/**
 * A certificate seen during scans, stored once per unique fingerprint.
 * Many scans (and many hosts, e.g. a wildcard cert) can point to the same certificate.
 */
@Entity('certificates')
@Index('idx_certificates_valid_to', ['validTo'])
export class Certificate {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'pk_certificates' })
  id: string;

  // SHA-256 fingerprint as "AA:BB:..." (32 bytes -> 95 characters)
  @Index('uq_certificates_fingerprint_sha256', { unique: true })
  @Column({ type: 'varchar', length: 95 })
  fingerprintSha256: string;

  @Column({ type: 'text' })
  subject: string;

  @Column({ type: 'text' })
  issuer: string;

  @Column({ type: 'varchar', length: 128 })
  serialNumber: string;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  subjectAltNames: string[];

  @Column({ type: 'timestamptz' })
  validFrom: Date;

  @Column({ type: 'timestamptz' })
  validTo: Date;

  @Column({ type: 'varchar', length: 20 })
  keyAlgorithm: string;

  @Column({ type: 'integer', nullable: true })
  keySize: number | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  keyCurve: string | null;

  @Column({ type: 'varchar', length: 100 })
  signatureAlgorithm: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  signatureHash: string | null;

  @Column({ type: 'boolean' })
  selfSigned: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  firstSeenAt: Date;

  @OneToMany(() => Scan, (scan) => scan.certificate)
  scans: Scan[];
}
