import { Global, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@elastic/elasticsearch';
import { AppConfig } from '../config/configuration';

@Global()
@Module({
  providers: [
    {
      // The Client class itself is the injection token, so services can just ask for `Client`.
      provide: Client,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const { node } = config.getOrThrow<AppConfig['elasticsearch']>('elasticsearch');
        return new Client({ node, requestTimeout: 10_000 });
      },
    },
  ],
  exports: [Client],
})
export class ElasticsearchModule implements OnApplicationShutdown {
  constructor(private readonly client: Client) {}

  async onApplicationShutdown(): Promise<void> {
    await this.client.close();
  }
}
