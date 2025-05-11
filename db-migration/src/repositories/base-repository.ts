export interface BaseRepository<T> {
  getAll(): Promise<T[]>;

  getBatch(batchSize: number, offset: number): Promise<T[]>;

  insert(item: T): Promise<void>;

  bulkInsert(items: T[]): Promise<void>;
}
