export const ROLES = ['admin', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

/** What we put inside the JWT. Keep it small and never include secrets: anyone can decode a JWT. */
export interface JwtPayload {
  sub: string; // user id
  email: string;
  role: Role;
}

/** The authenticated user attached to each request by the auth guard. */
export interface AuthUser {
  id: string;
  email: string;
  role: Role;
}

export const JWT_ISSUER = 'cryptoscope';
export const JWT_AUDIENCE = 'cryptoscope-api';
