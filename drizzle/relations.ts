import { relations } from "drizzle-orm/relations";
import { developerProfilesInUser, deletedMessagesInHammer, userInAuth, sessionInAuth, jamsInItch, jamEntriesInItch, profileUrlStubsInUser, skillRequestsInUser, profileProjectsInUser, infractionsInHammer, memberNotesInHammer, notificationsInUser, reportedMessagesInHammer, accountInAuth, skillsInUser, userSkillsInUser, staffMessagesInHammer, trackedMessagesInHammer, collabPostsInCollab, collabPostImagesInCollab, collabPostReportsInCollab, collabPostRolesInCollab, collabRolesInCollab, collabResponsesInCollab, linkedAccountsInUser, userNotificationSettingsInUser, mutesInHammer, temporaryBansInHammer, blockedReportersInHammer, altAccountsInHammer, jamEntryResultsInItch, notificationPreferencesInUser } from "./schema";

export const deletedMessagesInHammerRelations = relations(deletedMessagesInHammer, ({one}) => ({
	developerProfilesInUser_authorId: one(developerProfilesInUser, {
		fields: [deletedMessagesInHammer.authorId],
		references: [developerProfilesInUser.discordId],
		relationName: "deletedMessagesInHammer_authorId_developerProfilesInUser_discordId"
	}),
	developerProfilesInUser_staffMemberId: one(developerProfilesInUser, {
		fields: [deletedMessagesInHammer.staffMemberId],
		references: [developerProfilesInUser.discordId],
		relationName: "deletedMessagesInHammer_staffMemberId_developerProfilesInUser_discordId"
	}),
}));

export const developerProfilesInUserRelations = relations(developerProfilesInUser, ({many}) => ({
	deletedMessagesInHammers_authorId: many(deletedMessagesInHammer, {
		relationName: "deletedMessagesInHammer_authorId_developerProfilesInUser_discordId"
	}),
	deletedMessagesInHammers_staffMemberId: many(deletedMessagesInHammer, {
		relationName: "deletedMessagesInHammer_staffMemberId_developerProfilesInUser_discordId"
	}),
	profileUrlStubsInUsers: many(profileUrlStubsInUser),
	skillRequestsInUsers: many(skillRequestsInUser),
	profileProjectsInUsers: many(profileProjectsInUser),
	infractionsInHammers_staffMemberId: many(infractionsInHammer, {
		relationName: "infractionsInHammer_staffMemberId_developerProfilesInUser_discordId"
	}),
	infractionsInHammers_userId: many(infractionsInHammer, {
		relationName: "infractionsInHammer_userId_developerProfilesInUser_discordId"
	}),
	memberNotesInHammers_authorId: many(memberNotesInHammer, {
		relationName: "memberNotesInHammer_authorId_developerProfilesInUser_discordId"
	}),
	memberNotesInHammers_userId: many(memberNotesInHammer, {
		relationName: "memberNotesInHammer_userId_developerProfilesInUser_discordId"
	}),
	reportedMessagesInHammers_authorId: many(reportedMessagesInHammer, {
		relationName: "reportedMessagesInHammer_authorId_developerProfilesInUser_discordId"
	}),
	reportedMessagesInHammers_reporterId: many(reportedMessagesInHammer, {
		relationName: "reportedMessagesInHammer_reporterId_developerProfilesInUser_discordId"
	}),
	userSkillsInUsers: many(userSkillsInUser),
	staffMessagesInHammers_recipientId: many(staffMessagesInHammer, {
		relationName: "staffMessagesInHammer_recipientId_developerProfilesInUser_discordId"
	}),
	staffMessagesInHammers_staffMemberId: many(staffMessagesInHammer, {
		relationName: "staffMessagesInHammer_staffMemberId_developerProfilesInUser_discordId"
	}),
	trackedMessagesInHammers: many(trackedMessagesInHammer),
	linkedAccountsInUsers: many(linkedAccountsInUser),
	mutesInHammers: many(mutesInHammer),
	temporaryBansInHammers: many(temporaryBansInHammer),
	blockedReportersInHammers_userId: many(blockedReportersInHammer, {
		relationName: "blockedReportersInHammer_userId_developerProfilesInUser_discordId"
	}),
	blockedReportersInHammers_staffMemberId: many(blockedReportersInHammer, {
		relationName: "blockedReportersInHammer_staffMemberId_developerProfilesInUser_discordId"
	}),
	altAccountsInHammers_altId: many(altAccountsInHammer, {
		relationName: "altAccountsInHammer_altId_developerProfilesInUser_discordId"
	}),
	altAccountsInHammers_staffMemberId: many(altAccountsInHammer, {
		relationName: "altAccountsInHammer_staffMemberId_developerProfilesInUser_discordId"
	}),
	altAccountsInHammers_userId: many(altAccountsInHammer, {
		relationName: "altAccountsInHammer_userId_developerProfilesInUser_discordId"
	}),
}));

