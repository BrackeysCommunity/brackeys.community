import { deserializeEFDateBlob, handleBigInt } from '../utils/serializer';
import * as Models from '../models/database-models';

export interface Transformer<T> {
  fromSqlite(row: Record<string, any>): T;
  toMariaDb(entity: T): Record<string, any>;
}

export const altAccountTransformer: Transformer<Models.AltAccount> = {
  fromSqlite(row: Record<string, any>): Models.AltAccount {
    return {
      userId: handleBigInt.fromSqlite(row.UserId),
      altId: handleBigInt.fromSqlite(row.AltId),
      staffMemberId: handleBigInt.fromSqlite(row.StaffMemberId),
      registeredAt: deserializeEFDateBlob(row.RegisteredAt),
    };
  },

  toMariaDb(entity: Models.AltAccount): Record<string, any> {
    return {
      UserId: entity.userId,
      AltId: entity.altId,
      StaffMemberId: entity.staffMemberId,
      RegisteredAt: entity.registeredAt,
    };
  }
};

export const blockedReporterTransformer: Transformer<Models.BlockedReporter> = {
  fromSqlite(row: Record<string, any>): Models.BlockedReporter {
    return {
      guildId: handleBigInt.fromSqlite(row.GuildId),
      userId: handleBigInt.fromSqlite(row.UserId),
      blockedAt: deserializeEFDateBlob(row.BlockedAt),
      staffMemberId: handleBigInt.fromSqlite(row.StaffMemberId),
    };
  },

  toMariaDb(entity: Models.BlockedReporter): Record<string, any> {
    return {
      GuildId: entity.guildId,
      UserId: entity.userId,
      BlockedAt: entity.blockedAt,
      StaffMemberId: entity.staffMemberId,
    };
  }
};

export const deletedMessageTransformer: Transformer<Models.DeletedMessage> = {
  fromSqlite(row: Record<string, any>): Models.DeletedMessage {
    return {
      messageId: handleBigInt.fromSqlite(row.MessageId),
      attachments: row.Attachments,
      authorId: handleBigInt.fromSqlite(row.AuthorId),
      channelId: handleBigInt.fromSqlite(row.ChannelId),
      content: row.Content,
      creationTimestamp: deserializeEFDateBlob(row.CreationTimestamp),
      deletionTimestamp: deserializeEFDateBlob(row.DeletionTimestamp),
      guildId: handleBigInt.fromSqlite(row.GuildId),
      staffMemberId: handleBigInt.fromSqlite(row.StaffMemberId),
    };
  },

  toMariaDb(entity: Models.DeletedMessage): Record<string, any> {
    return {
      MessageId: entity.messageId,
      Attachments: entity.attachments,
      AuthorId: entity.authorId,
      ChannelId: entity.channelId,
      Content: entity.content,
      CreationTimestamp: entity.creationTimestamp,
      DeletionTimestamp: entity.deletionTimestamp,
      GuildId: entity.guildId,
      StaffMemberId: entity.staffMemberId,
    };
  }
};

export const infractionTransformer: Transformer<Models.Infraction> = {
  fromSqlite(row: Record<string, any>): Models.Infraction {
    return {
      id: handleBigInt.fromSqlite(row.Id),
      guildId: handleBigInt.fromSqlite(row.GuildId),
      issuedAt: deserializeEFDateBlob(row.IssuedAt),
      reason: row.Reason,
      ruleId: row.RuleId ? handleBigInt.fromSqlite(row.RuleId) : null,
      ruleText: row.RuleText,
      staffMemberId: handleBigInt.fromSqlite(row.StaffMemberId),
      type: row.Type,
      userId: handleBigInt.fromSqlite(row.UserId),
      additionalInformation: row.AdditionalInformation,
    };
  },

  toMariaDb(entity: Models.Infraction): Record<string, any> {
    return {
      Id: entity.id,
      GuildId: entity.guildId,
      IssuedAt: entity.issuedAt,
      Reason: entity.reason,
      RuleId: entity.ruleId,
      RuleText: entity.ruleText,
      StaffMemberId: entity.staffMemberId,
      Type: entity.type,
      UserId: entity.userId,
      AdditionalInformation: entity.additionalInformation,
    };
  }
};

export const memberNoteTransformer: Transformer<Models.MemberNote> = {
  fromSqlite(row: Record<string, any>): Models.MemberNote {
    return {
      id: handleBigInt.fromSqlite(row.Id),
      authorId: handleBigInt.fromSqlite(row.AuthorId),
      content: row.Content,
      creationTimestamp: deserializeEFDateBlob(row.CreationTimestamp),
      guildId: handleBigInt.fromSqlite(row.GuildId),
      type: row.Type,
      userId: handleBigInt.fromSqlite(row.UserId),
    };
  },

  toMariaDb(entity: Models.MemberNote): Record<string, any> {
    return {
      Id: entity.id,
      AuthorId: entity.authorId,
      Content: entity.content,
      CreationTimestamp: entity.creationTimestamp,
      GuildId: entity.guildId,
      Type: entity.type,
      UserId: entity.userId,
    };
  }
};

