CREATE DATABASE IF NOT EXISTS `Hammer`;

CREATE TABLE IF NOT EXISTS `Hammer`.`AltAccount` (
    `UserId` BIGINT NOT NULL,
    `AltId` BIGINT NOT NULL,
    `StaffMemberId` BIGINT NOT NULL,
    `RegisteredAt` DATETIME NOT NULL,
    PRIMARY KEY (`UserId`, `AltId`)
);

CREATE TABLE IF NOT EXISTS `Hammer`.`BlockedReporter` (
    `GuildId` BIGINT NOT NULL,
    `UserId` BIGINT NOT NULL,
    `BlockedAt` DATETIME NOT NULL,
    `StaffMemberId` BIGINT NOT NULL,
    CONSTRAINT `PK_BlockedReporter` PRIMARY KEY (`UserId`, `GuildId`)
);

CREATE TABLE IF NOT EXISTS `Hammer`.`DeletedMessage` (
    `MessageId` BIGINT NOT NULL AUTO_INCREMENT,
    `Attachments` BLOB NOT NULL,
    `AuthorId` BIGINT NOT NULL,
    `ChannelId` BIGINT NOT NULL,
    `Content` TEXT NULL,
    `CreationTimestamp` DATETIME NOT NULL,
    `DeletionTimestamp` DATETIME NOT NULL,
    `GuildId` BIGINT NOT NULL,
    `StaffMemberId` BIGINT NOT NULL,
    PRIMARY KEY (`MessageId`)
);

CREATE TABLE IF NOT EXISTS `Hammer`.`Infraction` (
    `Id` BIGINT NOT NULL AUTO_INCREMENT,
    `GuildId` BIGINT NOT NULL,
    `IssuedAt` DATETIME NOT NULL,
    `Reason` TEXT NULL,
    `RuleId` BIGINT NULL,
    `RuleText` TEXT NULL,
    `StaffMemberId` BIGINT NOT NULL,
    `Type` INT NOT NULL,
    `UserId` BIGINT NOT NULL,
    `AdditionalInformation` TEXT NULL,
    PRIMARY KEY (`Id`)
);

CREATE TABLE IF NOT EXISTS `Hammer`.`MemberNote` (
    `Id` BIGINT NOT NULL AUTO_INCREMENT,
    `AuthorId` BIGINT NOT NULL,
    `Content` TEXT NOT NULL,
    `CreationTimestamp` DATETIME NOT NULL,
    `GuildId` BIGINT NOT NULL,
    `Type` INT NOT NULL,
    `UserId` BIGINT NOT NULL,
    PRIMARY KEY (`Id`)
);

CREATE TABLE IF NOT EXISTS `Hammer`.`Mute` (
    `GuildId` BIGINT NOT NULL,
    `UserId` BIGINT NOT NULL,
    `ExpiresAt` DATETIME NULL,
    PRIMARY KEY (`UserId`, `GuildId`)
);

CREATE TABLE IF NOT EXISTS `Hammer`.`ReportedMessage` (
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

CREATE TABLE IF NOT EXISTS `Hammer`.`Rule` (
    `GuildId` BIGINT NOT NULL,
    `Id` BIGINT NOT NULL,
    `Brief` TEXT NULL,
    `Description` TEXT NOT NULL,
    PRIMARY KEY (`Id`, `GuildId`)
);

CREATE TABLE IF NOT EXISTS `Hammer`.`StaffMessage` (
    `Id` BIGINT NOT NULL AUTO_INCREMENT,
    `Content` TEXT NOT NULL,
    `GuildId` BIGINT NOT NULL,
    `RecipientId` BIGINT NOT NULL,
    `SentAt` DATETIME NOT NULL,
    `StaffMemberId` BIGINT NOT NULL,
    PRIMARY KEY (`Id`)
);

CREATE TABLE IF NOT EXISTS `Hammer`.`TemporaryBan` (
    `GuildId` BIGINT NOT NULL,
    `UserId` BIGINT NOT NULL,
    `ExpiresAt` DATETIME NOT NULL,
    PRIMARY KEY (`UserId`, `GuildId`)
);

CREATE TABLE IF NOT EXISTS `Hammer`.`TrackedMessages` (
    `Id` BIGINT NOT NULL AUTO_INCREMENT,
    `Attachments` BLOB NOT NULL,
    `AuthorId` BIGINT NOT NULL,
    `ChannelId` BIGINT NOT NULL,
    `Content` TEXT NULL,
    `CreationTimestamp` DATETIME NOT NULL,
    `DeletionTimestamp` DATETIME NULL,
    `IsDeleted` INT NOT NULL,
    `GuildId` BIGINT NOT NULL,
    PRIMARY KEY (`Id`)
);
