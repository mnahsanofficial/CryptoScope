import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PublicUser, toPublic, UsersService } from '../users/users.service';
import { AuthUser, JWT_AUDIENCE, JWT_ISSUER, JwtPayload } from './auth.types';
import { PasswordHasher } from './password-hasher';

const INVALID_CREDENTIALS = 'Invalid email or password';

@Injectable()
export class AuthService {
  /** Hash of a random password, compared against when the email doesn't exist (see login). */
  private readonly dummyHash: Promise<string>;

  constructor(
    private readonly users: UsersService,
    private readonly hasher: PasswordHasher,
    private readonly jwt: JwtService,
  ) {
    this.dummyHash = hasher.hash(`dummy-${Math.random()}`);
  }

  async login(email: string, password: string): Promise<{ accessToken: string; tokenType: 'Bearer'; user: PublicUser }> {
    const user = await this.users.findForLogin(email);

    // Always do the slow hash check, even for unknown emails. Otherwise "unknown email" answers in 1 ms
    // and "wrong password" in 170 ms, and an attacker could learn which emails have accounts.
    const valid = await this.hasher.verify(password, user?.passwordHash ?? (await this.dummyHash));
    if (!user || !valid) throw new UnauthorizedException(INVALID_CREDENTIALS); // same message for both cases

    // Upgrade old hashes transparently at login, the only time we know the plain password.
    const upgraded = this.hasher.needsRehash(user.passwordHash) ? await this.hasher.hash(password) : undefined;
    await this.users.recordLogin(user.id, upgraded);

    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role };
    return { accessToken: await this.jwt.signAsync(payload), tokenType: 'Bearer', user: toPublic(user) };
  }

  /**
   * Verifies signature, expiry, issuer, audience AND pins the algorithm to HS256, so a token
   * with "alg": "none" or a different algorithm is rejected.
   */
  async verify(token: string): Promise<AuthUser> {
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        algorithms: ['HS256'],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });
      return { id: payload.sub, email: payload.email, role: payload.role };
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
