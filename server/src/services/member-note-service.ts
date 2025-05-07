import db from '../config/database.js';
import { MemberNote, MemberNoteType } from '../models/types.js';

type MemberNoteQueryParams = {
  readonly guildId: bigint;
  readonly userId?: bigint;
  readonly type?: MemberNoteType;
  readonly limit?: number;
  readonly offset?: number;
};

class MemberNoteService {
  public async getMemberNotes(params: MemberNoteQueryParams): Promise<MemberNote[]> {
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

    const results = await db.query<any[]>(query, queryParams);

    return results.map(row => this.mapRowToMemberNote(row));
  }

  public async getById(id: bigint): Promise<MemberNote | null> {
    const query = 'SELECT * FROM `MemberNote` WHERE `Id` = ?';
    const results = await db.query<any[]>(query, [id]);

    if (results.length === 0) {
      return null;
    }

    return this.mapRowToMemberNote(results[0]);
  }

  public async countUserNotes(guildId: bigint, userId: bigint, type?: MemberNoteType): Promise<number> {
    let query = 'SELECT COUNT(*) as count FROM `MemberNote` WHERE `GuildId` = ? AND `UserId` = ?';
    const params: any[] = [guildId, userId];

    if (type !== undefined) {
      query += ' AND `Type` = ?';
      params.push(type);
    }

    const result = await db.query<[{ count: number }]>(query, params);
    return result[0].count;
  }

  private mapRowToMemberNote(row: any): MemberNote {
    return {
      id: BigInt(row.Id),
      authorId: BigInt(row.AuthorId),
      content: row.Content,
      creationTimestamp: row.CreationTimestamp,
      guildId: BigInt(row.GuildId),
      type: Number(row.Type) as MemberNoteType,
      userId: BigInt(row.UserId)
    };
  }
}

export default new MemberNoteService();
