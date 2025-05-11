export interface BaseTimestampEntity {
  readonly createdAt?: Date;
  readonly updatedAt?: Date;
}

export interface AltAccount {
  readonly userId: bigint;
  readonly altId: bigint;
  readonly staffMemberId: bigint;
  readonly registeredAt: Date;
}

export interface BlockedReporter {
  readonly guildId: bigint;
  readonly userId: bigint;
  readonly blockedAt: Date;
  readonly staffMemberId: bigint;
}

export interface DeletedMessage {
  readonly messageId: bigint;
  readonly attachments: Buffer;
  readonly authorId: bigint;
  readonly channelId: bigint;
  readonly content: string | null;
  readonly creationTimestamp: Date;
  readonly deletionTimestamp: Date;
  readonly guildId: bigint;
  readonly staffMemberId: bigint;
}

export interface Infraction {
  readonly id: bigint;
  readonly guildId: bigint;
  readonly issuedAt: Date;
  readonly reason: string | null;
  readonly ruleId: bigint | null;
  readonly ruleText: string | null;
  readonly staffMemberId: bigint;
  readonly type: number;
  readonly userId: bigint;
  readonly additionalInformation: string | null;
}

export interface MemberNote {
  readonly id: bigint;
  readonly authorId: bigint;
  readonly content: string;
  readonly creationTimestamp: Date;
  readonly guildId: bigint;
  readonly type: number;
  readonly userId: bigint;
}

export interface Mute {
  readonly guildId: bigint;
  readonly userId: bigint;
  readonly expiresAt: Date | null;
}

export interface ReportedMessage {
  readonly id: bigint;
  readonly attachments: Buffer;
  readonly authorId: bigint;
  readonly channelId: bigint;
  readonly content: string | null;
  readonly guildId: bigint;
  readonly messageId: bigint;
  readonly reporterId: bigint;
}

export interface Rule {
  readonly guildId: bigint;
  readonly id: bigint;
  readonly brief: string | null;
  readonly description: string;
}

export interface StaffMessage {
  readonly id: bigint;
  readonly content: string;
  readonly guildId: bigint;
  readonly recipientId: bigint;
  readonly sentAt: Date;
  readonly staffMemberId: bigint;
}

export interface TemporaryBan {
  readonly guildId: bigint;
  readonly userId: bigint;
  readonly expiresAt: Date;
}

export interface TrackedMessage {
  readonly id: bigint;
  readonly attachments: Buffer;
  readonly authorId: bigint;
  readonly channelId: bigint;
  readonly content: string | null;
  readonly creationTimestamp: Date;
  readonly deletionTimestamp: Date | null;
  readonly isDeleted: number;
  readonly guildId: bigint;
}
