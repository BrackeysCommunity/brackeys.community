CREATE TABLE IF NOT EXISTS `AltAccount` (
    `UserId` BIGINT NOT NULL,
    `AltId` BIGINT NOT NULL,
    `StaffMemberId` BIGINT NOT NULL,
    `RegisteredAt` BLOB NOT NULL,
    PRIMARY KEY(`UserId`,`AltId`)
);

CREATE TABLE IF NOT EXISTS `BlockedReporter` (
    `GuildId` BIGINT NOT NULL,
    `UserId` BIGINT NOT NULL,
    `BlockedAt` BLOB NOT NULL,
    `StaffMemberId` BIGINT NOT NULL,
    PRIMARY KEY (`UserId`, `GuildId`)
);

CREATE TABLE IF NOT EXISTS `DeletedMessage` (
    `MessageId` BIGINT NOT NULL AUTO_INCREMENT,
    `Attachments` BLOB NOT NULL,
    `AuthorId` BIGINT NOT NULL,
    `ChannelId` BIGINT NOT NULL,
    `Content` TEXT NULL,
    `CreationTimestamp` BLOB NOT NULL,
    `DeletionTimestamp` BLOB NOT NULL,
    `GuildId` BIGINT NOT NULL,
    `StaffMemberId` BIGINT NOT NULL,
    PRIMARY KEY (`MessageId`)
);

CREATE TABLE IF NOT EXISTS `Infraction` (
    `Id` BIGINT NOT NULL AUTO_INCREMENT,
    `GuildId` BIGINT NOT NULL,
    `IssuedAt` BLOB NOT NULL,
    `Reason` TEXT,
    `RuleId` INT,
    `RuleText` TEXT,
    `StaffMemberId` BIGINT NOT NULL,
    `Type` INT NOT NULL,
    `UserId` BIGINT NOT NULL,
    `AdditionalInformation` TEXT,
    PRIMARY KEY(`Id`)
);

CREATE TABLE IF NOT EXISTS `MemberNote` (
    `Id` BIGINT NOT NULL AUTO_INCREMENT,
    `AuthorId` BIGINT NOT NULL,
    `Content` TEXT NOT NULL,
    `CreationTimestamp` BLOB NOT NULL,
    `GuildId` BIGINT NOT NULL,
    `Type` INT NOT NULL,
    `UserId` BIGINT NOT NULL,
    PRIMARY KEY (`Id`)
);

CREATE TABLE IF NOT EXISTS `Mute` (
    `GuildId` BIGINT NOT NULL,
    `UserId` BIGINT NOT NULL,
    `ExpiresAt` BLOB NULL,
    PRIMARY KEY (`UserId`, `GuildId`)
);

CREATE TABLE IF NOT EXISTS `ReportedMessage` (
    `Id` BIGINT NOT NULL AUTO_INCREMENT,
    `Attachments` BLOB NOT NULL,
    `AuthorId` BIGINT NOT NULL,
    `ChannelId` BIGINT NOT NULL,
    `Content` TEXT NULL,
    `GuildId` BIGINT NOT NULL,
    `MessageId` BIGINT NOT NULL,
    `ReporterId` BIGINT NOT NULL,
    PRIMARY KEY (`Id`)
);

CREATE TABLE IF NOT EXISTS `Rule` (
    `GuildId` BIGINT NOT NULL,
    `Id` BIGINT NOT NULL,
    `Brief` TEXT NULL,
    `Description` TEXT NOT NULL,
    PRIMARY KEY (`Id`, `GuildId`)
);

CREATE TABLE IF NOT EXISTS `StaffMessage` (
    `Id` BIGINT NOT NULL AUTO_INCREMENT,
    `Content` TEXT NOT NULL,
    `GuildId` BIGINT NOT NULL,
    `RecipientId` BIGINT NOT NULL,
    `SentAt` TEXT NOT NULL,
    `StaffMemberId` BIGINT NOT NULL,
    PRIMARY KEY (`Id`)
);

CREATE TABLE IF NOT EXISTS `TemporaryBan` (
    `GuildId` BIGINT NOT NULL,
    `UserId` BIGINT NOT NULL,
    `ExpiresAt` BLOB NOT NULL,
    PRIMARY KEY (`UserId`, `GuildId`)
);

CREATE TABLE IF NOT EXISTS `TrackedMessages` (
    `Id` BIGINT NOT NULL AUTO_INCREMENT,
    `Attachments` BLOB NOT NULL,
    `AuthorId` BIGINT NOT NULL,
    `ChannelId` BIGINT NOT NULL,
    `Content` TEXT NULL,
    `CreationTimestamp` BLOB NOT NULL,
    `DeletionTimestamp` BLOB NULL,
    `IsDeleted` INT NOT NULL,
    `GuildId` BIGINT NOT NULL,
    PRIMARY KEY (`Id`)
);
