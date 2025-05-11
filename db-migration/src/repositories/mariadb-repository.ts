import knex, { Knex } from 'knex';
import { BaseRepository } from './base-repository';

export class MariadbRepository<T> implements BaseRepository<T> {
  private readonly db: Knex;
  private readonly tableName: string;
  private readonly transformForInsert: (item: T) => Record<string, any>;

  constructor(
    config: {
      host: string;
      port: number;
      user: string;
      password: string;
      database: string;
    },
    tableName: string,
    transformForInsert: (item: T) => Record<string, any>
  ) {
    this.db = knex({
      client: 'mysql2',
      connection: {
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
      },
      pool: { min: 0, max: 10 },
    });
    this.tableName = tableName;
    this.transformForInsert = transformForInsert;
  }

  public async getAll(): Promise<T[]> {
    return this.db(this.tableName).select('*');
  }

  public async getBatch(batchSize: number, offset: number): Promise<T[]> {
    return this.db(this.tableName).select('*').limit(batchSize).offset(offset);
  }

  public async insert(item: T): Promise<void> {
    await this.db(this.tableName).insert(this.transformForInsert(item));
  }

  public async bulkInsert(items: T[]): Promise<void> {
    if (items.length === 0) return;
    const transformedItems = items.map(this.transformForInsert);

    await this.db(this.tableName).insert(transformedItems);
  }

  public async close(): Promise<void> {
    await this.db.destroy();
  }
}
