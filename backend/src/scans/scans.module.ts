import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Asset } from '../assets/asset.entity';
import { RiskModule } from '../risk/risk.module';
import { ScannerModule } from '../scanner/scanner.module';
import { Certificate } from './certificate.entity';
import { Scan } from './scan.entity';
import { ScansController } from './scans.controller';
import { ScansService } from './scans.service';

@Module({
  imports: [TypeOrmModule.forFeature([Asset, Scan, Certificate]), ScannerModule, RiskModule],
  controllers: [ScansController],
  providers: [ScansService],
})
export class ScansModule {}
