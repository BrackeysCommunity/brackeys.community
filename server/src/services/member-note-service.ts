import db from '../config/database.js';
import { MemberNote, MemberNoteDb, MemberNoteType } from '../models/hammer.js';
import { deserializeEFDateBlob } from '../utils/serializer.js';

type MemberNoteQueryParams = {
  readonly guildId: bigint;
  readonly userId?: bigint;
  readonly type?: MemberNoteType;
  readonly limit?: number;
  readonly offset?: number;
};

const getMemberNotes = async (params: MemberNoteQueryParams): Promise<MemberNote[]> => {
  const { guildId, userId, type, limit = 50, offset = 0 } = params;

  let query = 'SELECT * FROM `MemberNote` WHERE `GuildId` = ?';
  const queryParams: any[] = [guildId];

  if (userId !== undefined) {
    query += ' AND `UserId` = ?';
    queryParams.push(userId);
  }

  if (type !== undefined) {
    query += ' AND `Type` = ?';
    queryParams.push(type);
  }

  query += ' ORDER BY `CreationTimestamp` DESC LIMIT ? OFFSET ?';
  queryParams.push(limit, offset);

  const results = await db.query<MemberNoteDb[]>(query, queryParams);

  return results.map(mapRowToMemberNote);
};

const getByUserId = async (userId: bigint): Promise<MemberNote[] | null> => {
  const query = 'SELECT * FROM `MemberNote` WHERE `UserId` = ?';
  const results = await db.query<MemberNoteDb[]>(query, [userId]);

  return results.map(mapRowToMemberNote);
};

const mapRowToMemberNote = (row: MemberNoteDb): MemberNote => {
  return {
    id: BigInt(row.Id),
    authorId: BigInt(row.AuthorId),
    content: row.Content,
    creationTimestamp: deserializeEFDateBlob(row.CreationTimestamp),
    guildId: BigInt(row.GuildId),
    type: Number(row.Type) as MemberNoteType,
    userId: BigInt(row.UserId)
  };
};

export default {
  getMemberNotes,
  getByUserId,
};