export const sessionInAuthRelations = relations(sessionInAuth, ({one}) => ({
	userInAuth: one(userInAuth, {
		fields: [sessionInAuth.userId],
		references: [userInAuth.id]
	}),
}));

export const userInAuthRelations = relations(userInAuth, ({many}) => ({
	sessionInAuths: many(sessionInAuth),
	notificationsInUsers_userId: many(notificationsInUser, {
		relationName: "notificationsInUser_userId_userInAuth_id"
	}),
	notificationsInUsers_actorId: many(notificationsInUser, {
		relationName: "notificationsInUser_actorId_userInAuth_id"
	}),
	accountInAuths: many(accountInAuth),
	collabPostReportsInCollabs: many(collabPostReportsInCollab),
	collabResponsesInCollabs: many(collabResponsesInCollab),
	collabPostsInCollabs: many(collabPostsInCollab),
	userNotificationSettingsInUsers: many(userNotificationSettingsInUser),
	notificationPreferencesInUsers: many(notificationPreferencesInUser),
}));

export const jamEntriesInItchRelations = relations(jamEntriesInItch, ({one, many}) => ({
	jamsInItch: one(jamsInItch, {
		fields: [jamEntriesInItch.jamId],
		references: [jamsInItch.jamId]
	}),
	jamEntryResultsInItches: many(jamEntryResultsInItch),
}));

export const jamsInItchRelations = relations(jamsInItch, ({many}) => ({
	jamEntriesInItches: many(jamEntriesInItch),
}));

export const profileUrlStubsInUserRelations = relations(profileUrlStubsInUser, ({one}) => ({
	developerProfilesInUser: one(developerProfilesInUser, {
		fields: [profileUrlStubsInUser.profileId],
		references: [developerProfilesInUser.id]
	}),
}));

export const skillRequestsInUserRelations = relations(skillRequestsInUser, ({one}) => ({
	developerProfilesInUser: one(developerProfilesInUser, {
		fields: [skillRequestsInUser.userId],
		references: [developerProfilesInUser.id]
	}),
}));

export const profileProjectsInUserRelations = relations(profileProjectsInUser, ({one}) => ({
	developerProfilesInUser: one(developerProfilesInUser, {
		fields: [profileProjectsInUser.profileId],
		references: [developerProfilesInUser.id]
	}),
}));

export const infractionsInHammerRelations = relations(infractionsInHammer, ({one}) => ({
	developerProfilesInUser_staffMemberId: one(developerProfilesInUser, {
		fields: [infractionsInHammer.staffMemberId],
		references: [developerProfilesInUser.discordId],
		relationName: "infractionsInHammer_staffMemberId_developerProfilesInUser_discordId"
	}),
	developerProfilesInUser_userId: one(developerProfilesInUser, {
		fields: [infractionsInHammer.userId],
		references: [developerProfilesInUser.discordId],
		relationName: "infractionsInHammer_userId_developerProfilesInUser_discordId"
	}),
}));

export const memberNotesInHammerRelations = relations(memberNotesInHammer, ({one}) => ({
	developerProfilesInUser_authorId: one(developerProfilesInUser, {
		fields: [memberNotesInHammer.authorId],
		references: [developerProfilesInUser.discordId],
		relationName: "memberNotesInHammer_authorId_developerProfilesInUser_discordId"
	}),
	developerProfilesInUser_userId: one(developerProfilesInUser, {
		fields: [memberNotesInHammer.userId],
		references: [developerProfilesInUser.discordId],
		relationName: "memberNotesInHammer_userId_developerProfilesInUser_discordId"
	}),
}));

