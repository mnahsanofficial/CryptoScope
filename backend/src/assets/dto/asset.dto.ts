import { OmitType, PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CommaSeparated, PaginationQueryDto } from '../../common/pagination';
import { RISK_LEVELS, RiskLevel } from '../../risk/risk.types';
import { Environment, ENVIRONMENTS } from '../asset.entity';

export class CreateAssetDto {
  // Format is checked in the service with the same parser the scanner uses.
  @IsString()
  @MaxLength(253)
  host: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @IsOptional()
  @IsIn(ENVIRONMENTS)
  environment?: Environment;

  /** Queue a scan right after creating the asset (default true). Set false for bulk imports. */
  @IsOptional()
  @IsBoolean()
  scanNow?: boolean;
}

/** Every field optional for PATCH. `scanNow` only makes sense when creating. */
export class UpdateAssetDto extends PartialType(OmitType(CreateAssetDto, ['scanNow'] as const)) {}

export const ASSET_SORT_FIELDS = ['riskScore', 'host', 'lastScannedAt', 'createdAt'] as const;

export class ListAssetsQueryDto extends PaginationQueryDto {
  /** Case-insensitive substring match on host. */
  @IsOptional()
  @IsString()
  @MaxLength(253)
  search?: string;

  @IsOptional()
  @CommaSeparated()
  @IsIn(RISK_LEVELS, { each: true })
  riskLevel?: RiskLevel[];

  @IsOptional()
  @IsIn(ENVIRONMENTS)
  environment?: Environment;

  @IsOptional()
  @IsIn(ASSET_SORT_FIELDS)
  sort: (typeof ASSET_SORT_FIELDS)[number] = 'riskScore';
}
