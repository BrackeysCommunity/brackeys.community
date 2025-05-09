-- Update all empty date fields with the specified binary value X'08d882a1520be7fa0000'

-- Update AltAccount.RegisteredAt
UPDATE `AltAccount` SET `RegisteredAt` = X'08d882a1520be7fa0000';

-- Update BlockedReporter.BlockedAt
UPDATE `BlockedReporter` SET `BlockedAt` = X'08d882a1520be7fa0000';

-- Update Infraction.IssuedAt
UPDATE `Infraction` SET `IssuedAt` = X'08d882a1520be7fa0000';

-- Update MemberNote.CreationTimestamp
UPDATE `MemberNote` SET `CreationTimestamp` = X'08d882a1520be7fa0000';

-- Update Mute.ExpiresAt
UPDATE `Mute` SET `ExpiresAt` = X'08d882a1520be7fa0000';

-- Update TemporaryBan.ExpiresAt
UPDATE `TemporaryBan` SET `ExpiresAt` = X'08d882a1520be7fa0000';

-- Update TrackedMessages.CreationTimestamp
UPDATE `TrackedMessages` SET `CreationTimestamp` = X'08d882a1520be7fa0000';

-- Update TrackedMessages.DeletionTimestamp where it's not NULL
UPDATE `TrackedMessages` SET `DeletionTimestamp` = X'08d882a1520be7fa0000' WHERE `DeletionTimestamp` IS NOT NULL;