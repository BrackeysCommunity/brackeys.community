INSERT INTO `Rule` (`GuildId`, `Id`, `Brief`, `Description`) VALUES
(123456789012345678, 1, 'Be respectful', 'Treat others with respect and dignity. No harassment or bullying.'),
(123456789012345678, 2, 'No NSFW content', 'Keep all content appropriate for all audiences.'),
(123456789012345678, 3, 'No spamming', 'Do not flood channels with repeated messages or unwanted content.');

INSERT INTO `AltAccount` (`UserId`, `AltId`, `StaffMemberId`, `RegisteredAt`) VALUES
(123456789012345678, 234567890123456789, 345678901234567890, ''),
(234567890123456789, 345678901234567890, 456789012345678901, ''),
(345678901234567890, 456789012345678901, 567890123456789012, '');

INSERT INTO `BlockedReporter` (`GuildId`, `UserId`, `BlockedAt`, `StaffMemberId`) VALUES
(123456789012345678, 123456789012345678, '', 345678901234567890),
(123456789012345678, 234567890123456789, '', 456789012345678901);

INSERT INTO `Infraction` (`GuildId`, `IssuedAt`, `Reason`, `RuleId`, `RuleText`, `StaffMemberId`, `Type`, `UserId`, `AdditionalInformation`) VALUES
(123456789012345678, '', 'Inappropriate language', 1, 'Be respectful', 345678901234567890, 1, 123456789012345678, NULL), 
(123456789012345678, '', 'Posting spam', 3, 'No spamming', 456789012345678901, 2, 234567890123456789, 'Repeat offense'),
(123456789012345678, '', 'Off-topic discussion', 1, 'Stay on topic', 567890123456789012, 1, 345678901234567890, NULL);

INSERT INTO `MemberNote` (`AuthorId`, `Content`, `CreationTimestamp`, `GuildId`, `Type`, `UserId`) VALUES
(345678901234567890, 'User has been warned multiple times', '', 123456789012345678, 1, 123456789012345678),
(456789012345678901, 'Good contributor to the community', '', 123456789012345678, 2, 345678901234567890),
(567890123456789012, 'Needs monitoring', '', 123456789012345678, 1, 234567890123456789);

INSERT INTO `Mute` (`GuildId`, `UserId`, `ExpiresAt`) VALUES
(123456789012345678, 123456789012345678, ''),
(123456789012345678, 234567890123456789, '');

INSERT INTO `TemporaryBan` (`GuildId`, `UserId`, `ExpiresAt`) VALUES
(123456789012345678, 678901234567890123, ''),
(123456789012345678, 789012345678901234, '');

INSERT INTO `StaffMessage` (`Content`, `GuildId`, `RecipientId`, `SentAt`, `StaffMemberId`) VALUES
('Please follow our rules', 123456789012345678, 123456789012345678, '', 345678901234567890),
('Your contribution is appreciated', 123456789012345678, 345678901234567890, '', 456789012345678901),
('This is your final warning', 123456789012345678, 234567890123456789, '', 567890123456789012);

INSERT INTO `TrackedMessages` (`Attachments`, `AuthorId`, `ChannelId`, `Content`, `CreationTimestamp`, `DeletionTimestamp`, `IsDeleted`, `GuildId`) VALUES
(X'00', 123456789012345678, 201, 'Hello everyone!', '', NULL, 0, 123456789012345678),
(X'00', 234567890123456789, 202, 'Check out this link', '', '', 1, 123456789012345678),
(X'00', 345678901234567890, 203, 'Need help with a problem', '', NULL, 0, 123456789012345678);

INSERT INTO `ReportedMessage` (`Attachments`, `AuthorId`, `ChannelId`, `Content`, `GuildId`, `MessageId`, `ReporterId`) VALUES
(X'00', 234567890123456789, 201, 'This is inappropriate content', 123456789012345678, 30001, 123456789012345678),
(X'00', 123456789012345678, 202, 'Suspected spam message', 123456789012345678, 30002, 345678901234567890),
(X'00', 345678901234567890, 203, 'Off-topic discussion', 123456789012345678, 30003, 234567890123456789);
