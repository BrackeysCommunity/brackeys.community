import { createPool, Pool, PoolConnection } from 'mariadb';
import { config } from 'dotenv';

config();

/**
 * Database connection configuration
 */
type DatabaseConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit: number;
};

/**
 * Database connection pool for MariaDB
 */
class Database {
  private readonly pool: Pool;
  private static instance: Database;

  private constructor(config: DatabaseConfig) {
    this.pool = createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      connectionLimit: config.connectionLimit,
    });
  }

  /**
   * Get the database instance (Singleton pattern)
   */
  public static getInstance(): Database {
    if (!Database.instance) {
      const config: DatabaseConfig = {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '3306', 10),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'password',
        database: process.env.DB_NAME || 'brackeys',
        connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '10', 10),
      };
      Database.instance = new Database(config);
    }
    return Database.instance;
  }

  /**
   * Get a connection from the pool
   */
  public async getConnection(): Promise<PoolConnection> {
    try {
      return await this.pool.getConnection();
    } catch (error) {
      throw new Error(`Failed to get database connection: ${error}`);
    }
  }

  /**
   * Execute a query with parameters
   */
  public async query<T>(sql: string, params?: unknown[]): Promise<T> {
    let connection: PoolConnection | undefined;
    try {
      connection = await this.getConnection();
      return await connection.query(sql, params) as T;
    } catch (error) {
      throw new Error(`Database query error: ${error}`);
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }
}

export default Database.getInstance();
