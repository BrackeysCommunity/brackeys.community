export type Timestamp = Buffer;

export type AltAccount = {
  readonly userId: bigint;
  readonly altId: bigint;
  readonly staffMemberId: bigint;
  readonly registeredAt: Timestamp;
}

export type AltAccountDb = {
  UserId: bigint;
  AltId: bigint;
  StaffMemberId: bigint;
  RegisteredAt: Timestamp;
}

export type BlockedReporter = {
  readonly guildId: bigint;
  readonly userId: bigint;
  readonly blockedAt: Timestamp;
  readonly staffMemberId: bigint;
};

export type BlockedReporterDb = {
  GuildId: bigint;
  UserId: bigint;
  BlockedAt: Timestamp;
  StaffMemberId: bigint;
};

export type DeletedMessage = {
  readonly messageId: bigint;
  readonly attachments: Buffer;
  readonly authorId: bigint;
  readonly channelId: bigint;
  readonly content: string | null;
  readonly creationTimestamp: Timestamp;
  readonly deletionTimestamp: Timestamp;
  readonly guildId: bigint;
  readonly staffMemberId: bigint;
};

export type DeletedMessageDb = {
  MessageId: bigint;
  Attachments: Buffer;
  AuthorId: bigint;
  ChannelId: bigint;
  Content: string | null;
  CreationTimestamp: Timestamp;
  DeletionTimestamp: Timestamp;
  GuildId: bigint;
  StaffMemberId: bigint;
};

export enum InfractionType {
  Warning = 1,
  Mute = 2,
  Kick = 3,
  Ban = 4,
}

export type Infraction = {
  readonly id: bigint;
  readonly guildId: bigint;
  readonly issuedAt: Timestamp;
  readonly reason: string | null;
  readonly ruleId: number | null;
  readonly ruleText: string | null;
  readonly staffMemberId: bigint;
  readonly type: InfractionType;
  readonly userId: bigint;
  readonly additionalInformation: string | null;
};

export type InfractionDb = {
  Id: bigint;
  GuildId: bigint;
  IssuedAt: Timestamp;
  Reason: string | null;
  RuleId: number | null;
  RuleText: string | null;
  StaffMemberId: bigint;
  Type: InfractionType;
  UserId: bigint;
  AdditionalInformation: string | null;
};

export enum MemberNoteType {
  Warning = 1,
  Positive = 2,
}

export type MemberNote = {
  readonly id: bigint;
  readonly authorId: bigint;
  readonly content: string;
  readonly creationTimestamp: Timestamp;
  readonly guildId: bigint;
  readonly type: MemberNoteType;
  readonly userId: bigint;
};

export type MemberNoteDb = {
  Id: bigint;
  AuthorId: bigint;
  Content: string;
  CreationTimestamp: Timestamp;
  GuildId: bigint;
  Type: MemberNoteType;
  UserId: bigint;
};

export type Mute = {
  readonly guildId: bigint;
  readonly userId: bigint;
  readonly expiresAt: Timestamp | null;
};

export type MuteDb = {
  GuildId: bigint;
  UserId: bigint;
  ExpiresAt: Timestamp | null;
};

export type ReportedMessage = {
  readonly id: bigint;
  readonly attachments: Buffer;
  readonly authorId: bigint;
  readonly channelId: bigint;
  readonly content: string | null;
  readonly guildId: bigint;
  readonly messageId: bigint;
  readonly reporterId: bigint;
};

export type ReportedMessageDb = {
  Id: bigint;
  Attachments: Buffer;
  AuthorId: bigint;
  ChannelId: bigint;
  Content: string | null;
  GuildId: bigint;
  MessageId: bigint;
  ReporterId: bigint;
};

export type Rule = {
  readonly guildId: bigint;
  readonly id: bigint;
  readonly brief: string | null;
  readonly description: string;
};

export type RuleDb = {
  GuildId: bigint;
  Id: bigint;
  Brief: string | null;
  Description: string;
};

export type StaffMessage = {
  readonly id: bigint;
  readonly content: string;
  readonly guildId: bigint;
  readonly recipientId: bigint;
  readonly sentAt: string;
  readonly staffMemberId: bigint;
};

export type StaffMessageDb = {
  Id: bigint;
  Content: string;
  GuildId: bigint;
  RecipientId: bigint;
  SentAt: string;
  StaffMemberId: bigint;
};

export type TemporaryBan = {
  readonly guildId: bigint;
  readonly userId: bigint;
  readonly expiresAt: Timestamp;
};

export type TemporaryBanDb = {
  GuildId: bigint;
  UserId: bigint;
  ExpiresAt: Timestamp;
};

export type TrackedMessage = {
  readonly id: bigint;
  readonly attachments: Buffer;
  readonly authorId: bigint;
  readonly channelId: bigint;
  readonly content: string | null;
  readonly creationTimestamp: Timestamp;
  readonly deletionTimestamp: Timestamp | null;
  readonly isDeleted: number;
  readonly guildId: bigint;
};

export type TrackedMessageDb = {
  Id: bigint;
  Attachments: Buffer;
  AuthorId: bigint;
  ChannelId: bigint;
  Content: string | null;
  CreationTimestamp: Timestamp;
  DeletionTimestamp: Timestamp | null;
  IsDeleted: number;
  GuildId: bigint;
};