export const notificationsInUserRelations = relations(notificationsInUser, ({one}) => ({
	userInAuth_userId: one(userInAuth, {
		fields: [notificationsInUser.userId],
		references: [userInAuth.id],
		relationName: "notificationsInUser_userId_userInAuth_id"
	}),
	userInAuth_actorId: one(userInAuth, {
		fields: [notificationsInUser.actorId],
		references: [userInAuth.id],
		relationName: "notificationsInUser_actorId_userInAuth_id"
	}),
}));

export const reportedMessagesInHammerRelations = relations(reportedMessagesInHammer, ({one}) => ({
	developerProfilesInUser_authorId: one(developerProfilesInUser, {
		fields: [reportedMessagesInHammer.authorId],
		references: [developerProfilesInUser.discordId],
		relationName: "reportedMessagesInHammer_authorId_developerProfilesInUser_discordId"
	}),
	developerProfilesInUser_reporterId: one(developerProfilesInUser, {
		fields: [reportedMessagesInHammer.reporterId],
		references: [developerProfilesInUser.discordId],
		relationName: "reportedMessagesInHammer_reporterId_developerProfilesInUser_discordId"
	}),
}));

export const accountInAuthRelations = relations(accountInAuth, ({one}) => ({
	userInAuth: one(userInAuth, {
		fields: [accountInAuth.userId],
		references: [userInAuth.id]
	}),
}));

export const userSkillsInUserRelations = relations(userSkillsInUser, ({one}) => ({
	skillsInUser: one(skillsInUser, {
		fields: [userSkillsInUser.skillId],
		references: [skillsInUser.id]
	}),
	developerProfilesInUser: one(developerProfilesInUser, {
		fields: [userSkillsInUser.userId],
		references: [developerProfilesInUser.id]
	}),
}));

export const skillsInUserRelations = relations(skillsInUser, ({many}) => ({
	userSkillsInUsers: many(userSkillsInUser),
}));

export const staffMessagesInHammerRelations = relations(staffMessagesInHammer, ({one}) => ({
	developerProfilesInUser_recipientId: one(developerProfilesInUser, {
		fields: [staffMessagesInHammer.recipientId],
		references: [developerProfilesInUser.discordId],
		relationName: "staffMessagesInHammer_recipientId_developerProfilesInUser_discordId"
	}),
	developerProfilesInUser_staffMemberId: one(developerProfilesInUser, {
		fields: [staffMessagesInHammer.staffMemberId],
		references: [developerProfilesInUser.discordId],
		relationName: "staffMessagesInHammer_staffMemberId_developerProfilesInUser_discordId"
	}),
}));

export const trackedMessagesInHammerRelations = relations(trackedMessagesInHammer, ({one}) => ({
	developerProfilesInUser: one(developerProfilesInUser, {
		fields: [trackedMessagesInHammer.authorId],
		references: [developerProfilesInUser.discordId]
	}),
}));

export const collabPostImagesInCollabRelations = relations(collabPostImagesInCollab, ({one}) => ({
	collabPostsInCollab: one(collabPostsInCollab, {
		fields: [collabPostImagesInCollab.postId],
		references: [collabPostsInCollab.id]
	}),
}));

export const collabPostsInCollabRelations = relations(collabPostsInCollab, ({one, many}) => ({
	collabPostImagesInCollabs: many(collabPostImagesInCollab),
	collabPostReportsInCollabs: many(collabPostReportsInCollab),
	collabPostRolesInCollabs: many(collabPostRolesInCollab),
	collabResponsesInCollabs: many(collabResponsesInCollab),
	userInAuth: one(userInAuth, {
		fields: [collabPostsInCollab.authorId],
		references: [userInAuth.id]
	}),
}));

export const collabPostReportsInCollabRelations = relations(collabPostReportsInCollab, ({one}) => ({
	collabPostsInCollab: one(collabPostsInCollab, {
		fields: [collabPostReportsInCollab.postId],
		references: [collabPostsInCollab.id]
	}),
	userInAuth: one(userInAuth, {
		fields: [collabPostReportsInCollab.reporterId],
		references: [userInAuth.id]
	}),
}));

