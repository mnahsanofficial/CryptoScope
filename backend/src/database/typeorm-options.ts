import { join } from 'node:path';
import { DataSourceOptions } from 'typeorm';
import { Asset } from '../assets/asset.entity';
import { AppConfig } from '../config/configuration';
import { Finding } from '../findings/finding.entity';
import { Certificate } from '../scans/certificate.entity';
import { Scan } from '../scans/scan.entity';
import { SnakeNamingStrategy } from './snake-naming.strategy';

export const ENTITIES = [Asset, Scan, Certificate, Finding];

/** Shared by the Nest app, the TypeORM CLI (migrations) and the seed script. */
export function buildTypeOrmOptions(db: AppConfig['database']): DataSourceOptions {
  return {
    type: 'postgres',
    host: db.host,
    port: db.port,
    username: db.username,
    password: db.password,
    database: db.name,
    entities: ENTITIES,
    // .ts when run with ts-node (CLI, seed), .js in the compiled Docker image
    migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
    namingStrategy: new SnakeNamingStrategy(),
    // gen_random_uuid() is built into Postgres 13+, no uuid-ossp extension needed.
    uuidExtension: 'pgcrypto',
    // Never let TypeORM change the schema on its own; every change is a reviewed migration.
    synchronize: false,
  };
}
