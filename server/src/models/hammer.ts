export type AltAccount = {
  userId: bigint;
  altId: bigint;
  staffMemberId: bigint;
  registeredAt: Date;
}

export type AltAccountDb = {
  readonly UserId: bigint;
  readonly AltId: bigint;
  readonly StaffMemberId: bigint;
  readonly RegisteredAt: Buffer;
}

export type BlockedReporter = {
  guildId: bigint;
  userId: bigint;
  blockedAt: Date;
  staffMemberId: bigint;
};

export type BlockedReporterDb = {
  readonly GuildId: bigint;
  readonly UserId: bigint;
  readonly BlockedAt: Buffer;
  readonly StaffMemberId: bigint;
};

export type DeletedMessage = {
  messageId: bigint;
  attachments: Buffer;
  authorId: bigint;
  channelId: bigint;
  content: string | null;
  creationTimestamp: Date;
  deletionTimestamp: Date;
  guildId: bigint;
  staffMemberId: bigint;
};

export type DeletedMessageDb = {
  readonly MessageId: bigint;
  readonly Attachments: Buffer;
  readonly AuthorId: bigint;
  readonly ChannelId: bigint;
  readonly Content: string | null;
  readonly CreationTimestamp: Buffer;
  readonly DeletionTimestamp: Buffer;
  readonly GuildId: bigint;
  readonly StaffMemberId: bigint;
};

export enum InfractionType {
  Warning = 1,
  Mute = 2,
  Kick = 3,
  Ban = 4,
}

export type Infraction = {
  id: bigint;
  guildId: bigint;
  issuedAt: Date;
  reason: string | null;
  ruleId: number | null;
  ruleText: string | null;
  staffMemberId: bigint;
  type: InfractionType;
  userId: bigint;
  additionalInformation: string | null;
};

export type InfractionDb = {
  readonly Id: bigint;
  readonly GuildId: bigint;
  readonly IssuedAt: Buffer;
  readonly Reason: string | null;
  readonly RuleId: number | null;
  readonly RuleText: string | null;
  readonly StaffMemberId: bigint;
  readonly Type: InfractionType;
  readonly UserId: bigint;
  readonly AdditionalInformation: string | null;
};

export enum MemberNoteType {
  Warning = 1,
  Positive = 2,
}

export type MemberNote = {
  id: bigint;
  authorId: bigint;
  content: string;
  creationTimestamp: Date;
  guildId: bigint;
  type: MemberNoteType;
  userId: bigint;
};

export type MemberNoteDb = {
  readonly Id: bigint;
  readonly AuthorId: bigint;
  readonly Content: string;
  readonly CreationTimestamp: Buffer;
  readonly GuildId: bigint;
  readonly Type: MemberNoteType;
  readonly UserId: bigint;
};

export type Mute = {
  guildId: bigint;
  userId: bigint;
  expiresAt: Date | null;
};

export type MuteDb = {
  readonly GuildId: bigint;
  readonly UserId: bigint;
  readonly ExpiresAt: Buffer | null;
};

export type ReportedMessage = {
  id: bigint;
  attachments: Buffer;
  authorId: bigint;
  channelId: bigint;
  content: string | null;
  guildId: bigint;
  messageId: bigint;
  reporterId: bigint;
};

export type ReportedMessageDb = {
  readonly Id: bigint;
  readonly Attachments: Buffer;
  readonly AuthorId: bigint;
  readonly ChannelId: bigint;
  readonly Content: string | null;
  readonly GuildId: bigint;
  readonly MessageId: bigint;
  readonly ReporterId: bigint;
};

export type Rule = {
  guildId: bigint;
  id: bigint;
  brief: string | null;
  description: string;
};

export type RuleDb = {
  readonly GuildId: bigint;
  readonly Id: bigint;
  readonly Brief: string | null;
  readonly Description: string;
};

export type StaffMessage = {
  id: bigint;
  content: string;
  guildId: bigint;
  recipientId: bigint;
  sentAt: string;
  staffMemberId: bigint;
};

export type StaffMessageDb = {
  readonly Id: bigint;
  readonly Content: string;
  readonly GuildId: bigint;
  readonly RecipientId: bigint;
  readonly SentAt: string;
  readonly StaffMemberId: bigint;
};

export type TemporaryBan = {
  guildId: bigint;
  userId: bigint;
  expiresAt: Date;
};

export type TemporaryBanDb = {
  readonly GuildId: bigint;
  readonly UserId: bigint;
  readonly ExpiresAt: Buffer;
};

export type TrackedMessage = {
  id: bigint;
  attachments: Buffer;
  authorId: bigint;
  channelId: bigint;
  content: string | null;
  creationTimestamp: Date;
  deletionTimestamp: Date | null;
  isDeleted: number;
  guildId: bigint;
};

export type TrackedMessageDb = {
  readonly Id: bigint;
  readonly Attachments: Buffer;
  readonly AuthorId: bigint;
  readonly ChannelId: bigint;
  readonly Content: string | null;
  readonly CreationTimestamp: Buffer;
  readonly DeletionTimestamp: Buffer | null;
  readonly IsDeleted: number;
  readonly GuildId: bigint;
};
