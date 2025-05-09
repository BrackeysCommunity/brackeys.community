import db from '../config/database.js';
import { Infraction, InfractionDb, InfractionType } from '../models/hammer.js';
import { deserializeEFDateBlob } from '../utils/serializer.js';

type InfractionQueryParams = {
  readonly guildId: bigint;
  readonly userId?: bigint;
  readonly type?: InfractionType;
  readonly limit?: number;
  readonly offset?: number;
};

const getInfractions = async (params: InfractionQueryParams): Promise<Infraction[]> => {
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

  const results = await db.query<InfractionDb[]>(query, queryParams);

  return results.map(mapRowToInfraction);
};

const getByUserId = async (userId: bigint): Promise<Infraction[] | null> => {
  const query = 'SELECT * FROM `Infraction` WHERE `UserId` = ?';
  const results = await db.query<InfractionDb[]>(query, [userId]);

  if (results.length === 0) {
    return null;
  }

  return results.map(mapRowToInfraction);
};

const mapRowToInfraction = (row: InfractionDb): Infraction => {
  return {
    id: BigInt(row.Id),
    guildId: BigInt(row.GuildId),
    issuedAt: deserializeEFDateBlob(row.IssuedAt),
    reason: row.Reason,
    ruleId: Number(row.RuleId || null),
    ruleText: row.RuleText,
    staffMemberId: BigInt(row.StaffMemberId),
    type: Number(row.Type) as InfractionType,
    userId: BigInt(row.UserId),
    additionalInformation: row.AdditionalInformation
  };
};

export default { getInfractions, getByUserId };

