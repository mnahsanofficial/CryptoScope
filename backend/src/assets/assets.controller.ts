import { Body, Controller, Delete, Get, HttpCode, Logger, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { Paginated } from '../common/pagination';
import { EnqueuedJob, ScanQueueService } from '../scan-jobs/scan-queue.service';
import { Asset } from './asset.entity';
import { AssetsService } from './assets.service';
import { CreateAssetDto, ListAssetsQueryDto, UpdateAssetDto } from './dto/asset.dto';

@Controller('assets')
export class AssetsController {
  private readonly logger = new Logger(AssetsController.name);

  constructor(
    private readonly assets: AssetsService,
    private readonly scanQueue: ScanQueueService,
  ) {}

  // POST /api/assets  { "host": "github.com", "port": 443, "label": "GitHub", "environment": "production", "scanNow": true }
  // Creates the asset and, unless scanNow is false, queues its first scan right away (progress over Socket.IO).
  @Post()
  @Roles('admin')
  async create(@Body() { scanNow = true, ...dto }: CreateAssetDto): Promise<Asset & { scanJob: EnqueuedJob | null }> {
    const asset = await this.assets.create(dto);
    if (!scanNow) return { ...asset, scanJob: null };
    try {
      return { ...asset, scanJob: await this.scanQueue.enqueueAsset(asset.id) };
    } catch (err) {
      // The asset is saved either way; a scan can be started later. Losing the asset would be worse.
      this.logger.warn(`Asset ${asset.host} created, but its first scan could not be queued: ${(err as Error).message}`);
      return { ...asset, scanJob: null };
    }
  }

  // GET /api/assets?search=bank&riskLevel=critical,high&sort=riskScore&order=desc&page=1&pageSize=20
  @Get()
  list(@Query() query: ListAssetsQueryDto): Promise<Paginated<Asset>> {
    return this.assets.list(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Asset> {
    return this.assets.findOne(id);
  }

  @Patch(':id')
  @Roles('admin')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAssetDto): Promise<Asset> {
    return this.assets.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.assets.remove(id);
  }
}
