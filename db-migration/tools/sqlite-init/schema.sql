-- SQLite schema for Brackeys Discord bot database

CREATE TABLE IF NOT EXISTS "AltAccount" (
    "UserId"    INTEGER NOT NULL,
    "AltId"    INTEGER NOT NULL,
    "StaffMemberId"    INTEGER NOT NULL,
    "RegisteredAt"    BLOB NOT NULL,
    PRIMARY KEY("UserId","AltId")
);

CREATE TABLE IF NOT EXISTS "BlockedReporter" (
    "GuildId" INTEGER NOT NULL,
    "UserId" INTEGER NOT NULL,
    "BlockedAt" BLOB NOT NULL,
    "StaffMemberId" INTEGER NOT NULL,
    CONSTRAINT "PK_BlockedReporter" PRIMARY KEY ("UserId", "GuildId")
);

CREATE TABLE IF NOT EXISTS "DeletedMessage" (
    "MessageId" INTEGER NOT NULL CONSTRAINT "PK_DeletedMessage" PRIMARY KEY AUTOINCREMENT,
    "Attachments" BLOB NOT NULL,
    "AuthorId" INTEGER NOT NULL,
    "ChannelId" INTEGER NOT NULL,
    "Content" TEXT NULL,
    "CreationTimestamp" BLOB NOT NULL,
    "DeletionTimestamp" BLOB NOT NULL,
    "GuildId" INTEGER NOT NULL,
    "StaffMemberId" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS "Infraction" (
    "Id"    INTEGER NOT NULL,
    "GuildId"    INTEGER NOT NULL,
    "IssuedAt"    BLOB NOT NULL,
    "Reason"    TEXT,
    "RuleId"    INTEGER,
    "RuleText"    TEXT,
    "StaffMemberId"    INTEGER NOT NULL,
    "Type"    INTEGER NOT NULL,
    "UserId"    INTEGER NOT NULL,
    "AdditionalInformation"    TEXT,
    CONSTRAINT "PK_Infraction" PRIMARY KEY("Id" AUTOINCREMENT)
);

CREATE TABLE IF NOT EXISTS "MemberNote" (
    "Id" INTEGER NOT NULL CONSTRAINT "PK_MemberNote" PRIMARY KEY AUTOINCREMENT,
    "AuthorId" INTEGER NOT NULL,
    "Content" TEXT NOT NULL,
    "CreationTimestamp" BLOB NOT NULL,
    "GuildId" INTEGER NOT NULL,
    "Type" INTEGER NOT NULL,
    "UserId" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS "Mute" (
    "GuildId" INTEGER NOT NULL,
    "UserId" INTEGER NOT NULL,
    "ExpiresAt" BLOB NULL,
    CONSTRAINT "PK_Mute" PRIMARY KEY ("UserId", "GuildId")
);

CREATE TABLE IF NOT EXISTS "ReportedMessage" (
    "Id" INTEGER NOT NULL CONSTRAINT "PK_ReportedMessage" PRIMARY KEY AUTOINCREMENT,
    "Attachments" BLOB NOT NULL,
    "AuthorId" INTEGER NOT NULL,
    "ChannelId" INTEGER NOT NULL,
    "Content" TEXT NULL,
    "GuildId" INTEGER NOT NULL,
    "MessageId" INTEGER NOT NULL,
    "ReporterId" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS "Rule" (
    "GuildId" INTEGER NOT NULL,
    "Id" INTEGER NOT NULL,
    "Brief" TEXT NULL,
    "Description" TEXT NOT NULL,
    CONSTRAINT "PK_Rule" PRIMARY KEY ("Id", "GuildId")
);

CREATE TABLE IF NOT EXISTS "StaffMessage" (
    "Id" INTEGER NOT NULL CONSTRAINT "PK_StaffMessage" PRIMARY KEY AUTOINCREMENT,
    "Content" TEXT NOT NULL,
    "GuildId" INTEGER NOT NULL,
    "RecipientId" INTEGER NOT NULL,
    "SentAt" TEXT NOT NULL,
    "StaffMemberId" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS "TemporaryBan" (
    "GuildId" INTEGER NOT NULL,
    "UserId" INTEGER NOT NULL,
    "ExpiresAt" BLOB NOT NULL,
    CONSTRAINT "PK_TemporaryBan" PRIMARY KEY ("UserId", "GuildId")
);

CREATE TABLE IF NOT EXISTS "TrackedMessages" (
    "Id" INTEGER NOT NULL CONSTRAINT "PK_TrackedMessages" PRIMARY KEY AUTOINCREMENT,
    "Attachments" BLOB NOT NULL,
    "AuthorId" INTEGER NOT NULL,
    "ChannelId" INTEGER NOT NULL,
    "Content" TEXT NULL,
    "CreationTimestamp" BLOB NOT NULL,
    "DeletionTimestamp" BLOB NULL,
    "IsDeleted" INTEGER NOT NULL,
    "GuildId" INTEGER NOT NULL
);
