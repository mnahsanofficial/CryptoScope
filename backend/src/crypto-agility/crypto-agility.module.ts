import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';
import { CryptoController } from './crypto.controller';
import { CryptoProviderRegistry } from './crypto-provider.registry';
import { ACTIVE_CRYPTO_PROVIDER, SigningService } from './signing.service';

@Module({
  controllers: [CryptoController],
  providers: [
    { provide: CryptoProviderRegistry, useFactory: () => new CryptoProviderRegistry() },
    {
      // The ONE place an algorithm is chosen. Callers inject SigningService and never see it.
      provide: ACTIVE_CRYPTO_PROVIDER,
      inject: [CryptoProviderRegistry, ConfigService],
      useFactory: (registry: CryptoProviderRegistry, config: ConfigService) =>
        registry.resolveActive(config.getOrThrow<AppConfig['crypto']>('crypto').signatureAlgorithm),
    },
    SigningService,
  ],
  exports: [SigningService],
})
export class CryptoAgilityModule {}
