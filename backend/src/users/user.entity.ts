import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { Role, ROLES } from '../auth/auth.types';

@Entity('users')
@Unique('uq_users_email', ['email'])
export class User {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'pk_users' })
  id: string;

  // Stored lower-cased, so "Admin@X.com" and "admin@x.com" are the same account.
  @Column({ type: 'varchar', length: 254 })
  email: string;

  // Never returned by the API (see UsersService.toPublic). select: false keeps it out of normal queries.
  @Column({ type: 'varchar', length: 255, select: false })
  passwordHash: string;

  @Column({ type: 'enum', enum: ROLES, enumName: 'user_role', default: 'viewer' })
  role: Role;

  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
