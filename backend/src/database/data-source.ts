/**
 * DataSource for the TypeORM CLI and standalone scripts (migrations, seed, EXPLAIN demo).
 * The Nest app does not use this file; it builds the same options through TypeOrmModule.
 */
import { config as loadDotenv } from 'dotenv';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { loadConfig } from '../config/configuration';
import { buildTypeOrmOptions } from './typeorm-options';

// Same lookup as the app: backend/.env first, then the monorepo root .env. Real env vars win.
loadDotenv({ path: [join(__dirname, '../../.env'), join(__dirname, '../../../.env')], quiet: true });

// The TypeORM CLI requires exactly one export: the DataSource instance.
export default new DataSource(buildTypeOrmOptions(loadConfig().database));
