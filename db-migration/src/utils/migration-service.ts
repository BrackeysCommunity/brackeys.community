import { BaseRepository } from '../repositories/base-repository';
import { Transformer } from '../transformers/transformers';

export class MigrationService<T> {
  private readonly sourceRepo: BaseRepository<T>;
  private readonly targetRepo: BaseRepository<T>;
  private readonly transformer: Transformer<T>;
  private readonly tableName: string;
  private readonly batchSize: number;

  constructor(
    sourceRepo: BaseRepository<T>,
    targetRepo: BaseRepository<T>,
    transformer: Transformer<T>,
    tableName: string,
    batchSize: number = 1000
  ) {
    this.sourceRepo = sourceRepo;
    this.targetRepo = targetRepo;
    this.transformer = transformer;
    this.tableName = tableName;
    this.batchSize = batchSize;
  }

  public async migrate(
    onProgress?: (tableName: string, current: number, total: number) => void
  ): Promise<number> {
    let offset = 0;
    let totalMigrated = 0;
    let batchCount: number;

    do {
      const sourceBatch = await this.sourceRepo.getBatch(this.batchSize, offset);
      batchCount = sourceBatch.length;

      if (batchCount > 0) {
        await this.targetRepo.bulkInsert(sourceBatch);

        totalMigrated += batchCount;
        offset += batchCount;

        if (onProgress) {
          onProgress(this.tableName, totalMigrated, 0);
        }
      }
    } while (batchCount === this.batchSize);

    return totalMigrated;
  }
}
