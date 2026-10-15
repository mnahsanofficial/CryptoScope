import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Paginated, PaginationQueryDto } from '../common/pagination';
import { Scan } from './scan.entity';
import { ScansService } from './scans.service';

@Controller()
export class ScansController {
  constructor(private readonly scans: ScansService) {}

  // POST /api/assets/:assetId/scans — scan the asset now and store the result
  @Post('assets/:assetId/scans')
  scanAsset(@Param('assetId', ParseUUIDPipe) assetId: string): Promise<Scan> {
    return this.scans.scanAsset(assetId);
  }

  // GET /api/assets/:assetId/scans?page=1&pageSize=20 — scan history, newest first
  @Get('assets/:assetId/scans')
  listForAsset(
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<Scan>> {
    return this.scans.listForAsset(assetId, query);
  }

  // GET /api/scans/:id — one scan with its certificate and findings
  @Get('scans/:id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Scan> {
    return this.scans.findOne(id);
  }
}
