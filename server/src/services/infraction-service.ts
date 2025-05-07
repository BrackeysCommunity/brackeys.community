import db from '../config/database.js';
import { Infraction, InfractionType } from '../models/types.js';

type InfractionQueryParams = {
  readonly guildId: bigint;
  readonly userId?: bigint;
  readonly type?: InfractionType;
  readonly limit?: number;
  readonly offset?: number;
};

class InfractionService {
  public async getInfractions(params: InfractionQueryParams): Promise<Infraction[]> {
    const { guildId, userId, type, limit = 50, offset = 0 } = params;

    let query = 'SELECT * FROM `Infraction` WHERE `GuildId` = ?';
    const queryParams: any[] = [guildId];

    if (userId !== undefined) {
      query += ' AND `UserId` = ?';
      queryParams.push(userId);
    }

    if (type !== undefined) {
      query += ' AND `Type` = ?';
      queryParams.push(type);
    }

    query += ' ORDER BY `IssuedAt` DESC LIMIT ? OFFSET ?';
    queryParams.push(limit, offset);

    const results = await db.query<any[]>(query, queryParams);

    return results.map(row => this.mapRowToInfraction(row));
  }

  public async getById(id: bigint): Promise<Infraction | null> {
    const query = 'SELECT * FROM `Infraction` WHERE `Id` = ?';
    const results = await db.query<any[]>(query, [id]);

    if (results.length === 0) {
      return null;
    }

    return this.mapRowToInfraction(results[0]);
  }

  public async countUserInfractions(guildId: bigint, userId: bigint, type?: InfractionType): Promise<number> {
    let query = 'SELECT COUNT(*) as count FROM `Infraction` WHERE `GuildId` = ? AND `UserId` = ?';
    const params: any[] = [guildId, userId];

    if (type !== undefined) {
      query += ' AND `Type` = ?';
      params.push(type);
    }

    const result = await db.query<[{ count: number }]>(query, params);
    return result[0].count;
  }

  /**
   * Map database row to Infraction type
   */
  private mapRowToInfraction(row: any): Infraction {
    return {
      id: BigInt(row.Id),
      guildId: BigInt(row.GuildId),
      issuedAt: row.IssuedAt,
      reason: row.Reason,
      ruleId: row.RuleId !== null ? Number(row.RuleId) : null,
      ruleText: row.RuleText,
      staffMemberId: BigInt(row.StaffMemberId),
      type: Number(row.Type) as InfractionType,
      userId: BigInt(row.UserId),
      additionalInformation: row.AdditionalInformation
    };
  }
}

export default new InfractionService();
