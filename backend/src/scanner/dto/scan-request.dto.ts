import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsString, MaxLength } from 'class-validator';

export const MAX_TARGETS_PER_REQUEST = 50;

export class ScanRequestDto {
  /** Hostnames with optional port, e.g. ["github.com", "tls-v1-0.badssl.com:1010"]. */
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_TARGETS_PER_REQUEST)
  @IsString({ each: true })
  @MaxLength(260, { each: true })
  targets: string[];
}