export const muteTransformer: Transformer<Models.Mute> = {
  fromSqlite(row: Record<string, any>): Models.Mute {
    return {
      guildId: handleBigInt.fromSqlite(row.GuildId),
      userId: handleBigInt.fromSqlite(row.UserId),
      expiresAt: row.ExpiresAt ? deserializeEFDateBlob(row.ExpiresAt) : null,
    };
  },

  toMariaDb(entity: Models.Mute): Record<string, any> {
    return {
      GuildId: entity.guildId,
      UserId: entity.userId,
      ExpiresAt: entity.expiresAt,
    };
  }
};

export const reportedMessageTransformer: Transformer<Models.ReportedMessage> = {
  fromSqlite(row: Record<string, any>): Models.ReportedMessage {
    return {
      id: handleBigInt.fromSqlite(row.Id),
      attachments: row.Attachments,
      authorId: handleBigInt.fromSqlite(row.AuthorId),
      channelId: handleBigInt.fromSqlite(row.ChannelId),
      content: row.Content,
      guildId: handleBigInt.fromSqlite(row.GuildId),
      messageId: handleBigInt.fromSqlite(row.MessageId),
      reporterId: handleBigInt.fromSqlite(row.ReporterId),
    };
  },

  toMariaDb(entity: Models.ReportedMessage): Record<string, any> {
    return {
      Id: entity.id,
      Attachments: entity.attachments,
      AuthorId: entity.authorId,
      ChannelId: entity.channelId,
      Content: entity.content,
      GuildId: entity.guildId,
      MessageId: entity.messageId,
      ReporterId: entity.reporterId,
    };
  }
};

export const ruleTransformer: Transformer<Models.Rule> = {
  fromSqlite(row: Record<string, any>): Models.Rule {
    return {
      guildId: handleBigInt.fromSqlite(row.GuildId),
      id: handleBigInt.fromSqlite(row.Id),
      brief: row.Brief,
      description: row.Description,
    };
  },

  toMariaDb(entity: Models.Rule): Record<string, any> {
    return {
      GuildId: entity.guildId,
      Id: entity.id,
      Brief: entity.brief,
      Description: entity.description,
    };
  }
};

export const staffMessageTransformer: Transformer<Models.StaffMessage> = {
  fromSqlite(row: Record<string, any>): Models.StaffMessage {
    return {
      id: handleBigInt.fromSqlite(row.Id),
      content: row.Content,
      guildId: handleBigInt.fromSqlite(row.GuildId),
      recipientId: handleBigInt.fromSqlite(row.RecipientId),
      sentAt: new Date(row.SentAt), // SentAt is stored as TEXT in SQLite
      staffMemberId: handleBigInt.fromSqlite(row.StaffMemberId),
    };
  },

  toMariaDb(entity: Models.StaffMessage): Record<string, any> {
    return {
      Id: entity.id,
      Content: entity.content,
      GuildId: entity.guildId,
      RecipientId: entity.recipientId,
      SentAt: entity.sentAt,
      StaffMemberId: entity.staffMemberId,
    };
  }
};

export const temporaryBanTransformer: Transformer<Models.TemporaryBan> = {
  fromSqlite(row: Record<string, any>): Models.TemporaryBan {
    return {
      guildId: handleBigInt.fromSqlite(row.GuildId),
      userId: handleBigInt.fromSqlite(row.UserId),
      expiresAt: deserializeEFDateBlob(row.ExpiresAt),
    };
  },

  toMariaDb(entity: Models.TemporaryBan): Record<string, any> {
    return {
      GuildId: entity.guildId,
      UserId: entity.userId,
      ExpiresAt: entity.expiresAt,
    };
  }
};

export const trackedMessageTransformer: Transformer<Models.TrackedMessage> = {
  fromSqlite(row: Record<string, any>): Models.TrackedMessage {
    return {
      id: handleBigInt.fromSqlite(row.Id),
      attachments: row.Attachments,
      authorId: handleBigInt.fromSqlite(row.AuthorId),
      channelId: handleBigInt.fromSqlite(row.ChannelId),
      content: row.Content,
      creationTimestamp: deserializeEFDateBlob(row.CreationTimestamp),
      deletionTimestamp: row.DeletionTimestamp ? deserializeEFDateBlob(row.DeletionTimestamp) : null,
      isDeleted: row.IsDeleted,
      guildId: handleBigInt.fromSqlite(row.GuildId),
    };
  },

  toMariaDb(entity: Models.TrackedMessage): Record<string, any> {
    return {
      Id: entity.id,
      Attachments: entity.attachments,
      AuthorId: entity.authorId,
      ChannelId: entity.channelId,
      Content: entity.content,
      CreationTimestamp: entity.creationTimestamp,
      DeletionTimestamp: entity.deletionTimestamp,
      IsDeleted: entity.isDeleted,
      GuildId: entity.guildId,
    };
  }
};
