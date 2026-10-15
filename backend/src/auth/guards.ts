import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { AuthUser, Role } from './auth.types';
import { IS_PUBLIC_KEY, ROLES_KEY } from './decorators';

/** Reads the decorator metadata from the handler first, then from the controller class. */
function metadata<T>(reflector: Reflector, key: string, ctx: ExecutionContext): T | undefined {
  return reflector.getAllAndOverride<T>(key, [ctx.getHandler(), ctx.getClass()]);
}

/**
 * Authentication (WHO are you?). Registered globally, so every route is protected by default
 * ("secure by default"); a route must opt out explicitly with @Public().
 * Answers 401 Unauthorized when the token is missing or invalid.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (metadata<boolean>(this.reflector, IS_PUBLIC_KEY, ctx)) return true;

    const request = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Missing bearer token');
    }
    request.user = await this.auth.verify(token);
    return true;
  }
}

/**
 * Authorisation (WHAT may you do?). Runs after JwtAuthGuard.
 * Answers 403 Forbidden when the user is known but lacks the role.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = metadata<Role[]>(this.reflector, ROLES_KEY, ctx);
    if (!required?.length) return true; // any authenticated user

    const user = ctx.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user || !required.includes(user.role)) {
      throw new ForbiddenException(`Requires role: ${required.join(' or ')}`);
    }
    return true;
  }
}
