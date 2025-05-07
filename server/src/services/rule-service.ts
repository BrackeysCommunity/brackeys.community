import db from '../config/database';
import { Rule, RuleDb } from '../models/types';

class RuleService {
  public async getAllByGuildId(guildId: bigint): Promise<Rule[]> {
    const query = 'SELECT * FROM `Rule` WHERE `GuildId` = ? ORDER BY `Id`';
    const results = await db.query<RuleDb[]>(query, [guildId]);

    return results.map(rule => ({
      guildId: BigInt(rule.GuildId),
      id: BigInt(rule.Id),
      brief: rule.Brief,
      description: rule.Description
    }));
  }

  public async getById(id: bigint, guildId: bigint): Promise<Rule | null> {
    const query = 'SELECT * FROM `Rule` WHERE `Id` = ? AND `GuildId` = ?';
    const results = await db.query<RuleDb[]>(query, [id, guildId]);

    if (results.length === 0) {
      return null;
    }

    const rule = results[0];
    return {
      guildId: BigInt(rule.GuildId),
      id: BigInt(rule.Id),
      brief: rule.Brief,
      description: rule.Description
    };
  }
}

export default new RuleService();
