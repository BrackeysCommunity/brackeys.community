import dotenv from 'dotenv';

dotenv.config();

export interface DatabaseConfig {
  readonly sqlite: {
    readonly path: string;
  };
  readonly mariadb: {
    readonly host: string;
    readonly port: number;
    readonly user: string;
    readonly password: string;
    readonly database: string;
  };
  readonly migration: {
    readonly batchSize: number;
  };
}

export const config: DatabaseConfig = {
  sqlite: {
    path: process.env.SQLITE_DB_PATH || './brackeys.db',
  },
  mariadb: {
    host: process.env.MARIADB_HOST || 'localhost',
    port: parseInt(process.env.MARIADB_PORT || '3306', 10),
    user: process.env.MARIADB_USER || 'root',
    password: process.env.MARIADB_PASSWORD || 'password',
    database: process.env.MARIADB_DATABASE || 'Hammer',
  },
  migration: {
    batchSize: parseInt(process.env.BATCH_SIZE || '1000', 10),
  },
};
