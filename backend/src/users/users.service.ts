import { ConflictException, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '../auth/auth.types';
import { PasswordHasher } from '../auth/password-hasher';
import { isUniqueViolation } from '../common/db-errors';
import { AppConfig } from '../config/configuration';
import { User } from './user.entity';

export type PublicUser = Pick<User, 'id' | 'email' | 'role' | 'lastLoginAt' | 'createdAt'>;

@Injectable()
export class UsersService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly hasher: PasswordHasher,
    private readonly config: ConfigService,
  ) {}

  /**
   * First start: if no user exists and ADMIN_EMAIL/ADMIN_PASSWORD are set, create that admin.
   * The credentials come from the environment, never from code.
   */
  async onApplicationBootstrap(): Promise<void> {
    const admin = this.config.getOrThrow<AppConfig['auth']>('auth').bootstrapAdmin;
    if ((await this.users.count()) > 0) return;
    if (!admin) {
      this.logger.warn('No users exist. Set ADMIN_EMAIL and ADMIN_PASSWORD to create the first admin.');
      return;
    }
    try {
      await this.create(admin.email, admin.password, 'admin');
      this.logger.log(`Created initial admin ${admin.email.toLowerCase()}`);
    } catch (err) {
      // Another instance may have created it at the same moment.
      if (!(err instanceof ConflictException)) throw err;
    }
  }

  async create(email: string, password: string, role: Role): Promise<PublicUser> {
    const passwordHash = await this.hasher.hash(password);
    try {
      const user = await this.users.save(this.users.create({ email: email.trim().toLowerCase(), passwordHash, role }));
      return toPublic(user);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException(`User ${email} already exists`);
      throw err;
    }
  }

  async list(): Promise<PublicUser[]> {
    const users = await this.users.find({ order: { createdAt: 'ASC' } });
    return users.map(toPublic);
  }

  /** Includes the password hash: for the login check only. */
  findForLogin(email: string): Promise<User | null> {
    return this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email: email.trim().toLowerCase() })
      .getOne();
  }

  findById(id: string): Promise<User | null> {
    return this.users.findOneBy({ id });
  }

  async recordLogin(id: string, newPasswordHash?: string): Promise<void> {
    await this.users.update(id, { lastLoginAt: new Date(), ...(newPasswordHash ? { passwordHash: newPasswordHash } : {}) });
  }
}

export function toPublic(user: User): PublicUser {
  return { id: user.id, email: user.email, role: user.role, lastLoginAt: user.lastLoginAt, createdAt: user.createdAt };
}
