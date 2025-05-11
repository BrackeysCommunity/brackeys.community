-- Seed data for Brackeys SQLite test database
-- Using X'08d882a1520be7fa0000' for date blobs as specified in V3__fill_date_blobs.sql

-- Discord snowflake IDs
-- Guild ID: 422087909539160064
-- User IDs: Using ranges from 100000000000000000 to 999999999999999999

-- Insert AltAccount test data
INSERT INTO "AltAccount" ("UserId", "AltId", "StaffMemberId", "RegisteredAt") VALUES
(422626966490176513, 422626966490176514, 422626966490176515, X'08d882a1520be7fa0000'),
(422626966490176516, 422626966490176517, 422626966490176518, X'08d882a1520be7fa0000'),
(422626966490176519, 422626966490176520, 422626966490176521, X'08d882a1520be7fa0000'),
(422626966490176522, 422626966490176523, 422626966490176524, X'08d882a1520be7fa0000'),
(422626966490176525, 422626966490176526, 422626966490176527, X'08d882a1520be7fa0000');

-- Insert BlockedReporter test data
INSERT INTO "BlockedReporter" ("GuildId", "UserId", "BlockedAt", "StaffMemberId") VALUES
(422087909539160064, 422626966490176528, X'08d882a1520be7fa0000', 422626966490176529),
(422087909539160064, 422626966490176530, X'08d882a1520be7fa0000', 422626966490176531),
(422087909539160064, 422626966490176532, X'08d882a1520be7fa0000', 422626966490176533);

-- Insert DeletedMessage test data
INSERT INTO "DeletedMessage" ("Attachments", "AuthorId", "ChannelId", "Content", "CreationTimestamp", "DeletionTimestamp", "GuildId", "StaffMemberId") VALUES
(X'', 422626966490176534, 422626966490176535, 'Deleted message content 1', X'08d882a1520be7fa0000', X'08d882a1520be7fa0000', 422087909539160064, 422626966490176536),
(X'', 422626966490176537, 422626966490176538, 'Deleted message content 2', X'08d882a1520be7fa0000', X'08d882a1520be7fa0000', 422087909539160064, 422626966490176539),
(X'', 422626966490176540, 422626966490176541, 'Deleted message content 3', X'08d882a1520be7fa0000', X'08d882a1520be7fa0000', 422087909539160064, 422626966490176542);

-- Insert Infraction test data
INSERT INTO "Infraction" ("GuildId", "IssuedAt", "Reason", "RuleId", "RuleText", "StaffMemberId", "Type", "UserId", "AdditionalInformation") VALUES
(422087909539160064, X'08d882a1520be7fa0000', 'Violation of rule 1', 1, 'Be respectful', 422626966490176543, 1, 422626966490176544, NULL),
(422087909539160064, X'08d882a1520be7fa0000', 'Violation of rule 2', 2, 'No spam', 422626966490176545, 2, 422626966490176546, 'Repeated offense'),
(422087909539160064, X'08d882a1520be7fa0000', 'Violation of rule 3', 3, 'No NSFW content', 422626966490176547, 3, 422626966490176548, 'First warning');

-- Insert MemberNote test data
INSERT INTO "MemberNote" ("AuthorId", "Content", "CreationTimestamp", "GuildId", "Type", "UserId") VALUES
(422626966490176549, 'Note about user behavior', X'08d882a1520be7fa0000', 422087909539160064, 1, 422626966490176550),
(422626966490176551, 'Follow-up on previous warning', X'08d882a1520be7fa0000', 422087909539160064, 2, 422626966490176552),
(422626966490176553, 'Positive contribution note', X'08d882a1520be7fa0000', 422087909539160064, 3, 422626966490176554);

-- Insert Mute test data
INSERT INTO "Mute" ("GuildId", "UserId", "ExpiresAt") VALUES
(422087909539160064, 422626966490176555, X'08d882a1520be7fa0000'),
(422087909539160064, 422626966490176556, X'08d882a1520be7fa0000'),
(422087909539160064, 422626966490176557, X'08d882a1520be7fa0000');

-- Insert ReportedMessage test data
INSERT INTO "ReportedMessage" ("Attachments", "AuthorId", "ChannelId", "Content", "GuildId", "MessageId", "ReporterId") VALUES
(X'', 422626966490176558, 422626966490176559, 'Reported message content 1', 422087909539160064, 422626966490176560, 422626966490176561),
(X'', 422626966490176562, 422626966490176563, 'Reported message content 2', 422087909539160064, 422626966490176564, 422626966490176565),
(X'', 422626966490176566, 422626966490176567, 'Reported message content 3', 422087909539160064, 422626966490176568, 422626966490176569);

-- Insert Rule test data
INSERT INTO "Rule" ("GuildId", "Id", "Brief", "Description") VALUES
(422087909539160064, 1, 'Be respectful', 'Treat everyone with respect and kindness'),
(422087909539160064, 2, 'No spam', 'Do not spam messages, images, or mentions'),
(422087909539160064, 3, 'No NSFW content', 'Do not post or share NSFW content');

-- Insert StaffMessage test data
INSERT INTO "StaffMessage" ("Content", "GuildId", "RecipientId", "SentAt", "StaffMemberId") VALUES
('Warning about behavior', 422087909539160064, 422626966490176570, '2025-05-11 11:10:28.945-05:00', 422626966490176571),
('Mute notification', 422087909539160064, 422626966490176572, '2025-05-11 11:10:28.945-05:00', 422626966490176573),
('Ban notification', 422087909539160064, 422626966490176574, '2025-05-11 11:10:28.945-05:00', 422626966490176575);

-- Insert TemporaryBan test data
INSERT INTO "TemporaryBan" ("GuildId", "UserId", "ExpiresAt") VALUES
(422087909539160064, 422626966490176576, X'08d882a1520be7fa0000'),
(422087909539160064, 422626966490176577, X'08d882a1520be7fa0000'),
(422087909539160064, 422626966490176578, X'08d882a1520be7fa0000');

-- Insert TrackedMessages test data
INSERT INTO "TrackedMessages" ("Attachments", "AuthorId", "ChannelId", "Content", "CreationTimestamp", "DeletionTimestamp", "IsDeleted", "GuildId") VALUES
(X'', 422626966490176579, 422626966490176580, 'Tracked message content 1', X'08d882a1520be7fa0000', NULL, 0, 422087909539160064),
(X'', 422626966490176581, 422626966490176582, 'Tracked message content 2', X'08d882a1520be7fa0000', NULL, 0, 422087909539160064),
(X'', 422626966490176583, 422626966490176584, 'Tracked message content 3', X'08d882a1520be7fa0000', X'08d882a1520be7fa0000', 1, 422087909539160064),
(X'', 422626966490176585, 422626966490176586, 'Tracked message content 4', X'08d882a1520be7fa0000', X'08d882a1520be7fa0000', 1, 422087909539160064);

-- Generate a lot more data for stress testing
-- Insert additional 100 tracked messages
INSERT INTO "TrackedMessages" ("Attachments", "AuthorId", "ChannelId", "Content", "CreationTimestamp", "DeletionTimestamp", "IsDeleted", "GuildId")
WITH RECURSIVE counter(n) AS (
  SELECT 1
  UNION ALL
  SELECT n+1 FROM counter WHERE n < 100
)
SELECT 
  X'',
  422626966490176590 + n,
  422626966490176690 + n,
  'Bulk test message ' || n,
  X'08d882a1520be7fa0000',
  CASE WHEN n % 2 = 0 THEN X'08d882a1520be7fa0000' ELSE NULL END,
  n % 2,
  422087909539160064
FROM counter;
