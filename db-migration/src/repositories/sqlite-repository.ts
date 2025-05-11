import Database from 'better-sqlite3';
import { BaseRepository } from './base-repository';
import { deserializeEFDateBlob, handleBigInt } from '../utils/serializer';

export class SqliteRepository<T> implements BaseRepository<T> {
  private readonly db: Database.Database;
  private readonly tableName: string;
  private readonly transformRow: (row: Record<string, any>) => T;

  constructor(
    dbPath: string,
    tableName: string,
    transformRow: (row: Record<string, any>) => T
  ) {
    this.db = new Database(dbPath, { readonly: true });
    // we need to allow 64-bit integer reads so that we can handle Discord snowflakes
    // https://wchargin.com/better-sqlite3/integer.html
    this.db.defaultSafeIntegers(true);
    this.tableName = tableName;
    this.transformRow = transformRow;
  }

  public async getAll(): Promise<T[]> {
    const statement = this.db.prepare(`SELECT * FROM "${this.tableName}"`);
    const rows = statement.all() as Record<string, any>[];
    return rows.map(row => this.transformRow(row));
  }

  public async getBatch(batchSize: number, offset: number): Promise<T[]> {
    const statement = this.db.prepare(
      `SELECT * FROM "${this.tableName}" LIMIT ? OFFSET ?`
    );
    const rows = statement.all(batchSize, offset) as Record<string, any>[];
    return rows.map(row => this.transformRow(row));
  }

  public async insert(_item: T): Promise<void> {
    throw new Error('Insert operation not supported for source repository');
  }

  public async bulkInsert(_items: T[]): Promise<void> {
    throw new Error('Bulk insert operation not supported for source repository');
  }

  protected deserializeDate(blob: Buffer | null): Date | null {
    if (!blob) return null;
    return deserializeEFDateBlob(blob);
  }

  protected toBigInt(value: number | string | bigint | null): bigint | null {
    if (value === null) return null;
    return handleBigInt.fromSqlite(value);
  }

  public close(): void {
    this.db.close();
  }
}
