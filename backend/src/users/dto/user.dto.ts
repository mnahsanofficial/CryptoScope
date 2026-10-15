import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { Role, ROLES } from '../../auth/auth.types';

const lowerCaseTrim = () => Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));

/**
 * Password policy (NIST SP 800-63B): length matters more than character rules.
 * A max length stops "hash a 10 MB password" denial-of-service requests.
 */
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

export class CreateUserDto {
  @lowerCaseTrim()
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  password: string;

  @IsIn(ROLES)
  role: Role;
}

export class LoginDto {
  @lowerCaseTrim()
  @IsEmail()
  @MaxLength(254)
  email: string;

  // No MinLength here: the login form must not reveal the password policy of existing accounts.
  @IsString()
  @MaxLength(PASSWORD_MAX)
  password: string;
}