export const collabPostRolesInCollabRelations = relations(collabPostRolesInCollab, ({one}) => ({
	collabPostsInCollab: one(collabPostsInCollab, {
		fields: [collabPostRolesInCollab.postId],
		references: [collabPostsInCollab.id]
	}),
	collabRolesInCollab: one(collabRolesInCollab, {
		fields: [collabPostRolesInCollab.roleId],
		references: [collabRolesInCollab.id]
	}),
}));

export const collabRolesInCollabRelations = relations(collabRolesInCollab, ({many}) => ({
	collabPostRolesInCollabs: many(collabPostRolesInCollab),
}));

export const collabResponsesInCollabRelations = relations(collabResponsesInCollab, ({one}) => ({
	collabPostsInCollab: one(collabPostsInCollab, {
		fields: [collabResponsesInCollab.postId],
		references: [collabPostsInCollab.id]
	}),
	userInAuth: one(userInAuth, {
		fields: [collabResponsesInCollab.responderId],
		references: [userInAuth.id]
	}),
}));

export const linkedAccountsInUserRelations = relations(linkedAccountsInUser, ({one}) => ({
	developerProfilesInUser: one(developerProfilesInUser, {
		fields: [linkedAccountsInUser.profileId],
		references: [developerProfilesInUser.id]
	}),
}));

export const userNotificationSettingsInUserRelations = relations(userNotificationSettingsInUser, ({one}) => ({
	userInAuth: one(userInAuth, {
		fields: [userNotificationSettingsInUser.userId],
		references: [userInAuth.id]
	}),
}));

export const mutesInHammerRelations = relations(mutesInHammer, ({one}) => ({
	developerProfilesInUser: one(developerProfilesInUser, {
		fields: [mutesInHammer.userId],
		references: [developerProfilesInUser.discordId]
	}),
}));

export const temporaryBansInHammerRelations = relations(temporaryBansInHammer, ({one}) => ({
	developerProfilesInUser: one(developerProfilesInUser, {
		fields: [temporaryBansInHammer.userId],
		references: [developerProfilesInUser.discordId]
	}),
}));

export const blockedReportersInHammerRelations = relations(blockedReportersInHammer, ({one}) => ({
	developerProfilesInUser_userId: one(developerProfilesInUser, {
		fields: [blockedReportersInHammer.userId],
		references: [developerProfilesInUser.discordId],
		relationName: "blockedReportersInHammer_userId_developerProfilesInUser_discordId"
	}),
	developerProfilesInUser_staffMemberId: one(developerProfilesInUser, {
		fields: [blockedReportersInHammer.staffMemberId],
		references: [developerProfilesInUser.discordId],
		relationName: "blockedReportersInHammer_staffMemberId_developerProfilesInUser_discordId"
	}),
}));

export const altAccountsInHammerRelations = relations(altAccountsInHammer, ({one}) => ({
	developerProfilesInUser_altId: one(developerProfilesInUser, {
		fields: [altAccountsInHammer.altId],
		references: [developerProfilesInUser.discordId],
		relationName: "altAccountsInHammer_altId_developerProfilesInUser_discordId"
	}),
	developerProfilesInUser_staffMemberId: one(developerProfilesInUser, {
		fields: [altAccountsInHammer.staffMemberId],
		references: [developerProfilesInUser.discordId],
		relationName: "altAccountsInHammer_staffMemberId_developerProfilesInUser_discordId"
	}),
	developerProfilesInUser_userId: one(developerProfilesInUser, {
		fields: [altAccountsInHammer.userId],
		references: [developerProfilesInUser.discordId],
		relationName: "altAccountsInHammer_userId_developerProfilesInUser_discordId"
	}),
}));

export const jamEntryResultsInItchRelations = relations(jamEntryResultsInItch, ({one}) => ({
	jamEntriesInItch: one(jamEntriesInItch, {
		fields: [jamEntryResultsInItch.entryId],
		references: [jamEntriesInItch.entryId]
	}),
}));

export const notificationPreferencesInUserRelations = relations(notificationPreferencesInUser, ({one}) => ({
	userInAuth: one(userInAuth, {
		fields: [notificationPreferencesInUser.userId],
		references: [userInAuth.id]
	}),
}));