INSERT INTO "AltAccount" ("UserId", "AltId", "StaffMemberId", "RegisteredAt") VALUES
(474678259280510977, 422626966490176514, 422626966490176515, X'08d882a1520be7fa0000'),
(474678259280510977, 422626966490176517, 422626966490176518, X'08d882a1520be7fa0000'),
(474678259280510977, 422626966490176520, 422626966490176521, X'08d882a1520be7fa0000'),
(474678259280510977, 422626966490176523, 422626966490176524, X'08d882a1520be7fa0000'),
(474678259280510977, 422626966490176526, 422626966490176527, X'08d882a1520be7fa0000');

INSERT INTO "BlockedReporter" ("GuildId", "UserId", "BlockedAt", "StaffMemberId") VALUES
(422087909539160064, 422626966490176528, X'08d882a1520be7fa0000', 422626966490176529),
(422087909539160064, 422626966490176530, X'08d882a1520be7fa0000', 422626966490176531),
(422087909539160064, 422626966490176532, X'08d882a1520be7fa0000', 422626966490176533);

INSERT INTO "DeletedMessage" ("Attachments", "AuthorId", "ChannelId", "Content", "CreationTimestamp", "DeletionTimestamp", "GuildId", "StaffMemberId") VALUES
(X'', 474678259280510977, 422626966490176535, 'Deleted message content 1', X'08d882a1520be7fa0000', X'08d882a1520be7fa0000', 422087909539160064, 422626966490176536),
(X'', 474678259280510977, 422626966490176538, 'Deleted message content 2', X'08d882a1520be7fa0000', X'08d882a1520be7fa0000', 422087909539160064, 422626966490176539),
(X'', 474678259280510977, 422626966490176541, 'Deleted message content 3', X'08d882a1520be7fa0000', X'08d882a1520be7fa0000', 422087909539160064, 422626966490176542);

INSERT INTO "Infraction" ("GuildId", "IssuedAt", "Reason", "RuleId", "RuleText", "StaffMemberId", "Type", "UserId", "AdditionalInformation") VALUES
(422087909539160064, X'08d882a1520be7fa0000', 'Violation of rule 1', 1, 'Be respectful', 422626966490176543, 1, 474678259280510977, NULL),
(422087909539160064, X'08d882a1520be7fa0000', 'Violation of rule 2', 2, 'No spam', 422626966490176545, 2, 474678259280510977, 'Repeated offense'),
(422087909539160064, X'08d882a1520be7fa0000', 'Violation of rule 3', 3, 'No NSFW content', 422626966490176547, 3, 474678259280510977, 'First warning');

INSERT INTO "MemberNote" ("AuthorId", "Content", "CreationTimestamp", "GuildId", "Type", "UserId") VALUES
(422626966490176549, 'Note about user behavior', X'08d882a1520be7fa0000', 422087909539160064, 1, 474678259280510977),
(422626966490176551, 'Follow-up on previous warning', X'08d882a1520be7fa0000', 422087909539160064, 2, 474678259280510977),
(422626966490176553, 'Positive contribution note', X'08d882a1520be7fa0000', 422087909539160064, 3, 474678259280510977);

INSERT INTO "Mute" ("GuildId", "UserId", "ExpiresAt") VALUES
(422087909539160064, 422626966490176555, X'08d882a1520be7fa0000'),
(422087909539160064, 422626966490176556, X'08d882a1520be7fa0000'),
(422087909539160064, 422626966490176557, X'08d882a1520be7fa0000');

INSERT INTO "ReportedMessage" ("Attachments", "AuthorId", "ChannelId", "Content", "GuildId", "MessageId", "ReporterId") VALUES
(X'', 422626966490176558, 422626966490176559, 'Reported message content 1', 422087909539160064, 422626966490176560, 422626966490176561),
(X'', 422626966490176562, 422626966490176563, 'Reported message content 2', 422087909539160064, 422626966490176564, 422626966490176565),
(X'', 422626966490176566, 422626966490176567, 'Reported message content 3', 422087909539160064, 422626966490176568, 422626966490176569);

