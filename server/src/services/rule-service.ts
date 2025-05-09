import db from '../config/database';
import { Rule, RuleDb } from '../models/hammer';

const getAllByGuildId = async (guildId: bigint): Promise<Rule[]> => {
  const query = 'SELECT * FROM `Rule` WHERE `GuildId` = ? ORDER BY `Id`';
  const results = await db.query<RuleDb[]>(query, [guildId]);

  return results.map(mapRowToRule);
};

const getById = async (id: bigint, guildId: bigint): Promise<Rule | null> => {
  const query = 'SELECT * FROM `Rule` WHERE `Id` = ? AND `GuildId` = ?';
  const results = await db.query<RuleDb[]>(query, [id, guildId]);

  return results.length > 0 ? mapRowToRule(results[0]) : null;
};

const mapRowToRule = (row: RuleDb): Rule => ({
  guildId: BigInt(row.GuildId),
  id: BigInt(row.Id),
  brief: row.Brief,
  description: row.Description
});

export default {
  getAllByGuildId,
  getById
};
