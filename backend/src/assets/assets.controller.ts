import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Paginated } from '../common/pagination';
import { Asset } from './asset.entity';
import { AssetsService } from './assets.service';
import { CreateAssetDto, ListAssetsQueryDto, UpdateAssetDto } from './dto/asset.dto';

@Controller('assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  // POST /api/assets  { "host": "github.com", "port": 443, "label": "GitHub", "environment": "production" }
  @Post()
  create(@Body() dto: CreateAssetDto): Promise<Asset> {
    return this.assets.create(dto);
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
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAssetDto): Promise<Asset> {
    return this.assets.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.assets.remove(id);
  }
}
