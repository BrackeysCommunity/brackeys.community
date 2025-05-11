import { config } from './config/config';
import { SqliteRepository } from './repositories/sqlite-repository';
import { MariadbRepository } from './repositories/mariadb-repository';
import { MigrationService } from './utils/migration-service';
import * as Models from './models/database-models';
import * as Transformers from './transformers/transformers';

type TableConfig<T> = {
  name: string;
  targetName?: string;
  transformer: Transformers.Transformer<T>;
  model: T;
};

const tables: readonly TableConfig<unknown>[] = [
  {
    name: 'AltAccount',
    transformer: Transformers.altAccountTransformer,
    model: {} as Models.AltAccount
  },
  {
    name: 'BlockedReporter',
    transformer: Transformers.blockedReporterTransformer,
    model: {} as Models.BlockedReporter
  },
  {
    name: 'DeletedMessage',
    transformer: Transformers.deletedMessageTransformer,
    model: {} as Models.DeletedMessage
  },
  {
    name: 'Infraction',
    transformer: Transformers.infractionTransformer,
    model: {} as Models.Infraction
  },
  {
    name: 'MemberNote',
    transformer: Transformers.memberNoteTransformer,
    model: {} as Models.MemberNote
  },
  {
    name: 'Mute',
    transformer: Transformers.muteTransformer,
    model: {} as Models.Mute
  },
  {
    name: 'ReportedMessage',
    transformer: Transformers.reportedMessageTransformer,
    model: {} as Models.ReportedMessage
  },
  {
    name: 'Rule',
    transformer: Transformers.ruleTransformer,
    model: {} as Models.Rule
  },
  {
    name: 'StaffMessage',
    transformer: Transformers.staffMessageTransformer,
    model: {} as Models.StaffMessage
  },
  {
    name: 'TemporaryBan',
    transformer: Transformers.temporaryBanTransformer,
    model: {} as Models.TemporaryBan
  },
  {
    name: 'TrackedMessages', // this is plural in sqlite
    targetName: 'TrackedMessages',
    transformer: Transformers.trackedMessageTransformer,
    model: {} as Models.TrackedMessage
  }
];

const reportProgress = (tableName: string, current: number, total: number): void => {
  const percentComplete = total > 0 ? Math.round((current / total) * 100) : 0;
  console.log(`Migrating ${tableName}: ${current} records processed${total ? ` (${percentComplete}%)` : ''}`);
};

async function runMigration(): Promise<void> {
  console.log('Starting database migration process...');
  console.log(`Source: SQLite (${config.sqlite.path})`);
  console.log(`Target: MariaDB (${config.mariadb.host}:${config.mariadb.port}/${config.mariadb.database})`);
  console.log(`Batch size: ${config.migration.batchSize}`);

  const startTime = Date.now();
  let totalRecordsMigrated = 0;

  for (const table of tables) {
    try {
      console.log(`\nMigrating table: ${table.name}`);
      const sourceRepo = new SqliteRepository<typeof table.model>(
        config.sqlite.path,
        table.name,
        table.transformer.fromSqlite
      );

      const targetRepo = new MariadbRepository<typeof table.model>(
        config.mariadb,
        table.targetName || table.name,
        table.transformer.toMariaDb
      );

      const migrationService = new MigrationService<typeof table.model>(
        sourceRepo,
        targetRepo,
        table.transformer,
        table.name,
        config.migration.batchSize
      );

      const recordCount = await migrationService.migrate(reportProgress);
      totalRecordsMigrated += recordCount;

      console.log(`✅ Completed migration for ${table.name}: ${recordCount} records migrated`);

      sourceRepo.close(); // not awaited
      await targetRepo.close();
    } catch (error) {
      console.error(`❌ Error migrating table ${table.name}:`, error);
    }
  }

  const endTime = Date.now();
  const durationSeconds = (endTime - startTime) / 1000;

  console.log(`\n=== Migration Summary ===`);
  console.log(`Total records migrated: ${totalRecordsMigrated}`);
  console.log(`Total time: ${durationSeconds.toFixed(2)} seconds`);
  console.log(`Average speed: ${(totalRecordsMigrated / durationSeconds).toFixed(2)} records/second`);
}

runMigration()
  .then(() => console.log('Migration completed successfully!'))
  .catch(err => {
    console.error('Migration failed with error:', err);
    process.exit(1);
  });
