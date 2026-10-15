import { IsBase64, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { SignatureAlgorithm, SIGNATURE_ALGORITHMS } from '../crypto-provider';

export class SignDto {
  @IsString()
  @MinLength(1)
  @MaxLength(10_000)
  message: string;

  /** Optional override of the configured algorithm (to compare algorithms or test a migration). */
  @IsOptional()
  @IsIn(SIGNATURE_ALGORITHMS)
  algorithm?: SignatureAlgorithm;
}

export class VerifyDto {
  @IsString()
  @MaxLength(10_000)
  message: string;

  @IsIn(SIGNATURE_ALGORITHMS)
  algorithm: SignatureAlgorithm;

  // Large enough for a hybrid ECDSA + ML-DSA-65 signature (~3.4 KB raw, ~4.6 KB in base64).
  @IsBase64()
  @MaxLength(20_000)
  signature: string;

  @IsOptional()
  @Matches(/^[0-9a-f]{16}$/)
  keyId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  publicKey?: string;
}
