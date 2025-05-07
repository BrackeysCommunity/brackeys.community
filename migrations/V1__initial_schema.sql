-- V1__initial_schema.sql
CREATE TABLE IF NOT EXISTS `AltAccount` (
    `UserId` INT NOT NULL,
    `AltId` INT NOT NULL,
    `StaffMemberId` INT NOT NULL,
    `RegisteredAt` BLOB NOT NULL,
    PRIMARY KEY(`UserId`,`AltId`)
);

CREATE TABLE IF NOT EXISTS `BlockedReporter` (
    `GuildId` INT NOT NULL,
    `UserId` INT NOT NULL,
    `BlockedAt` BLOB NOT NULL,
    `StaffMemberId` INT NOT NULL,
    CONSTRAINT `PK_BlockedReporter` PRIMARY KEY (`UserId`, `GuildId`)
);

CREATE TABLE IF NOT EXISTS `DeletedMessage` (
    `MessageId` INT NOT NULL AUTO_INCREMENT,
    `Attachments` BLOB NOT NULL,
    `AuthorId` INT NOT NULL,
    `ChannelId` INT NOT NULL,
    `Content` TEXT NULL,
    `CreationTimestamp` BLOB NOT NULL,
    `DeletionTimestamp` BLOB NOT NULL,
    `GuildId` INT NOT NULL,
    `StaffMemberId` INT NOT NULL,
    CONSTRAINT `PK_DeletedMessage` PRIMARY KEY (`MessageId`)
);

CREATE TABLE IF NOT EXISTS `Infraction` (
    `Id` INT NOT NULL AUTO_INCREMENT,
    `GuildId` INT NOT NULL,
    `IssuedAt` BLOB NOT NULL,
    `Reason` TEXT,
    `RuleId` INT,
    `RuleText` TEXT,
    `StaffMemberId` INT NOT NULL,
    `Type` INT NOT NULL,
    `UserId` INT NOT NULL,
    `AdditionalInformation` TEXT,
    CONSTRAINT `PK_Infraction` PRIMARY KEY(`Id`)
);

CREATE TABLE IF NOT EXISTS `MemberNote` (
    `Id` INT NOT NULL AUTO_INCREMENT,
    `AuthorId` INT NOT NULL,
    `Content` TEXT NOT NULL,
    `CreationTimestamp` BLOB NOT NULL,
    `GuildId` INT NOT NULL,
    `Type` INT NOT NULL,
    `UserId` INT NOT NULL,
    CONSTRAINT `PK_MemberNote` PRIMARY KEY (`Id`)
);

CREATE TABLE IF NOT EXISTS `Mute` (
    `GuildId` INT NOT NULL,
    `UserId` INT NOT NULL,
    `ExpiresAt` BLOB NULL,
    CONSTRAINT `PK_Mute` PRIMARY KEY (`UserId`, `GuildId`)
);

CREATE TABLE IF NOT EXISTS `ReportedMessage` (
    `Id` INT NOT NULL AUTO_INCREMENT,
    `Attachments` BLOB NOT NULL,
    `AuthorId` INT NOT NULL,
    `ChannelId` INT NOT NULL,
    `Content` TEXT NULL,
    `GuildId` INT NOT NULL,
    `MessageId` INT NOT NULL,
    `ReporterId` INT NOT NULL,
    CONSTRAINT `PK_ReportedMessage` PRIMARY KEY (`Id`)
);

CREATE TABLE IF NOT EXISTS `Rule` (
    `GuildId` INT NOT NULL,
    `Id` INT NOT NULL,
    `Brief` TEXT NULL,
    `Description` TEXT NOT NULL,
    CONSTRAINT `PK_Rule` PRIMARY KEY (`Id`, `GuildId`)
);

CREATE TABLE IF NOT EXISTS `StaffMessage` (
    `Id` INT NOT NULL AUTO_INCREMENT,
    `Content` TEXT NOT NULL,
    `GuildId` INT NOT NULL,
    `RecipientId` INT NOT NULL,
    `SentAt` TEXT NOT NULL,
    `StaffMemberId` INT NOT NULL,
    CONSTRAINT `PK_StaffMessage` PRIMARY KEY (`Id`)
);

CREATE TABLE IF NOT EXISTS `TemporaryBan` (
    `GuildId` INT NOT NULL,
    `UserId` INT NOT NULL,
    `ExpiresAt` BLOB NOT NULL,
    CONSTRAINT `PK_TemporaryBan` PRIMARY KEY (`UserId`, `GuildId`)
);

CREATE TABLE IF NOT EXISTS `TrackedMessages` (
    `Id` INT NOT NULL AUTO_INCREMENT,
    `Attachments` BLOB NOT NULL,
    `AuthorId` INT NOT NULL,
    `ChannelId` INT NOT NULL,
    `Content` TEXT NULL,
    `CreationTimestamp` BLOB NOT NULL,
    `DeletionTimestamp` BLOB NULL,
    `IsDeleted` INT NOT NULL,
    `GuildId` INT NOT NULL,
    CONSTRAINT `PK_TrackedMessages` PRIMARY KEY (`Id`)
);