INSERT INTO "Rule" ("GuildId", "Id", "Brief", "Description") VALUES
(422087909539160064, 1, 'Follow chat etiquette', 'Refrain from being rude to other members; treat each other as human beings. We will not tolerate any kind of hostility, threats, or attacks upon another member, including discriminatory language or attacks on characteristics such as age, sex, gender identity, sexual orientation, or disability. Please also avoid spamming public channels and try to keep conversations engaging and productive. This includes no spam-reacting, no REPEATED ALL CAPS, and no repeated use of Zalgo text.'),
(422087909539160064, 2, 'Avoid controversy', 'Please avoid controversial topics (religion, politics, etc), and mental health discussions (depression, suicide, etc)! This is a game dev server. There is a time and place for everything and this server ain''t the place!'),
(422087909539160064, 3, 'Recruit or find work using the correct channels', 'If you want work done for you, you can find people to work with you in the collaboration category (#paid, #hobby). For instructions, see #how-to-collab'),
(422087909539160064, 4, 'Keep it SFW', 'Displaying offensive, derogatory, sexually explicit or NSFW content is not allowed.'),
(422087909539160064, 5, 'Don''t ask to ask', 'Don''t ask to ask, don''t ask "can someone help me", don''t ping random users, don''t ask for DMs. We are here to help! If you''re asking in the Development & Help category, you can skip the needless introductions. We''d much rather you just ask your question outright.'),
(422087909539160064, 6, 'Follow Discord ToS', 'Do not share piracy links or links to tools to reverse engineer/hack other software and games. Discussions are fine.'),
(422087909539160064, 7, 'Advertise content in the correct channels', 'Advertise game related content in #advertise. Showcase works in progress in #showcase.'),
(422087909539160064, 8, 'Don''t spam-advertise', 'Space out your posts in #advertise and #showcase. Give other people a chance to be seen.'),
(422087909539160064, 9, 'Don''t spoonfeed or ask to be spoonfed', 'Before asking for help, please google your issue first, attempt to solve it yourself, and then ask. You learn more this way than being spoon-fed!'),
(422087909539160064, 10, 'English only', 'We are an English community around English content with English speaking moderation team. Everyone here understands English, other languages not so much.'),
(422087909539160064, 11, 'Follow Wheaton''s law', 'Don''t be a dick');

INSERT INTO "StaffMessage" ("Content", "GuildId", "RecipientId", "SentAt", "StaffMemberId") VALUES
('Warning about behavior', 422087909539160064, 422626966490176570, '2025-05-11 11:10:28.945-05:00', 422626966490176571),
('Mute notification', 422087909539160064, 422626966490176572, '2025-05-11 11:10:28.945-05:00', 422626966490176573),
('Ban notification', 422087909539160064, 422626966490176574, '2025-05-11 11:10:28.945-05:00', 422626966490176575);

INSERT INTO "TemporaryBan" ("GuildId", "UserId", "ExpiresAt") VALUES
(422087909539160064, 422626966490176576, X'08d882a1520be7fa0000'),
(422087909539160064, 422626966490176577, X'08d882a1520be7fa0000'),
(422087909539160064, 422626966490176578, X'08d882a1520be7fa0000');

INSERT INTO "TrackedMessages" ("Attachments", "AuthorId", "ChannelId", "Content", "CreationTimestamp", "DeletionTimestamp", "IsDeleted", "GuildId") VALUES
(X'', 422626966490176579, 422626966490176580, 'Tracked message content 1', X'08d882a1520be7fa0000', NULL, 0, 422087909539160064),
(X'', 422626966490176581, 422626966490176582, 'Tracked message content 2', X'08d882a1520be7fa0000', NULL, 0, 422087909539160064),
(X'', 422626966490176583, 422626966490176584, 'Tracked message content 3', X'08d882a1520be7fa0000', X'08d882a1520be7fa0000', 1, 422087909539160064),
(X'', 422626966490176585, 422626966490176586, 'Tracked message content 4', X'08d882a1520be7fa0000', X'08d882a1520be7fa0000', 1, 422087909539160064);

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
