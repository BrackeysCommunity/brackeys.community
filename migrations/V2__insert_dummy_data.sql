-- V2__insert_dummy_data.sql

-- Dummy data for Rule table
INSERT INTO `Rule` (`GuildId`, `Id`, `Brief`, `Description`) VALUES
(123456789012345678, 1, 'Be respectful', 'Treat others with respect and dignity. No harassment or bullying.'),
(123456789012345678, 2, 'No NSFW content', 'Keep all content appropriate for all audiences.'),
(123456789012345678, 3, 'No spamming', 'Do not flood channels with repeated messages or unwanted content.'),

-- Dummy data for AltAccount
-- Dates represented as byte arrays for DateTimeOffset values
-- Format follows EF Core's DateTimeOffsetToBytesConverter
INSERT INTO `AltAccount` (`UserId`, `AltId`, `StaffMemberId`, `RegisteredAt`) VALUES
(123456789012345678, 234567890123456789, 345678901234567890, X'0000000000'), -- 2023-01-01 10:00:00 -05:00
(234567890123456789, 345678901234567890, 456789012345678901, X'0000000000'), -- 2023-01-10 12:30:00 -05:00
(345678901234567890, 456789012345678901, 567890123456789012, X'0000000000'); -- 2023-01-15 08:45:00 -05:00

-- Dummy data for BlockedReporter
INSERT INTO `BlockedReporter` (`GuildId`, `UserId`, `BlockedAt`, `StaffMemberId`) VALUES
(123456789012345678, 123456789012345678, X'0000000000', 345678901234567890), -- 2023-02-01 15:20:00 -05:00
(123456789012345678, 234567890123456789, X'0000000000', 456789012345678901); -- 2023-02-10 09:30:00 -05:00

-- Dummy data for Infraction
INSERT INTO `Infraction` (`GuildId`, `IssuedAt`, `Reason`, `RuleId`, `RuleText`, `StaffMemberId`, `Type`, `UserId`, `AdditionalInformation`) VALUES
(123456789012345678, X'0000000000', 'Inappropriate language', 1, 'Be respectful', 345678901234567890, 1, 123456789012345678, NULL), -- 2023-02-15 12:00:00 -05:00
(123456789012345678, X'0000000000', 'Posting spam', 3, 'No spamming', 456789012345678901, 2, 234567890123456789, 'Repeat offense'), -- 2023-02-25 14:15:00 -05:00
(123456789012345678, X'0000000000', 'Off-topic discussion', 1, 'Stay on topic', 567890123456789012, 1, 345678901234567890, NULL); -- 2023-03-30 18:30:00 -05:00

-- Dummy data for MemberNote
INSERT INTO `MemberNote` (`AuthorId`, `Content`, `CreationTimestamp`, `GuildId`, `Type`, `UserId`) VALUES
(345678901234567890, 'User has been warned multiple times', X'0000000000', 123456789012345678, 1, 123456789012345678), -- 2023-03-10 11:45:00 -05:00
(456789012345678901, 'Good contributor to the community', X'0000000000', 123456789012345678, 2, 345678901234567890), -- 2023-04-05 09:20:00 -05:00
(567890123456789012, 'Needs monitoring', X'0000000000', 123456789012345678, 1, 234567890123456789); -- 2023-04-10 16:30:00 -05:00

-- Dummy data for Mute
INSERT INTO `Mute` (`GuildId`, `UserId`, `ExpiresAt`) VALUES
(123456789012345678, 123456789012345678, X'0000000000'), -- 2023-04-15 19:00:00 -05:00
(123456789012345678, 234567890123456789, X'0000000000'); -- 2023-04-25 13:30:00 -05:00

-- Dummy data for TemporaryBan
INSERT INTO `TemporaryBan` (`GuildId`, `UserId`, `ExpiresAt`) VALUES
(123456789012345678, 678901234567890123, X'0000000000'), -- 2023-04-30 10:15:00 -05:00
(123456789012345678, 789012345678901234, X'0000000000'); -- 2023-05-05 14:45:00 -05:00

-- Dummy data for StaffMessage
INSERT INTO `StaffMessage` (`Content`, `GuildId`, `RecipientId`, `SentAt`, `StaffMemberId`) VALUES
('Please follow our rules', 123456789012345678, 123456789012345678, X'0000000000', 345678901234567890),
('Your contribution is appreciated', 123456789012345678, 345678901234567890, X'0000000000', 456789012345678901),
('This is your final warning', 123456789012345678, 234567890123456789, X'0000000000', 567890123456789012);

-- Dummy data for TrackedMessages (just a few sample records)
INSERT INTO `TrackedMessages` (`Attachments`, `AuthorId`, `ChannelId`, `Content`, `CreationTimestamp`, `DeletionTimestamp`, `IsDeleted`, `GuildId`) VALUES
(X'00', 123456789012345678, 201, 'Hello everyone!', X'0000000000', NULL, 0, 123456789012345678), -- 2023-05-15 08:30:00 -05:00
(X'00', 234567890123456789, 202, 'Check out this link', X'0000000000', X'0000000000', 1, 123456789012345678), -- Created: 2023-05-20 13:45:00, Deleted: 2023-05-22 10:30:00 -05:00
(X'00', 345678901234567890, 203, 'Need help with a problem', X'0000000000', NULL, 0, 123456789012345678); -- 2023-05-30 15:20:00 -00:00

-- Dummy data for ReportedMessage
INSERT INTO `ReportedMessage` (`Attachments`, `AuthorId`, `ChannelId`, `Content`, `GuildId`, `MessageId`, `ReporterId`) VALUES
(X'00', 234567890123456789, 201, 'This is inappropriate content', 123456789012345678, 30001, 123456789012345678),
(X'00', 123456789012345678, 202, 'Suspected spam message', 123456789012345678, 30002, 345678901234567890),
(X'00', 345678901234567890, 203, 'Off-topic discussion', 123456789012345678, 30003, 234567890123456789);
