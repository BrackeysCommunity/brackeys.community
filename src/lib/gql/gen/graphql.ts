/* eslint-disable */
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = {
  [K in keyof T]: T[K];
};
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & {
  [SubKey in K]?: Maybe<T[SubKey]>;
};
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & {
  [SubKey in K]: Maybe<T[SubKey]>;
};
export type MakeEmpty<
  T extends { [key: string]: unknown },
  K extends keyof T,
> = {
  [_ in K]?: never;
};
export type Incremental<T> =
  | T
  | {
      [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never;
    };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string };
  String: { input: string; output: string };
  Boolean: { input: boolean; output: boolean };
  Int: { input: number; output: number };
  Float: { input: number; output: number };
  Bytes: { input: any; output: any };
  Float64: { input: any; output: any };
  Int8: { input: any; output: any };
  Int32: { input: any; output: any };
  Int64: { input: any; output: any };
  String1: { input: any; output: any };
  Timestamp: { input: any; output: any };
};

export type AltAccount = {
  __typename?: 'AltAccount';
  altId: Scalars['Int64']['output'];
  registeredAt: Scalars['Timestamp']['output'];
  staffMemberId: Scalars['Int64']['output'];
  userId: Scalars['Int64']['output'];
};

export type AltAccountAggExp = {
  __typename?: 'AltAccountAggExp';
  _count: Scalars['Int']['output'];
  altId: Int64AggExp1;
  registeredAt: TimestampAggExp1;
  staffMemberId: Int64AggExp1;
  userId: Int64AggExp1;
};

export type AltAccountBoolExp = {
  _and?: InputMaybe<Array<AltAccountBoolExp>>;
  _not?: InputMaybe<AltAccountBoolExp>;
  _or?: InputMaybe<Array<AltAccountBoolExp>>;
  altId?: InputMaybe<Int64BoolExp1>;
  registeredAt?: InputMaybe<TimestampBoolExp1>;
  staffMemberId?: InputMaybe<Int64BoolExp1>;
  userId?: InputMaybe<Int64BoolExp1>;
};

export type AltAccountFilterInput = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<AltAccountOrderByExp>>;
  where?: InputMaybe<AltAccountBoolExp>;
};

export type AltAccountOrderByExp = {
  altId?: InputMaybe<OrderBy>;
  registeredAt?: InputMaybe<OrderBy>;
  staffMemberId?: InputMaybe<OrderBy>;
  userId?: InputMaybe<OrderBy>;
};

export type BlockedReporter = {
  __typename?: 'BlockedReporter';
  blockedAt: Scalars['Timestamp']['output'];
  guildId: Scalars['Int64']['output'];
  staffMemberId: Scalars['Int64']['output'];
  userId: Scalars['Int64']['output'];
};

export type BlockedReporterAggExp = {
  __typename?: 'BlockedReporterAggExp';
  _count: Scalars['Int']['output'];
  blockedAt: TimestampAggExp1;
  guildId: Int64AggExp1;
  staffMemberId: Int64AggExp1;
  userId: Int64AggExp1;
};

export type BlockedReporterBoolExp = {
  _and?: InputMaybe<Array<BlockedReporterBoolExp>>;
  _not?: InputMaybe<BlockedReporterBoolExp>;
  _or?: InputMaybe<Array<BlockedReporterBoolExp>>;
  blockedAt?: InputMaybe<TimestampBoolExp1>;
  guildId?: InputMaybe<Int64BoolExp1>;
  staffMemberId?: InputMaybe<Int64BoolExp1>;
  userId?: InputMaybe<Int64BoolExp1>;
};

export type BlockedReporterFilterInput = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<BlockedReporterOrderByExp>>;
  where?: InputMaybe<BlockedReporterBoolExp>;
};

export type BlockedReporterOrderByExp = {
  blockedAt?: InputMaybe<OrderBy>;
  guildId?: InputMaybe<OrderBy>;
  staffMemberId?: InputMaybe<OrderBy>;
  userId?: InputMaybe<OrderBy>;
};

export type BytesAggExp = {
  __typename?: 'BytesAggExp';
  _count: Scalars['Int']['output'];
  _count_distinct: Scalars['Int']['output'];
};

export type BytesBoolExp = {
  _and?: InputMaybe<Array<BytesBoolExp>>;
  _eq?: InputMaybe<Scalars['Bytes']['input']>;
  _is_null?: InputMaybe<Scalars['Boolean']['input']>;
  _not?: InputMaybe<BytesBoolExp>;
  _or?: InputMaybe<Array<BytesBoolExp>>;
};

export type CollaborationAlert = {
  __typename?: 'CollaborationAlert';
  collaborationProfile?: Maybe<CollaborationProfile>;
  collaborationType?: Maybe<CollaborationType>;
  collaborationTypeId?: Maybe<Scalars['Int32']['output']>;
  createdAt: Scalars['Timestamp']['output'];
  guildId: Scalars['Int64']['output'];
  hiringStatus?: Maybe<HiringStatus>;
  hiringStatusId?: Maybe<Scalars['Int32']['output']>;
  id: Scalars['String1']['output'];
  isActive: Scalars['Int8']['output'];
  keywords?: Maybe<Scalars['String1']['output']>;
  lastNotifiedAt?: Maybe<Scalars['Timestamp']['output']>;
  name: Scalars['String1']['output'];
  profileId: Scalars['String1']['output'];
  tags?: Maybe<Scalars['String1']['output']>;
};

export type CollaborationAlertAggExp = {
  __typename?: 'CollaborationAlertAggExp';
  _count: Scalars['Int']['output'];
  collaborationTypeId: Int32AggExp;
  createdAt: TimestampAggExp;
  guildId: Int64AggExp;
  hiringStatusId: Int32AggExp;
  id: StringAggExp;
  isActive: Int8AggExp;
  keywords: StringAggExp;
  lastNotifiedAt: TimestampAggExp;
  name: StringAggExp;
  profileId: StringAggExp;
  tags: StringAggExp;
};

export type CollaborationAlertBoolExp = {
  _and?: InputMaybe<Array<CollaborationAlertBoolExp>>;
  _not?: InputMaybe<CollaborationAlertBoolExp>;
  _or?: InputMaybe<Array<CollaborationAlertBoolExp>>;
  collaborationProfile?: InputMaybe<CollaborationProfileBoolExp>;
  collaborationType?: InputMaybe<CollaborationTypeBoolExp>;
  collaborationTypeId?: InputMaybe<Int32BoolExp>;
  createdAt?: InputMaybe<TimestampBoolExp>;
  guildId?: InputMaybe<Int64BoolExp>;
  hiringStatus?: InputMaybe<HiringStatusBoolExp>;
  hiringStatusId?: InputMaybe<Int32BoolExp>;
  id?: InputMaybe<StringBoolExp>;
  isActive?: InputMaybe<Int8BoolExp>;
  keywords?: InputMaybe<StringBoolExp>;
  lastNotifiedAt?: InputMaybe<TimestampBoolExp>;
  name?: InputMaybe<StringBoolExp>;
  profileId?: InputMaybe<StringBoolExp>;
  tags?: InputMaybe<StringBoolExp>;
};

export type CollaborationAlertFilterInput = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationAlertOrderByExp>>;
  where?: InputMaybe<CollaborationAlertBoolExp>;
};

export type CollaborationAlertOrderByExp = {
  collaborationProfile?: InputMaybe<CollaborationProfileOrderByExp>;
  collaborationType?: InputMaybe<CollaborationTypeOrderByExp>;
  collaborationTypeId?: InputMaybe<OrderBy>;
  createdAt?: InputMaybe<OrderBy>;
  guildId?: InputMaybe<OrderBy>;
  hiringStatus?: InputMaybe<HiringStatusOrderByExp>;
  hiringStatusId?: InputMaybe<OrderBy>;
  id?: InputMaybe<OrderBy>;
  isActive?: InputMaybe<OrderBy>;
  keywords?: InputMaybe<OrderBy>;
  lastNotifiedAt?: InputMaybe<OrderBy>;
  name?: InputMaybe<OrderBy>;
  profileId?: InputMaybe<OrderBy>;
  tags?: InputMaybe<OrderBy>;
};

export type CollaborationAuditLog = {
  __typename?: 'CollaborationAuditLog';
  action: Scalars['String1']['output'];
  collaborationPost?: Maybe<CollaborationPost>;
  collaborationPostId?: Maybe<Scalars['String1']['output']>;
  collaborationProfile?: Maybe<CollaborationProfile>;
  createdAt: Scalars['Timestamp']['output'];
  id: Scalars['String1']['output'];
  metadata?: Maybe<Scalars['String1']['output']>;
  profileId?: Maybe<Scalars['String1']['output']>;
  reason?: Maybe<Scalars['String1']['output']>;
  staffMemberId: Scalars['Int64']['output'];
};

export type CollaborationAuditLogAggExp = {
  __typename?: 'CollaborationAuditLogAggExp';
  _count: Scalars['Int']['output'];
  action: StringAggExp;
  collaborationPostId: StringAggExp;
  createdAt: TimestampAggExp;
  id: StringAggExp;
  metadata: StringAggExp;
  profileId: StringAggExp;
  reason: StringAggExp;
  staffMemberId: Int64AggExp;
};

export type CollaborationAuditLogBoolExp = {
  _and?: InputMaybe<Array<CollaborationAuditLogBoolExp>>;
  _not?: InputMaybe<CollaborationAuditLogBoolExp>;
  _or?: InputMaybe<Array<CollaborationAuditLogBoolExp>>;
  action?: InputMaybe<StringBoolExp>;
  collaborationPost?: InputMaybe<CollaborationPostBoolExp>;
  collaborationPostId?: InputMaybe<StringBoolExp>;
  collaborationProfile?: InputMaybe<CollaborationProfileBoolExp>;
  createdAt?: InputMaybe<TimestampBoolExp>;
  id?: InputMaybe<StringBoolExp>;
  metadata?: InputMaybe<StringBoolExp>;
  profileId?: InputMaybe<StringBoolExp>;
  reason?: InputMaybe<StringBoolExp>;
  staffMemberId?: InputMaybe<Int64BoolExp>;
};

export type CollaborationAuditLogFilterInput = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationAuditLogOrderByExp>>;
  where?: InputMaybe<CollaborationAuditLogBoolExp>;
};

export type CollaborationAuditLogOrderByExp = {
  action?: InputMaybe<OrderBy>;
  collaborationPost?: InputMaybe<CollaborationPostOrderByExp>;
  collaborationPostId?: InputMaybe<OrderBy>;
  collaborationProfile?: InputMaybe<CollaborationProfileOrderByExp>;
  createdAt?: InputMaybe<OrderBy>;
  id?: InputMaybe<OrderBy>;
  metadata?: InputMaybe<OrderBy>;
  profileId?: InputMaybe<OrderBy>;
  reason?: InputMaybe<OrderBy>;
  staffMemberId?: InputMaybe<OrderBy>;
};

export type CollaborationBlockedUser = {
  __typename?: 'CollaborationBlockedUser';
  blockedAt: Scalars['Timestamp']['output'];
  blockedByStaffId: Scalars['Int64']['output'];
  collaborationProfile?: Maybe<CollaborationProfile>;
  collaborationRule?: Maybe<CollaborationRule>;
  expiresAt?: Maybe<Scalars['Timestamp']['output']>;
  guildId: Scalars['Int64']['output'];
  id: Scalars['String1']['output'];
  profileId: Scalars['String1']['output'];
  reason?: Maybe<Scalars['String1']['output']>;
  violatedRuleId?: Maybe<Scalars['String1']['output']>;
};

export type CollaborationBlockedUserAggExp = {
  __typename?: 'CollaborationBlockedUserAggExp';
  _count: Scalars['Int']['output'];
  blockedAt: TimestampAggExp;
  blockedByStaffId: Int64AggExp;
  expiresAt: TimestampAggExp;
  guildId: Int64AggExp;
  id: StringAggExp;
  profileId: StringAggExp;
  reason: StringAggExp;
  violatedRuleId: StringAggExp;
};

export type CollaborationBlockedUserBoolExp = {
  _and?: InputMaybe<Array<CollaborationBlockedUserBoolExp>>;
  _not?: InputMaybe<CollaborationBlockedUserBoolExp>;
  _or?: InputMaybe<Array<CollaborationBlockedUserBoolExp>>;
  blockedAt?: InputMaybe<TimestampBoolExp>;
  blockedByStaffId?: InputMaybe<Int64BoolExp>;
  collaborationProfile?: InputMaybe<CollaborationProfileBoolExp>;
  collaborationRule?: InputMaybe<CollaborationRuleBoolExp>;
  expiresAt?: InputMaybe<TimestampBoolExp>;
  guildId?: InputMaybe<Int64BoolExp>;
  id?: InputMaybe<StringBoolExp>;
  profileId?: InputMaybe<StringBoolExp>;
  reason?: InputMaybe<StringBoolExp>;
  violatedRuleId?: InputMaybe<StringBoolExp>;
};

export type CollaborationBlockedUserFilterInput = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationBlockedUserOrderByExp>>;
  where?: InputMaybe<CollaborationBlockedUserBoolExp>;
};

export type CollaborationBlockedUserOrderByExp = {
  blockedAt?: InputMaybe<OrderBy>;
  blockedByStaffId?: InputMaybe<OrderBy>;
  collaborationProfile?: InputMaybe<CollaborationProfileOrderByExp>;
  collaborationRule?: InputMaybe<CollaborationRuleOrderByExp>;
  expiresAt?: InputMaybe<OrderBy>;
  guildId?: InputMaybe<OrderBy>;
  id?: InputMaybe<OrderBy>;
  profileId?: InputMaybe<OrderBy>;
  reason?: InputMaybe<OrderBy>;
  violatedRuleId?: InputMaybe<OrderBy>;
};

export type CollaborationBookmark = {
  __typename?: 'CollaborationBookmark';
  collaborationPost?: Maybe<CollaborationPost>;
  collaborationPostId: Scalars['String1']['output'];
  collaborationProfile?: Maybe<CollaborationProfile>;
  createdAt: Scalars['Timestamp']['output'];
  id: Scalars['String1']['output'];
  notes?: Maybe<Scalars['String1']['output']>;
  profileId: Scalars['String1']['output'];
};

export type CollaborationBookmarkAggExp = {
  __typename?: 'CollaborationBookmarkAggExp';
  _count: Scalars['Int']['output'];
  collaborationPostId: StringAggExp;
  createdAt: TimestampAggExp;
  id: StringAggExp;
  notes: StringAggExp;
  profileId: StringAggExp;
};

export type CollaborationBookmarkBoolExp = {
  _and?: InputMaybe<Array<CollaborationBookmarkBoolExp>>;
  _not?: InputMaybe<CollaborationBookmarkBoolExp>;
  _or?: InputMaybe<Array<CollaborationBookmarkBoolExp>>;
  collaborationPost?: InputMaybe<CollaborationPostBoolExp>;
  collaborationPostId?: InputMaybe<StringBoolExp>;
  collaborationProfile?: InputMaybe<CollaborationProfileBoolExp>;
  createdAt?: InputMaybe<TimestampBoolExp>;
  id?: InputMaybe<StringBoolExp>;
  notes?: InputMaybe<StringBoolExp>;
  profileId?: InputMaybe<StringBoolExp>;
};

export type CollaborationBookmarkFilterInput = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationBookmarkOrderByExp>>;
  where?: InputMaybe<CollaborationBookmarkBoolExp>;
};

export type CollaborationBookmarkOrderByExp = {
  collaborationPost?: InputMaybe<CollaborationPostOrderByExp>;
  collaborationPostId?: InputMaybe<OrderBy>;
  collaborationProfile?: InputMaybe<CollaborationProfileOrderByExp>;
  createdAt?: InputMaybe<OrderBy>;
  id?: InputMaybe<OrderBy>;
  notes?: InputMaybe<OrderBy>;
  profileId?: InputMaybe<OrderBy>;
};

export type CollaborationFieldDefinition = {
  __typename?: 'CollaborationFieldDefinition';
  collaborationFieldValues?: Maybe<Array<CollaborationFieldValue>>;
  collaborationFieldValuesAggregate: CollaborationFieldValueAggExp;
  collaborationType?: Maybe<CollaborationType>;
  collaborationTypeId: Scalars['Int32']['output'];
  displayName: Scalars['String1']['output'];
  fieldName: Scalars['String1']['output'];
  fieldOrder: Scalars['Int32']['output'];
  fieldType: Scalars['String1']['output'];
  helpText?: Maybe<Scalars['String1']['output']>;
  hiringStatus?: Maybe<HiringStatus>;
  hiringStatusId: Scalars['Int32']['output'];
  id: Scalars['String1']['output'];
  isRequired: Scalars['Int8']['output'];
  maxLength?: Maybe<Scalars['Int32']['output']>;
  options?: Maybe<Scalars['String1']['output']>;
  validationRegex?: Maybe<Scalars['String1']['output']>;
};

export type CollaborationFieldDefinitionCollaborationFieldValuesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationFieldValueOrderByExp>>;
  where?: InputMaybe<CollaborationFieldValueBoolExp>;
};

export type CollaborationFieldDefinitionCollaborationFieldValuesAggregateArgs =
  {
    filter_input?: InputMaybe<CollaborationFieldValueFilterInput>;
  };

export type CollaborationFieldDefinitionAggExp = {
  __typename?: 'CollaborationFieldDefinitionAggExp';
  _count: Scalars['Int']['output'];
  collaborationTypeId: Int32AggExp;
  displayName: StringAggExp;
  fieldName: StringAggExp;
  fieldOrder: Int32AggExp;
  fieldType: StringAggExp;
  helpText: StringAggExp;
  hiringStatusId: Int32AggExp;
  id: StringAggExp;
  isRequired: Int8AggExp;
  maxLength: Int32AggExp;
  options: StringAggExp;
  validationRegex: StringAggExp;
};

export type CollaborationFieldDefinitionBoolExp = {
  _and?: InputMaybe<Array<CollaborationFieldDefinitionBoolExp>>;
  _not?: InputMaybe<CollaborationFieldDefinitionBoolExp>;
  _or?: InputMaybe<Array<CollaborationFieldDefinitionBoolExp>>;
  collaborationFieldValues?: InputMaybe<CollaborationFieldValueBoolExp>;
  collaborationType?: InputMaybe<CollaborationTypeBoolExp>;
  collaborationTypeId?: InputMaybe<Int32BoolExp>;
  displayName?: InputMaybe<StringBoolExp>;
  fieldName?: InputMaybe<StringBoolExp>;
  fieldOrder?: InputMaybe<Int32BoolExp>;
  fieldType?: InputMaybe<StringBoolExp>;
  helpText?: InputMaybe<StringBoolExp>;
  hiringStatus?: InputMaybe<HiringStatusBoolExp>;
  hiringStatusId?: InputMaybe<Int32BoolExp>;
  id?: InputMaybe<StringBoolExp>;
  isRequired?: InputMaybe<Int8BoolExp>;
  maxLength?: InputMaybe<Int32BoolExp>;
  options?: InputMaybe<StringBoolExp>;
  validationRegex?: InputMaybe<StringBoolExp>;
};

export type CollaborationFieldDefinitionFilterInput = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationFieldDefinitionOrderByExp>>;
  where?: InputMaybe<CollaborationFieldDefinitionBoolExp>;
};

export type CollaborationFieldDefinitionOrderByExp = {
  collaborationType?: InputMaybe<CollaborationTypeOrderByExp>;
  collaborationTypeId?: InputMaybe<OrderBy>;
  displayName?: InputMaybe<OrderBy>;
  fieldName?: InputMaybe<OrderBy>;
  fieldOrder?: InputMaybe<OrderBy>;
  fieldType?: InputMaybe<OrderBy>;
  helpText?: InputMaybe<OrderBy>;
  hiringStatus?: InputMaybe<HiringStatusOrderByExp>;
  hiringStatusId?: InputMaybe<OrderBy>;
  id?: InputMaybe<OrderBy>;
  isRequired?: InputMaybe<OrderBy>;
  maxLength?: InputMaybe<OrderBy>;
  options?: InputMaybe<OrderBy>;
  validationRegex?: InputMaybe<OrderBy>;
};

export type CollaborationFieldValue = {
  __typename?: 'CollaborationFieldValue';
  collaborationFieldDefinition?: Maybe<CollaborationFieldDefinition>;
  collaborationPost?: Maybe<CollaborationPost>;
  collaborationPostId: Scalars['String1']['output'];
  fieldDefinitionId: Scalars['String1']['output'];
  id: Scalars['String1']['output'];
  value: Scalars['String1']['output'];
};

export type CollaborationFieldValueAggExp = {
  __typename?: 'CollaborationFieldValueAggExp';
  _count: Scalars['Int']['output'];
  collaborationPostId: StringAggExp;
  fieldDefinitionId: StringAggExp;
  id: StringAggExp;
  value: StringAggExp;
};

export type CollaborationFieldValueBoolExp = {
  _and?: InputMaybe<Array<CollaborationFieldValueBoolExp>>;
  _not?: InputMaybe<CollaborationFieldValueBoolExp>;
  _or?: InputMaybe<Array<CollaborationFieldValueBoolExp>>;
  collaborationFieldDefinition?: InputMaybe<CollaborationFieldDefinitionBoolExp>;
  collaborationPost?: InputMaybe<CollaborationPostBoolExp>;
  collaborationPostId?: InputMaybe<StringBoolExp>;
  fieldDefinitionId?: InputMaybe<StringBoolExp>;
  id?: InputMaybe<StringBoolExp>;
  value?: InputMaybe<StringBoolExp>;
};

export type CollaborationFieldValueFilterInput = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationFieldValueOrderByExp>>;
  where?: InputMaybe<CollaborationFieldValueBoolExp>;
};

export type CollaborationFieldValueOrderByExp = {
  collaborationFieldDefinition?: InputMaybe<CollaborationFieldDefinitionOrderByExp>;
  collaborationPost?: InputMaybe<CollaborationPostOrderByExp>;
  collaborationPostId?: InputMaybe<OrderBy>;
  fieldDefinitionId?: InputMaybe<OrderBy>;
  id?: InputMaybe<OrderBy>;
  value?: InputMaybe<OrderBy>;
};

export type CollaborationPost = {
  __typename?: 'CollaborationPost';
  collaborationAuditLogs?: Maybe<Array<CollaborationAuditLog>>;
  collaborationAuditLogsAggregate: CollaborationAuditLogAggExp;
  collaborationBookmarks?: Maybe<Array<CollaborationBookmark>>;
  collaborationBookmarksAggregate: CollaborationBookmarkAggExp;
  collaborationFieldValues?: Maybe<Array<CollaborationFieldValue>>;
  collaborationFieldValuesAggregate: CollaborationFieldValueAggExp;
  collaborationProfile?: Maybe<CollaborationProfile>;
  collaborationReports?: Maybe<Array<CollaborationReport>>;
  collaborationReportsAggregate: CollaborationReportAggExp;
  collaborationResponses?: Maybe<Array<CollaborationResponse>>;
  collaborationResponsesAggregate: CollaborationResponseAggExp;
  collaborationStatus?: Maybe<CollaborationStatus>;
  collaborationType?: Maybe<CollaborationType>;
  collaborationTypeId: Scalars['Int32']['output'];
  createdAt: Scalars['Timestamp']['output'];
  discordChannelId?: Maybe<Scalars['Int64']['output']>;
  discordMessageId?: Maybe<Scalars['Int64']['output']>;
  expiresAt?: Maybe<Scalars['Timestamp']['output']>;
  guildId: Scalars['Int64']['output'];
  hiringStatus?: Maybe<HiringStatus>;
  hiringStatusId: Scalars['Int32']['output'];
  id: Scalars['String1']['output'];
  isHighlighted: Scalars['Int8']['output'];
  postedAt?: Maybe<Scalars['Timestamp']['output']>;
  profileId: Scalars['String1']['output'];
  responseCount: Scalars['Int32']['output'];
  statusId: Scalars['Int32']['output'];
  tags?: Maybe<Scalars['String1']['output']>;
  updatedAt: Scalars['Timestamp']['output'];
  viewCount: Scalars['Int32']['output'];
};

export type CollaborationPostCollaborationAuditLogsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationAuditLogOrderByExp>>;
  where?: InputMaybe<CollaborationAuditLogBoolExp>;
};

export type CollaborationPostCollaborationAuditLogsAggregateArgs = {
  filter_input?: InputMaybe<CollaborationAuditLogFilterInput>;
};

export type CollaborationPostCollaborationBookmarksArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationBookmarkOrderByExp>>;
  where?: InputMaybe<CollaborationBookmarkBoolExp>;
};

export type CollaborationPostCollaborationBookmarksAggregateArgs = {
  filter_input?: InputMaybe<CollaborationBookmarkFilterInput>;
};

export type CollaborationPostCollaborationFieldValuesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationFieldValueOrderByExp>>;
  where?: InputMaybe<CollaborationFieldValueBoolExp>;
};

export type CollaborationPostCollaborationFieldValuesAggregateArgs = {
  filter_input?: InputMaybe<CollaborationFieldValueFilterInput>;
};

export type CollaborationPostCollaborationReportsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationReportOrderByExp>>;
  where?: InputMaybe<CollaborationReportBoolExp>;
};

export type CollaborationPostCollaborationReportsAggregateArgs = {
  filter_input?: InputMaybe<CollaborationReportFilterInput>;
};

export type CollaborationPostCollaborationResponsesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationResponseOrderByExp>>;
  where?: InputMaybe<CollaborationResponseBoolExp>;
};

export type CollaborationPostCollaborationResponsesAggregateArgs = {
  filter_input?: InputMaybe<CollaborationResponseFilterInput>;
};

export type CollaborationPostAggExp = {
  __typename?: 'CollaborationPostAggExp';
  _count: Scalars['Int']['output'];
  collaborationTypeId: Int32AggExp;
  createdAt: TimestampAggExp;
  discordChannelId: Int64AggExp;
  discordMessageId: Int64AggExp;
  expiresAt: TimestampAggExp;
  guildId: Int64AggExp;
  hiringStatusId: Int32AggExp;
  id: StringAggExp;
  isHighlighted: Int8AggExp;
  postedAt: TimestampAggExp;
  profileId: StringAggExp;
  responseCount: Int32AggExp;
  statusId: Int32AggExp;
  tags: StringAggExp;
  updatedAt: TimestampAggExp;
  viewCount: Int32AggExp;
};

export type CollaborationPostBoolExp = {
  _and?: InputMaybe<Array<CollaborationPostBoolExp>>;
  _not?: InputMaybe<CollaborationPostBoolExp>;
  _or?: InputMaybe<Array<CollaborationPostBoolExp>>;
  collaborationAuditLogs?: InputMaybe<CollaborationAuditLogBoolExp>;
  collaborationBookmarks?: InputMaybe<CollaborationBookmarkBoolExp>;
  collaborationFieldValues?: InputMaybe<CollaborationFieldValueBoolExp>;
  collaborationProfile?: InputMaybe<CollaborationProfileBoolExp>;
  collaborationReports?: InputMaybe<CollaborationReportBoolExp>;
  collaborationResponses?: InputMaybe<CollaborationResponseBoolExp>;
  collaborationStatus?: InputMaybe<CollaborationStatusBoolExp>;
  collaborationType?: InputMaybe<CollaborationTypeBoolExp>;
  collaborationTypeId?: InputMaybe<Int32BoolExp>;
  createdAt?: InputMaybe<TimestampBoolExp>;
  discordChannelId?: InputMaybe<Int64BoolExp>;
  discordMessageId?: InputMaybe<Int64BoolExp>;
  expiresAt?: InputMaybe<TimestampBoolExp>;
  guildId?: InputMaybe<Int64BoolExp>;
  hiringStatus?: InputMaybe<HiringStatusBoolExp>;
  hiringStatusId?: InputMaybe<Int32BoolExp>;
  id?: InputMaybe<StringBoolExp>;
  isHighlighted?: InputMaybe<Int8BoolExp>;
  postedAt?: InputMaybe<TimestampBoolExp>;
  profileId?: InputMaybe<StringBoolExp>;
  responseCount?: InputMaybe<Int32BoolExp>;
  statusId?: InputMaybe<Int32BoolExp>;
  tags?: InputMaybe<StringBoolExp>;
  updatedAt?: InputMaybe<TimestampBoolExp>;
  viewCount?: InputMaybe<Int32BoolExp>;
};

export type CollaborationPostFilterInput = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationPostOrderByExp>>;
  where?: InputMaybe<CollaborationPostBoolExp>;
};

export type CollaborationPostOrderByExp = {
  collaborationProfile?: InputMaybe<CollaborationProfileOrderByExp>;
  collaborationStatus?: InputMaybe<CollaborationStatusOrderByExp>;
  collaborationType?: InputMaybe<CollaborationTypeOrderByExp>;
  collaborationTypeId?: InputMaybe<OrderBy>;
  createdAt?: InputMaybe<OrderBy>;
  discordChannelId?: InputMaybe<OrderBy>;
  discordMessageId?: InputMaybe<OrderBy>;
  expiresAt?: InputMaybe<OrderBy>;
  guildId?: InputMaybe<OrderBy>;
  hiringStatus?: InputMaybe<HiringStatusOrderByExp>;
  hiringStatusId?: InputMaybe<OrderBy>;
  id?: InputMaybe<OrderBy>;
  isHighlighted?: InputMaybe<OrderBy>;
  postedAt?: InputMaybe<OrderBy>;
  profileId?: InputMaybe<OrderBy>;
  responseCount?: InputMaybe<OrderBy>;
  statusId?: InputMaybe<OrderBy>;
  tags?: InputMaybe<OrderBy>;
  updatedAt?: InputMaybe<OrderBy>;
  viewCount?: InputMaybe<OrderBy>;
};

export type CollaborationProfile = {
  __typename?: 'CollaborationProfile';
  bio?: Maybe<Scalars['String1']['output']>;
  collaborationAlerts?: Maybe<Array<CollaborationAlert>>;
  collaborationAlertsAggregate: CollaborationAlertAggExp;
  collaborationAuditLogs?: Maybe<Array<CollaborationAuditLog>>;
  collaborationAuditLogsAggregate: CollaborationAuditLogAggExp;
  collaborationBlockedUsers?: Maybe<Array<CollaborationBlockedUser>>;
  collaborationBlockedUsersAggregate: CollaborationBlockedUserAggExp;
  collaborationBookmarks?: Maybe<Array<CollaborationBookmark>>;
  collaborationBookmarksAggregate: CollaborationBookmarkAggExp;
  collaborationPosts?: Maybe<Array<CollaborationPost>>;
  collaborationPostsAggregate: CollaborationPostAggExp;
  collaborationReports?: Maybe<Array<CollaborationReport>>;
  collaborationReportsAggregate: CollaborationReportAggExp;
  collaborationReportsByReportedByProfileId?: Maybe<Array<CollaborationReport>>;
  collaborationReportsByReportedByProfileIdAggregate: CollaborationReportAggExp;
  collaborationResponses?: Maybe<Array<CollaborationResponse>>;
  collaborationResponsesAggregate: CollaborationResponseAggExp;
  contactPreferences?: Maybe<Scalars['String1']['output']>;
  createdAt: Scalars['Timestamp']['output'];
  displayName?: Maybe<Scalars['String1']['output']>;
  guildId: Scalars['Int64']['output'];
  id: Scalars['String1']['output'];
  isPublic: Scalars['Int8']['output'];
  lastActiveAt?: Maybe<Scalars['Timestamp']['output']>;
  portfolio?: Maybe<Scalars['String1']['output']>;
  skills?: Maybe<Scalars['String1']['output']>;
  updatedAt: Scalars['Timestamp']['output'];
  userId: Scalars['Int64']['output'];
};

export type CollaborationProfileCollaborationAlertsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationAlertOrderByExp>>;
  where?: InputMaybe<CollaborationAlertBoolExp>;
};

export type CollaborationProfileCollaborationAlertsAggregateArgs = {
  filter_input?: InputMaybe<CollaborationAlertFilterInput>;
};

export type CollaborationProfileCollaborationAuditLogsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationAuditLogOrderByExp>>;
  where?: InputMaybe<CollaborationAuditLogBoolExp>;
};

export type CollaborationProfileCollaborationAuditLogsAggregateArgs = {
  filter_input?: InputMaybe<CollaborationAuditLogFilterInput>;
};

export type CollaborationProfileCollaborationBlockedUsersArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationBlockedUserOrderByExp>>;
  where?: InputMaybe<CollaborationBlockedUserBoolExp>;
};

export type CollaborationProfileCollaborationBlockedUsersAggregateArgs = {
  filter_input?: InputMaybe<CollaborationBlockedUserFilterInput>;
};

export type CollaborationProfileCollaborationBookmarksArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationBookmarkOrderByExp>>;
  where?: InputMaybe<CollaborationBookmarkBoolExp>;
};

export type CollaborationProfileCollaborationBookmarksAggregateArgs = {
  filter_input?: InputMaybe<CollaborationBookmarkFilterInput>;
};

export type CollaborationProfileCollaborationPostsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationPostOrderByExp>>;
  where?: InputMaybe<CollaborationPostBoolExp>;
};

export type CollaborationProfileCollaborationPostsAggregateArgs = {
  filter_input?: InputMaybe<CollaborationPostFilterInput>;
};

export type CollaborationProfileCollaborationReportsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationReportOrderByExp>>;
  where?: InputMaybe<CollaborationReportBoolExp>;
};

export type CollaborationProfileCollaborationReportsAggregateArgs = {
  filter_input?: InputMaybe<CollaborationReportFilterInput>;
};

export type CollaborationProfileCollaborationReportsByReportedByProfileIdArgs =
  {
    limit?: InputMaybe<Scalars['Int']['input']>;
    offset?: InputMaybe<Scalars['Int']['input']>;
    order_by?: InputMaybe<Array<CollaborationReportOrderByExp>>;
    where?: InputMaybe<CollaborationReportBoolExp>;
  };

export type CollaborationProfileCollaborationReportsByReportedByProfileIdAggregateArgs =
  {
    filter_input?: InputMaybe<CollaborationReportFilterInput>;
  };

export type CollaborationProfileCollaborationResponsesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationResponseOrderByExp>>;
  where?: InputMaybe<CollaborationResponseBoolExp>;
};

export type CollaborationProfileCollaborationResponsesAggregateArgs = {
  filter_input?: InputMaybe<CollaborationResponseFilterInput>;
};

export type CollaborationProfileAggExp = {
  __typename?: 'CollaborationProfileAggExp';
  _count: Scalars['Int']['output'];
  bio: StringAggExp;
  contactPreferences: StringAggExp;
  createdAt: TimestampAggExp;
  displayName: StringAggExp;
  guildId: Int64AggExp;
  id: StringAggExp;
  isPublic: Int8AggExp;
  lastActiveAt: TimestampAggExp;
  portfolio: StringAggExp;
  skills: StringAggExp;
  updatedAt: TimestampAggExp;
  userId: Int64AggExp;
};

export type CollaborationProfileBoolExp = {
  _and?: InputMaybe<Array<CollaborationProfileBoolExp>>;
  _not?: InputMaybe<CollaborationProfileBoolExp>;
  _or?: InputMaybe<Array<CollaborationProfileBoolExp>>;
  bio?: InputMaybe<StringBoolExp>;
  collaborationAlerts?: InputMaybe<CollaborationAlertBoolExp>;
  collaborationAuditLogs?: InputMaybe<CollaborationAuditLogBoolExp>;
  collaborationBlockedUsers?: InputMaybe<CollaborationBlockedUserBoolExp>;
  collaborationBookmarks?: InputMaybe<CollaborationBookmarkBoolExp>;
  collaborationPosts?: InputMaybe<CollaborationPostBoolExp>;
  collaborationReports?: InputMaybe<CollaborationReportBoolExp>;
  collaborationReportsByReportedByProfileId?: InputMaybe<CollaborationReportBoolExp>;
  collaborationResponses?: InputMaybe<CollaborationResponseBoolExp>;
  contactPreferences?: InputMaybe<StringBoolExp>;
  createdAt?: InputMaybe<TimestampBoolExp>;
  displayName?: InputMaybe<StringBoolExp>;
  guildId?: InputMaybe<Int64BoolExp>;
  id?: InputMaybe<StringBoolExp>;
  isPublic?: InputMaybe<Int8BoolExp>;
  lastActiveAt?: InputMaybe<TimestampBoolExp>;
  portfolio?: InputMaybe<StringBoolExp>;
  skills?: InputMaybe<StringBoolExp>;
  updatedAt?: InputMaybe<TimestampBoolExp>;
  userId?: InputMaybe<Int64BoolExp>;
};

export type CollaborationProfileFilterInput = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationProfileOrderByExp>>;
  where?: InputMaybe<CollaborationProfileBoolExp>;
};

export type CollaborationProfileOrderByExp = {
  bio?: InputMaybe<OrderBy>;
  contactPreferences?: InputMaybe<OrderBy>;
  createdAt?: InputMaybe<OrderBy>;
  displayName?: InputMaybe<OrderBy>;
  guildId?: InputMaybe<OrderBy>;
  id?: InputMaybe<OrderBy>;
  isPublic?: InputMaybe<OrderBy>;
  lastActiveAt?: InputMaybe<OrderBy>;
  portfolio?: InputMaybe<OrderBy>;
  skills?: InputMaybe<OrderBy>;
  updatedAt?: InputMaybe<OrderBy>;
  userId?: InputMaybe<OrderBy>;
};

export type CollaborationReport = {
  __typename?: 'CollaborationReport';
  collaborationPost?: Maybe<CollaborationPost>;
  collaborationPostId?: Maybe<Scalars['String1']['output']>;
  collaborationProfile?: Maybe<CollaborationProfile>;
  collaborationProfileByReportedByProfileId?: Maybe<CollaborationProfile>;
  collaborationResponse?: Maybe<CollaborationResponse>;
  collaborationResponseId?: Maybe<Scalars['String1']['output']>;
  collaborationRule?: Maybe<CollaborationRule>;
  createdAt: Scalars['Timestamp']['output'];
  details?: Maybe<Scalars['String1']['output']>;
  id: Scalars['String1']['output'];
  reason: Scalars['String1']['output'];
  reportedByProfileId: Scalars['String1']['output'];
  reportedProfileId: Scalars['String1']['output'];
  resolution?: Maybe<Scalars['String1']['output']>;
  resolvedAt?: Maybe<Scalars['Timestamp']['output']>;
  resolvedByStaffId?: Maybe<Scalars['Int64']['output']>;
  violatedRuleId?: Maybe<Scalars['String1']['output']>;
};

export type CollaborationReportAggExp = {
  __typename?: 'CollaborationReportAggExp';
  _count: Scalars['Int']['output'];
  collaborationPostId: StringAggExp;
  collaborationResponseId: StringAggExp;
  createdAt: TimestampAggExp;
  details: StringAggExp;
  id: StringAggExp;
  reason: StringAggExp;
  reportedByProfileId: StringAggExp;
  reportedProfileId: StringAggExp;
  resolution: StringAggExp;
  resolvedAt: TimestampAggExp;
  resolvedByStaffId: Int64AggExp;
  violatedRuleId: StringAggExp;
};

export type CollaborationReportBoolExp = {
  _and?: InputMaybe<Array<CollaborationReportBoolExp>>;
  _not?: InputMaybe<CollaborationReportBoolExp>;
  _or?: InputMaybe<Array<CollaborationReportBoolExp>>;
  collaborationPost?: InputMaybe<CollaborationPostBoolExp>;
  collaborationPostId?: InputMaybe<StringBoolExp>;
  collaborationProfile?: InputMaybe<CollaborationProfileBoolExp>;
  collaborationProfileByReportedByProfileId?: InputMaybe<CollaborationProfileBoolExp>;
  collaborationResponse?: InputMaybe<CollaborationResponseBoolExp>;
  collaborationResponseId?: InputMaybe<StringBoolExp>;
  collaborationRule?: InputMaybe<CollaborationRuleBoolExp>;
  createdAt?: InputMaybe<TimestampBoolExp>;
  details?: InputMaybe<StringBoolExp>;
  id?: InputMaybe<StringBoolExp>;
  reason?: InputMaybe<StringBoolExp>;
  reportedByProfileId?: InputMaybe<StringBoolExp>;
  reportedProfileId?: InputMaybe<StringBoolExp>;
  resolution?: InputMaybe<StringBoolExp>;
  resolvedAt?: InputMaybe<TimestampBoolExp>;
  resolvedByStaffId?: InputMaybe<Int64BoolExp>;
  violatedRuleId?: InputMaybe<StringBoolExp>;
};

export type CollaborationReportFilterInput = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationReportOrderByExp>>;
  where?: InputMaybe<CollaborationReportBoolExp>;
};

export type CollaborationReportOrderByExp = {
  collaborationPost?: InputMaybe<CollaborationPostOrderByExp>;
  collaborationPostId?: InputMaybe<OrderBy>;
  collaborationProfile?: InputMaybe<CollaborationProfileOrderByExp>;
  collaborationProfileByReportedByProfileId?: InputMaybe<CollaborationProfileOrderByExp>;
  collaborationResponse?: InputMaybe<CollaborationResponseOrderByExp>;
  collaborationResponseId?: InputMaybe<OrderBy>;
  collaborationRule?: InputMaybe<CollaborationRuleOrderByExp>;
  createdAt?: InputMaybe<OrderBy>;
  details?: InputMaybe<OrderBy>;
  id?: InputMaybe<OrderBy>;
  reason?: InputMaybe<OrderBy>;
  reportedByProfileId?: InputMaybe<OrderBy>;
  reportedProfileId?: InputMaybe<OrderBy>;
  resolution?: InputMaybe<OrderBy>;
  resolvedAt?: InputMaybe<OrderBy>;
  resolvedByStaffId?: InputMaybe<OrderBy>;
  violatedRuleId?: InputMaybe<OrderBy>;
};

export type CollaborationResponse = {
  __typename?: 'CollaborationResponse';
  collaborationPost?: Maybe<CollaborationPost>;
  collaborationPostId: Scalars['String1']['output'];
  collaborationProfile?: Maybe<CollaborationProfile>;
  collaborationReports?: Maybe<Array<CollaborationReport>>;
  collaborationReportsAggregate: CollaborationReportAggExp;
  contactInfo?: Maybe<Scalars['String1']['output']>;
  createdAt: Scalars['Timestamp']['output'];
  id: Scalars['String1']['output'];
  isHidden: Scalars['Int8']['output'];
  isPublic: Scalars['Int8']['output'];
  isRead: Scalars['Int8']['output'];
  message: Scalars['String1']['output'];
  profileId: Scalars['String1']['output'];
  readAt?: Maybe<Scalars['Timestamp']['output']>;
};

export type CollaborationResponseCollaborationReportsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationReportOrderByExp>>;
  where?: InputMaybe<CollaborationReportBoolExp>;
};

export type CollaborationResponseCollaborationReportsAggregateArgs = {
  filter_input?: InputMaybe<CollaborationReportFilterInput>;
};

export type CollaborationResponseAggExp = {
  __typename?: 'CollaborationResponseAggExp';
  _count: Scalars['Int']['output'];
  collaborationPostId: StringAggExp;
  contactInfo: StringAggExp;
  createdAt: TimestampAggExp;
  id: StringAggExp;
  isHidden: Int8AggExp;
  isPublic: Int8AggExp;
  isRead: Int8AggExp;
  message: StringAggExp;
  profileId: StringAggExp;
  readAt: TimestampAggExp;
};

export type CollaborationResponseBoolExp = {
  _and?: InputMaybe<Array<CollaborationResponseBoolExp>>;
  _not?: InputMaybe<CollaborationResponseBoolExp>;
  _or?: InputMaybe<Array<CollaborationResponseBoolExp>>;
  collaborationPost?: InputMaybe<CollaborationPostBoolExp>;
  collaborationPostId?: InputMaybe<StringBoolExp>;
  collaborationProfile?: InputMaybe<CollaborationProfileBoolExp>;
  collaborationReports?: InputMaybe<CollaborationReportBoolExp>;
  contactInfo?: InputMaybe<StringBoolExp>;
  createdAt?: InputMaybe<TimestampBoolExp>;
  id?: InputMaybe<StringBoolExp>;
  isHidden?: InputMaybe<Int8BoolExp>;
  isPublic?: InputMaybe<Int8BoolExp>;
  isRead?: InputMaybe<Int8BoolExp>;
  message?: InputMaybe<StringBoolExp>;
  profileId?: InputMaybe<StringBoolExp>;
  readAt?: InputMaybe<TimestampBoolExp>;
};

export type CollaborationResponseFilterInput = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationResponseOrderByExp>>;
  where?: InputMaybe<CollaborationResponseBoolExp>;
};

export type CollaborationResponseOrderByExp = {
  collaborationPost?: InputMaybe<CollaborationPostOrderByExp>;
  collaborationPostId?: InputMaybe<OrderBy>;
  collaborationProfile?: InputMaybe<CollaborationProfileOrderByExp>;
  contactInfo?: InputMaybe<OrderBy>;
  createdAt?: InputMaybe<OrderBy>;
  id?: InputMaybe<OrderBy>;
  isHidden?: InputMaybe<OrderBy>;
  isPublic?: InputMaybe<OrderBy>;
  isRead?: InputMaybe<OrderBy>;
  message?: InputMaybe<OrderBy>;
  profileId?: InputMaybe<OrderBy>;
  readAt?: InputMaybe<OrderBy>;
};

export type CollaborationRule = {
  __typename?: 'CollaborationRule';
  collaborationBlockedUsers?: Maybe<Array<CollaborationBlockedUser>>;
  collaborationBlockedUsersAggregate: CollaborationBlockedUserAggExp;
  collaborationReports?: Maybe<Array<CollaborationReport>>;
  collaborationReportsAggregate: CollaborationReportAggExp;
  createdAt: Scalars['Timestamp']['output'];
  description: Scalars['String1']['output'];
  guildId: Scalars['Int64']['output'];
  id: Scalars['String1']['output'];
  isActive: Scalars['Int8']['output'];
  ruleNumber: Scalars['Int32']['output'];
  title: Scalars['String1']['output'];
  updatedAt: Scalars['Timestamp']['output'];
};

export type CollaborationRuleCollaborationBlockedUsersArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationBlockedUserOrderByExp>>;
  where?: InputMaybe<CollaborationBlockedUserBoolExp>;
};

export type CollaborationRuleCollaborationBlockedUsersAggregateArgs = {
  filter_input?: InputMaybe<CollaborationBlockedUserFilterInput>;
};

export type CollaborationRuleCollaborationReportsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationReportOrderByExp>>;
  where?: InputMaybe<CollaborationReportBoolExp>;
};

export type CollaborationRuleCollaborationReportsAggregateArgs = {
  filter_input?: InputMaybe<CollaborationReportFilterInput>;
};

export type CollaborationRuleAggExp = {
  __typename?: 'CollaborationRuleAggExp';
  _count: Scalars['Int']['output'];
  createdAt: TimestampAggExp;
  description: StringAggExp;
  guildId: Int64AggExp;
  id: StringAggExp;
  isActive: Int8AggExp;
  ruleNumber: Int32AggExp;
  title: StringAggExp;
  updatedAt: TimestampAggExp;
};

export type CollaborationRuleBoolExp = {
  _and?: InputMaybe<Array<CollaborationRuleBoolExp>>;
  _not?: InputMaybe<CollaborationRuleBoolExp>;
  _or?: InputMaybe<Array<CollaborationRuleBoolExp>>;
  collaborationBlockedUsers?: InputMaybe<CollaborationBlockedUserBoolExp>;
  collaborationReports?: InputMaybe<CollaborationReportBoolExp>;
  createdAt?: InputMaybe<TimestampBoolExp>;
  description?: InputMaybe<StringBoolExp>;
  guildId?: InputMaybe<Int64BoolExp>;
  id?: InputMaybe<StringBoolExp>;
  isActive?: InputMaybe<Int8BoolExp>;
  ruleNumber?: InputMaybe<Int32BoolExp>;
  title?: InputMaybe<StringBoolExp>;
  updatedAt?: InputMaybe<TimestampBoolExp>;
};

export type CollaborationRuleFilterInput = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationRuleOrderByExp>>;
  where?: InputMaybe<CollaborationRuleBoolExp>;
};

export type CollaborationRuleOrderByExp = {
  createdAt?: InputMaybe<OrderBy>;
  description?: InputMaybe<OrderBy>;
  guildId?: InputMaybe<OrderBy>;
  id?: InputMaybe<OrderBy>;
  isActive?: InputMaybe<OrderBy>;
  ruleNumber?: InputMaybe<OrderBy>;
  title?: InputMaybe<OrderBy>;
  updatedAt?: InputMaybe<OrderBy>;
};

export type CollaborationStatus = {
  __typename?: 'CollaborationStatus';
  collaborationPosts?: Maybe<Array<CollaborationPost>>;
  collaborationPostsAggregate: CollaborationPostAggExp;
  description?: Maybe<Scalars['String1']['output']>;
  id: Scalars['Int32']['output'];
  name: Scalars['String1']['output'];
};

export type CollaborationStatusCollaborationPostsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationPostOrderByExp>>;
  where?: InputMaybe<CollaborationPostBoolExp>;
};

export type CollaborationStatusCollaborationPostsAggregateArgs = {
  filter_input?: InputMaybe<CollaborationPostFilterInput>;
};

export type CollaborationStatusAggExp = {
  __typename?: 'CollaborationStatusAggExp';
  _count: Scalars['Int']['output'];
  description: StringAggExp;
  id: Int32AggExp;
  name: StringAggExp;
};

export type CollaborationStatusBoolExp = {
  _and?: InputMaybe<Array<CollaborationStatusBoolExp>>;
  _not?: InputMaybe<CollaborationStatusBoolExp>;
  _or?: InputMaybe<Array<CollaborationStatusBoolExp>>;
  collaborationPosts?: InputMaybe<CollaborationPostBoolExp>;
  description?: InputMaybe<StringBoolExp>;
  id?: InputMaybe<Int32BoolExp>;
  name?: InputMaybe<StringBoolExp>;
};

export type CollaborationStatusFilterInput = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationStatusOrderByExp>>;
  where?: InputMaybe<CollaborationStatusBoolExp>;
};

export type CollaborationStatusOrderByExp = {
  description?: InputMaybe<OrderBy>;
  id?: InputMaybe<OrderBy>;
  name?: InputMaybe<OrderBy>;
};

export type CollaborationType = {
  __typename?: 'CollaborationType';
  collaborationAlerts?: Maybe<Array<CollaborationAlert>>;
  collaborationAlertsAggregate: CollaborationAlertAggExp;
  collaborationFieldDefinitions?: Maybe<Array<CollaborationFieldDefinition>>;
  collaborationFieldDefinitionsAggregate: CollaborationFieldDefinitionAggExp;
  collaborationPosts?: Maybe<Array<CollaborationPost>>;
  collaborationPostsAggregate: CollaborationPostAggExp;
  description?: Maybe<Scalars['String1']['output']>;
  id: Scalars['Int32']['output'];
  name: Scalars['String1']['output'];
};

export type CollaborationTypeCollaborationAlertsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationAlertOrderByExp>>;
  where?: InputMaybe<CollaborationAlertBoolExp>;
};

export type CollaborationTypeCollaborationAlertsAggregateArgs = {
  filter_input?: InputMaybe<CollaborationAlertFilterInput>;
};

export type CollaborationTypeCollaborationFieldDefinitionsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationFieldDefinitionOrderByExp>>;
  where?: InputMaybe<CollaborationFieldDefinitionBoolExp>;
};

export type CollaborationTypeCollaborationFieldDefinitionsAggregateArgs = {
  filter_input?: InputMaybe<CollaborationFieldDefinitionFilterInput>;
};

export type CollaborationTypeCollaborationPostsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationPostOrderByExp>>;
  where?: InputMaybe<CollaborationPostBoolExp>;
};

export type CollaborationTypeCollaborationPostsAggregateArgs = {
  filter_input?: InputMaybe<CollaborationPostFilterInput>;
};

export type CollaborationTypeAggExp = {
  __typename?: 'CollaborationTypeAggExp';
  _count: Scalars['Int']['output'];
  description: StringAggExp;
  id: Int32AggExp;
  name: StringAggExp;
};

export type CollaborationTypeBoolExp = {
  _and?: InputMaybe<Array<CollaborationTypeBoolExp>>;
  _not?: InputMaybe<CollaborationTypeBoolExp>;
  _or?: InputMaybe<Array<CollaborationTypeBoolExp>>;
  collaborationAlerts?: InputMaybe<CollaborationAlertBoolExp>;
  collaborationFieldDefinitions?: InputMaybe<CollaborationFieldDefinitionBoolExp>;
  collaborationPosts?: InputMaybe<CollaborationPostBoolExp>;
  description?: InputMaybe<StringBoolExp>;
  id?: InputMaybe<Int32BoolExp>;
  name?: InputMaybe<StringBoolExp>;
};

export type CollaborationTypeFilterInput = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationTypeOrderByExp>>;
  where?: InputMaybe<CollaborationTypeBoolExp>;
};

export type CollaborationTypeOrderByExp = {
  description?: InputMaybe<OrderBy>;
  id?: InputMaybe<OrderBy>;
  name?: InputMaybe<OrderBy>;
};

export type DeletedMessage = {
  __typename?: 'DeletedMessage';
  addedByBot: Scalars['String1']['output'];
  attachments: Scalars['Bytes']['output'];
  authorId: Scalars['Int64']['output'];
  channelId: Scalars['Int64']['output'];
  content?: Maybe<Scalars['String1']['output']>;
  creationTimestamp: Scalars['Timestamp']['output'];
  deletionTimestamp: Scalars['Timestamp']['output'];
  guildId: Scalars['Int64']['output'];
  messageId: Scalars['Int64']['output'];
  staffMemberId: Scalars['Int64']['output'];
};

export type DeletedMessageAggExp = {
  __typename?: 'DeletedMessageAggExp';
  _count: Scalars['Int']['output'];
  addedByBot: StringAggExp1;
  attachments: BytesAggExp;
  authorId: Int64AggExp1;
  channelId: Int64AggExp1;
  content: StringAggExp1;
  creationTimestamp: TimestampAggExp1;
  deletionTimestamp: TimestampAggExp1;
  guildId: Int64AggExp1;
  messageId: Int64AggExp1;
  staffMemberId: Int64AggExp1;
};

export type DeletedMessageBoolExp = {
  _and?: InputMaybe<Array<DeletedMessageBoolExp>>;
  _not?: InputMaybe<DeletedMessageBoolExp>;
  _or?: InputMaybe<Array<DeletedMessageBoolExp>>;
  addedByBot?: InputMaybe<StringBoolExp1>;
  attachments?: InputMaybe<BytesBoolExp>;
  authorId?: InputMaybe<Int64BoolExp1>;
  channelId?: InputMaybe<Int64BoolExp1>;
  content?: InputMaybe<StringBoolExp1>;
  creationTimestamp?: InputMaybe<TimestampBoolExp1>;
  deletionTimestamp?: InputMaybe<TimestampBoolExp1>;
  guildId?: InputMaybe<Int64BoolExp1>;
  messageId?: InputMaybe<Int64BoolExp1>;
  staffMemberId?: InputMaybe<Int64BoolExp1>;
};

export type DeletedMessageFilterInput = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<DeletedMessageOrderByExp>>;
  where?: InputMaybe<DeletedMessageBoolExp>;
};

export type DeletedMessageOrderByExp = {
  addedByBot?: InputMaybe<OrderBy>;
  attachments?: InputMaybe<OrderBy>;
  authorId?: InputMaybe<OrderBy>;
  channelId?: InputMaybe<OrderBy>;
  content?: InputMaybe<OrderBy>;
  creationTimestamp?: InputMaybe<OrderBy>;
  deletionTimestamp?: InputMaybe<OrderBy>;
  guildId?: InputMaybe<OrderBy>;
  messageId?: InputMaybe<OrderBy>;
  staffMemberId?: InputMaybe<OrderBy>;
};

export type HiringStatus = {
  __typename?: 'HiringStatus';
  collaborationAlerts?: Maybe<Array<CollaborationAlert>>;
  collaborationAlertsAggregate: CollaborationAlertAggExp;
  collaborationFieldDefinitions?: Maybe<Array<CollaborationFieldDefinition>>;
  collaborationFieldDefinitionsAggregate: CollaborationFieldDefinitionAggExp;
  collaborationPosts?: Maybe<Array<CollaborationPost>>;
  collaborationPostsAggregate: CollaborationPostAggExp;
  description?: Maybe<Scalars['String1']['output']>;
  id: Scalars['Int32']['output'];
  name: Scalars['String1']['output'];
};

export type HiringStatusCollaborationAlertsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationAlertOrderByExp>>;
  where?: InputMaybe<CollaborationAlertBoolExp>;
};

export type HiringStatusCollaborationAlertsAggregateArgs = {
  filter_input?: InputMaybe<CollaborationAlertFilterInput>;
};

export type HiringStatusCollaborationFieldDefinitionsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationFieldDefinitionOrderByExp>>;
  where?: InputMaybe<CollaborationFieldDefinitionBoolExp>;
};

export type HiringStatusCollaborationFieldDefinitionsAggregateArgs = {
  filter_input?: InputMaybe<CollaborationFieldDefinitionFilterInput>;
};

export type HiringStatusCollaborationPostsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationPostOrderByExp>>;
  where?: InputMaybe<CollaborationPostBoolExp>;
};

export type HiringStatusCollaborationPostsAggregateArgs = {
  filter_input?: InputMaybe<CollaborationPostFilterInput>;
};

export type HiringStatusAggExp = {
  __typename?: 'HiringStatusAggExp';
  _count: Scalars['Int']['output'];
  description: StringAggExp;
  id: Int32AggExp;
  name: StringAggExp;
};

export type HiringStatusBoolExp = {
  _and?: InputMaybe<Array<HiringStatusBoolExp>>;
  _not?: InputMaybe<HiringStatusBoolExp>;
  _or?: InputMaybe<Array<HiringStatusBoolExp>>;
  collaborationAlerts?: InputMaybe<CollaborationAlertBoolExp>;
  collaborationFieldDefinitions?: InputMaybe<CollaborationFieldDefinitionBoolExp>;
  collaborationPosts?: InputMaybe<CollaborationPostBoolExp>;
  description?: InputMaybe<StringBoolExp>;
  id?: InputMaybe<Int32BoolExp>;
  name?: InputMaybe<StringBoolExp>;
};

export type HiringStatusFilterInput = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<HiringStatusOrderByExp>>;
  where?: InputMaybe<HiringStatusBoolExp>;
};

export type HiringStatusOrderByExp = {
  description?: InputMaybe<OrderBy>;
  id?: InputMaybe<OrderBy>;
  name?: InputMaybe<OrderBy>;
};

export type Infraction = {
  __typename?: 'Infraction';
  additionalInformation?: Maybe<Scalars['String1']['output']>;
  guildId: Scalars['Int64']['output'];
  id: Scalars['Int64']['output'];
  issuedAt: Scalars['Timestamp']['output'];
  reason?: Maybe<Scalars['String1']['output']>;
  ruleId?: Maybe<Scalars['Int32']['output']>;
  ruleText?: Maybe<Scalars['String1']['output']>;
  staffMemberId: Scalars['Int64']['output'];
  type: Scalars['Int32']['output'];
  userId: Scalars['Int64']['output'];
};

export type InfractionAggExp = {
  __typename?: 'InfractionAggExp';
  _count: Scalars['Int']['output'];
  additionalInformation: StringAggExp1;
  guildId: Int64AggExp1;
  id: Int64AggExp1;
  issuedAt: TimestampAggExp1;
  reason: StringAggExp1;
  ruleId: Int32AggExp1;
  ruleText: StringAggExp1;
  staffMemberId: Int64AggExp1;
  type: Int32AggExp1;
  userId: Int64AggExp1;
};

export type InfractionBoolExp = {
  _and?: InputMaybe<Array<InfractionBoolExp>>;
  _not?: InputMaybe<InfractionBoolExp>;
  _or?: InputMaybe<Array<InfractionBoolExp>>;
  additionalInformation?: InputMaybe<StringBoolExp1>;
  guildId?: InputMaybe<Int64BoolExp1>;
  id?: InputMaybe<Int64BoolExp1>;
  issuedAt?: InputMaybe<TimestampBoolExp1>;
  reason?: InputMaybe<StringBoolExp1>;
  ruleId?: InputMaybe<Int32BoolExp1>;
  ruleText?: InputMaybe<StringBoolExp1>;
  staffMemberId?: InputMaybe<Int64BoolExp1>;
  type?: InputMaybe<Int32BoolExp1>;
  userId?: InputMaybe<Int64BoolExp1>;
};

export type InfractionFilterInput = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<InfractionOrderByExp>>;
  where?: InputMaybe<InfractionBoolExp>;
};

export type InfractionOrderByExp = {
  additionalInformation?: InputMaybe<OrderBy>;
  guildId?: InputMaybe<OrderBy>;
  id?: InputMaybe<OrderBy>;
  issuedAt?: InputMaybe<OrderBy>;
  reason?: InputMaybe<OrderBy>;
  ruleId?: InputMaybe<OrderBy>;
  ruleText?: InputMaybe<OrderBy>;
  staffMemberId?: InputMaybe<OrderBy>;
  type?: InputMaybe<OrderBy>;
  userId?: InputMaybe<OrderBy>;
};

export type Int8AggExp = {
  __typename?: 'Int8AggExp';
  _count: Scalars['Int']['output'];
  _count_distinct: Scalars['Int']['output'];
  avg: Scalars['Float64']['output'];
  max: Scalars['Int8']['output'];
  min: Scalars['Int8']['output'];
  sum: Scalars['Int64']['output'];
};

export type Int8AggExp1 = {
  __typename?: 'Int8AggExp1';
  _count: Scalars['Int']['output'];
  _count_distinct: Scalars['Int']['output'];
  avg: Scalars['Float64']['output'];
  max: Scalars['Int8']['output'];
  min: Scalars['Int8']['output'];
  sum: Scalars['Int64']['output'];
};

export type Int8BoolExp = {
  _and?: InputMaybe<Array<Int8BoolExp>>;
  _eq?: InputMaybe<Scalars['Int8']['input']>;
  _gt?: InputMaybe<Scalars['Int8']['input']>;
  _gte?: InputMaybe<Scalars['Int8']['input']>;
  _in?: InputMaybe<Array<Scalars['Int8']['input']>>;
  _is_null?: InputMaybe<Scalars['Boolean']['input']>;
  _lt?: InputMaybe<Scalars['Int8']['input']>;
  _lte?: InputMaybe<Scalars['Int8']['input']>;
  _not?: InputMaybe<Int8BoolExp>;
  _or?: InputMaybe<Array<Int8BoolExp>>;
};

export type Int8BoolExp1 = {
  _and?: InputMaybe<Array<Int8BoolExp1>>;
  _eq?: InputMaybe<Scalars['Int8']['input']>;
  _gt?: InputMaybe<Scalars['Int8']['input']>;
  _gte?: InputMaybe<Scalars['Int8']['input']>;
  _in?: InputMaybe<Array<Scalars['Int8']['input']>>;
  _is_null?: InputMaybe<Scalars['Boolean']['input']>;
  _lt?: InputMaybe<Scalars['Int8']['input']>;
  _lte?: InputMaybe<Scalars['Int8']['input']>;
  _not?: InputMaybe<Int8BoolExp1>;
  _or?: InputMaybe<Array<Int8BoolExp1>>;
};

export type Int32AggExp = {
  __typename?: 'Int32AggExp';
  _count: Scalars['Int']['output'];
  _count_distinct: Scalars['Int']['output'];
  avg: Scalars['Float64']['output'];
  max: Scalars['Int32']['output'];
  min: Scalars['Int32']['output'];
  sum: Scalars['Int64']['output'];
};

export type Int32AggExp1 = {
  __typename?: 'Int32AggExp1';
  _count: Scalars['Int']['output'];
  _count_distinct: Scalars['Int']['output'];
  avg: Scalars['Float64']['output'];
  max: Scalars['Int32']['output'];
  min: Scalars['Int32']['output'];
  sum: Scalars['Int64']['output'];
};

export type Int32BoolExp = {
  _and?: InputMaybe<Array<Int32BoolExp>>;
  _eq?: InputMaybe<Scalars['Int32']['input']>;
  _gt?: InputMaybe<Scalars['Int32']['input']>;
  _gte?: InputMaybe<Scalars['Int32']['input']>;
  _in?: InputMaybe<Array<Scalars['Int32']['input']>>;
  _is_null?: InputMaybe<Scalars['Boolean']['input']>;
  _lt?: InputMaybe<Scalars['Int32']['input']>;
  _lte?: InputMaybe<Scalars['Int32']['input']>;
  _not?: InputMaybe<Int32BoolExp>;
  _or?: InputMaybe<Array<Int32BoolExp>>;
};

export type Int32BoolExp1 = {
  _and?: InputMaybe<Array<Int32BoolExp1>>;
  _eq?: InputMaybe<Scalars['Int32']['input']>;
  _gt?: InputMaybe<Scalars['Int32']['input']>;
  _gte?: InputMaybe<Scalars['Int32']['input']>;
  _in?: InputMaybe<Array<Scalars['Int32']['input']>>;
  _is_null?: InputMaybe<Scalars['Boolean']['input']>;
  _lt?: InputMaybe<Scalars['Int32']['input']>;
  _lte?: InputMaybe<Scalars['Int32']['input']>;
  _not?: InputMaybe<Int32BoolExp1>;
  _or?: InputMaybe<Array<Int32BoolExp1>>;
};

export type Int64AggExp = {
  __typename?: 'Int64AggExp';
  _count: Scalars['Int']['output'];
  _count_distinct: Scalars['Int']['output'];
  avg: Scalars['Float64']['output'];
  max: Scalars['Int64']['output'];
  min: Scalars['Int64']['output'];
  sum: Scalars['Int64']['output'];
};

export type Int64AggExp1 = {
  __typename?: 'Int64AggExp1';
  _count: Scalars['Int']['output'];
  _count_distinct: Scalars['Int']['output'];
  avg: Scalars['Float64']['output'];
  max: Scalars['Int64']['output'];
  min: Scalars['Int64']['output'];
  sum: Scalars['Int64']['output'];
};

export type Int64BoolExp = {
  _and?: InputMaybe<Array<Int64BoolExp>>;
  _eq?: InputMaybe<Scalars['Int64']['input']>;
  _gt?: InputMaybe<Scalars['Int64']['input']>;
  _gte?: InputMaybe<Scalars['Int64']['input']>;
  _in?: InputMaybe<Array<Scalars['Int64']['input']>>;
  _is_null?: InputMaybe<Scalars['Boolean']['input']>;
  _lt?: InputMaybe<Scalars['Int64']['input']>;
  _lte?: InputMaybe<Scalars['Int64']['input']>;
  _not?: InputMaybe<Int64BoolExp>;
  _or?: InputMaybe<Array<Int64BoolExp>>;
};

export type Int64BoolExp1 = {
  _and?: InputMaybe<Array<Int64BoolExp1>>;
  _eq?: InputMaybe<Scalars['Int64']['input']>;
  _gt?: InputMaybe<Scalars['Int64']['input']>;
  _gte?: InputMaybe<Scalars['Int64']['input']>;
  _in?: InputMaybe<Array<Scalars['Int64']['input']>>;
  _is_null?: InputMaybe<Scalars['Boolean']['input']>;
  _lt?: InputMaybe<Scalars['Int64']['input']>;
  _lte?: InputMaybe<Scalars['Int64']['input']>;
  _not?: InputMaybe<Int64BoolExp1>;
  _or?: InputMaybe<Array<Int64BoolExp1>>;
};

export type MemberNote = {
  __typename?: 'MemberNote';
  authorId: Scalars['Int64']['output'];
  content: Scalars['String1']['output'];
  creationTimestamp: Scalars['Timestamp']['output'];
  guildId: Scalars['Int64']['output'];
  id: Scalars['Int64']['output'];
  type: Scalars['Int32']['output'];
  userId: Scalars['Int64']['output'];
};

export type MemberNoteAggExp = {
  __typename?: 'MemberNoteAggExp';
  _count: Scalars['Int']['output'];
  authorId: Int64AggExp1;
  content: StringAggExp1;
  creationTimestamp: TimestampAggExp1;
  guildId: Int64AggExp1;
  id: Int64AggExp1;
  type: Int32AggExp1;
  userId: Int64AggExp1;
};

export type MemberNoteBoolExp = {
  _and?: InputMaybe<Array<MemberNoteBoolExp>>;
  _not?: InputMaybe<MemberNoteBoolExp>;
  _or?: InputMaybe<Array<MemberNoteBoolExp>>;
  authorId?: InputMaybe<Int64BoolExp1>;
  content?: InputMaybe<StringBoolExp1>;
  creationTimestamp?: InputMaybe<TimestampBoolExp1>;
  guildId?: InputMaybe<Int64BoolExp1>;
  id?: InputMaybe<Int64BoolExp1>;
  type?: InputMaybe<Int32BoolExp1>;
  userId?: InputMaybe<Int64BoolExp1>;
};

export type MemberNoteFilterInput = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<MemberNoteOrderByExp>>;
  where?: InputMaybe<MemberNoteBoolExp>;
};

export type MemberNoteOrderByExp = {
  authorId?: InputMaybe<OrderBy>;
  content?: InputMaybe<OrderBy>;
  creationTimestamp?: InputMaybe<OrderBy>;
  guildId?: InputMaybe<OrderBy>;
  id?: InputMaybe<OrderBy>;
  type?: InputMaybe<OrderBy>;
  userId?: InputMaybe<OrderBy>;
};

export type Mutation = {
  __typename?: 'Mutation';
  _no_fields_accessible?: Maybe<Scalars['String']['output']>;
};

export type Mute = {
  __typename?: 'Mute';
  expiresAt?: Maybe<Scalars['Timestamp']['output']>;
  guildId: Scalars['Int64']['output'];
  userId: Scalars['Int64']['output'];
};

export type MuteAggExp = {
  __typename?: 'MuteAggExp';
  _count: Scalars['Int']['output'];
  expiresAt: TimestampAggExp1;
  guildId: Int64AggExp1;
  userId: Int64AggExp1;
};

export type MuteBoolExp = {
  _and?: InputMaybe<Array<MuteBoolExp>>;
  _not?: InputMaybe<MuteBoolExp>;
  _or?: InputMaybe<Array<MuteBoolExp>>;
  expiresAt?: InputMaybe<TimestampBoolExp1>;
  guildId?: InputMaybe<Int64BoolExp1>;
  userId?: InputMaybe<Int64BoolExp1>;
};

export type MuteFilterInput = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<MuteOrderByExp>>;
  where?: InputMaybe<MuteBoolExp>;
};

export type MuteOrderByExp = {
  expiresAt?: InputMaybe<OrderBy>;
  guildId?: InputMaybe<OrderBy>;
  userId?: InputMaybe<OrderBy>;
};

export enum OrderBy {
  /** Sorts the data in ascending order */
  Asc = 'Asc',
  /** Sorts the data in descending order */
  Desc = 'Desc',
}

export type Query = {
  __typename?: 'Query';
  altAccount?: Maybe<Array<AltAccount>>;
  altAccountAggregate?: Maybe<AltAccountAggExp>;
  altAccountByAltAccountPk?: Maybe<AltAccount>;
  blockedReporter?: Maybe<Array<BlockedReporter>>;
  blockedReporterAggregate?: Maybe<BlockedReporterAggExp>;
  blockedReporterByBlockedReporterPk?: Maybe<BlockedReporter>;
  collaborationAlert?: Maybe<Array<CollaborationAlert>>;
  collaborationAlertAggregate?: Maybe<CollaborationAlertAggExp>;
  collaborationAlertById?: Maybe<CollaborationAlert>;
  collaborationAuditLog?: Maybe<Array<CollaborationAuditLog>>;
  collaborationAuditLogAggregate?: Maybe<CollaborationAuditLogAggExp>;
  collaborationAuditLogById?: Maybe<CollaborationAuditLog>;
  collaborationBlockedUser?: Maybe<Array<CollaborationBlockedUser>>;
  collaborationBlockedUserAggregate?: Maybe<CollaborationBlockedUserAggExp>;
  collaborationBlockedUserById?: Maybe<CollaborationBlockedUser>;
  collaborationBookmark?: Maybe<Array<CollaborationBookmark>>;
  collaborationBookmarkAggregate?: Maybe<CollaborationBookmarkAggExp>;
  collaborationBookmarkById?: Maybe<CollaborationBookmark>;
  collaborationFieldDefinition?: Maybe<Array<CollaborationFieldDefinition>>;
  collaborationFieldDefinitionAggregate?: Maybe<CollaborationFieldDefinitionAggExp>;
  collaborationFieldDefinitionById?: Maybe<CollaborationFieldDefinition>;
  collaborationFieldValue?: Maybe<Array<CollaborationFieldValue>>;
  collaborationFieldValueAggregate?: Maybe<CollaborationFieldValueAggExp>;
  collaborationFieldValueById?: Maybe<CollaborationFieldValue>;
  collaborationPost?: Maybe<Array<CollaborationPost>>;
  collaborationPostAggregate?: Maybe<CollaborationPostAggExp>;
  collaborationPostById?: Maybe<CollaborationPost>;
  collaborationProfile?: Maybe<Array<CollaborationProfile>>;
  collaborationProfileAggregate?: Maybe<CollaborationProfileAggExp>;
  collaborationProfileById?: Maybe<CollaborationProfile>;
  collaborationReport?: Maybe<Array<CollaborationReport>>;
  collaborationReportAggregate?: Maybe<CollaborationReportAggExp>;
  collaborationReportById?: Maybe<CollaborationReport>;
  collaborationResponse?: Maybe<Array<CollaborationResponse>>;
  collaborationResponseAggregate?: Maybe<CollaborationResponseAggExp>;
  collaborationResponseById?: Maybe<CollaborationResponse>;
  collaborationRule?: Maybe<Array<CollaborationRule>>;
  collaborationRuleAggregate?: Maybe<CollaborationRuleAggExp>;
  collaborationRuleById?: Maybe<CollaborationRule>;
  collaborationStatus?: Maybe<Array<CollaborationStatus>>;
  collaborationStatusAggregate?: Maybe<CollaborationStatusAggExp>;
  collaborationStatusById?: Maybe<CollaborationStatus>;
  collaborationType?: Maybe<Array<CollaborationType>>;
  collaborationTypeAggregate?: Maybe<CollaborationTypeAggExp>;
  collaborationTypeById?: Maybe<CollaborationType>;
  deletedMessage?: Maybe<Array<DeletedMessage>>;
  deletedMessageAggregate?: Maybe<DeletedMessageAggExp>;
  deletedMessageByMessageId?: Maybe<DeletedMessage>;
  hiringStatus?: Maybe<Array<HiringStatus>>;
  hiringStatusAggregate?: Maybe<HiringStatusAggExp>;
  hiringStatusById?: Maybe<HiringStatus>;
  infraction?: Maybe<Array<Infraction>>;
  infractionAggregate?: Maybe<InfractionAggExp>;
  infractionById?: Maybe<Infraction>;
  memberNote?: Maybe<Array<MemberNote>>;
  memberNoteAggregate?: Maybe<MemberNoteAggExp>;
  memberNoteById?: Maybe<MemberNote>;
  mute?: Maybe<Array<Mute>>;
  muteAggregate?: Maybe<MuteAggExp>;
  muteByMutePk?: Maybe<Mute>;
  reportedMessage?: Maybe<Array<ReportedMessage>>;
  reportedMessageAggregate?: Maybe<ReportedMessageAggExp>;
  reportedMessageById?: Maybe<ReportedMessage>;
  rule?: Maybe<Array<Rule>>;
  ruleAggregate?: Maybe<RuleAggExp>;
  ruleByRulePk?: Maybe<Rule>;
  staffMessage?: Maybe<Array<StaffMessage>>;
  staffMessageAggregate?: Maybe<StaffMessageAggExp>;
  staffMessageById?: Maybe<StaffMessage>;
  temporaryBan?: Maybe<Array<TemporaryBan>>;
  temporaryBanAggregate?: Maybe<TemporaryBanAggExp>;
  temporaryBanByTemporaryBanPk?: Maybe<TemporaryBan>;
  trackedMessages?: Maybe<Array<TrackedMessages>>;
  trackedMessagesAggregate?: Maybe<TrackedMessagesAggExp>;
  trackedMessagesById?: Maybe<TrackedMessages>;
};

export type QueryAltAccountArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<AltAccountOrderByExp>>;
  where?: InputMaybe<AltAccountBoolExp>;
};

export type QueryAltAccountAggregateArgs = {
  filter_input?: InputMaybe<AltAccountFilterInput>;
};

export type QueryAltAccountByAltAccountPkArgs = {
  altId: Scalars['Int64']['input'];
  userId: Scalars['Int64']['input'];
};

export type QueryBlockedReporterArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<BlockedReporterOrderByExp>>;
  where?: InputMaybe<BlockedReporterBoolExp>;
};

export type QueryBlockedReporterAggregateArgs = {
  filter_input?: InputMaybe<BlockedReporterFilterInput>;
};

export type QueryBlockedReporterByBlockedReporterPkArgs = {
  guildId: Scalars['Int64']['input'];
  userId: Scalars['Int64']['input'];
};

export type QueryCollaborationAlertArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationAlertOrderByExp>>;
  where?: InputMaybe<CollaborationAlertBoolExp>;
};

export type QueryCollaborationAlertAggregateArgs = {
  filter_input?: InputMaybe<CollaborationAlertFilterInput>;
};

export type QueryCollaborationAlertByIdArgs = {
  id: Scalars['String1']['input'];
};

export type QueryCollaborationAuditLogArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationAuditLogOrderByExp>>;
  where?: InputMaybe<CollaborationAuditLogBoolExp>;
};

export type QueryCollaborationAuditLogAggregateArgs = {
  filter_input?: InputMaybe<CollaborationAuditLogFilterInput>;
};

export type QueryCollaborationAuditLogByIdArgs = {
  id: Scalars['String1']['input'];
};

export type QueryCollaborationBlockedUserArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationBlockedUserOrderByExp>>;
  where?: InputMaybe<CollaborationBlockedUserBoolExp>;
};

export type QueryCollaborationBlockedUserAggregateArgs = {
  filter_input?: InputMaybe<CollaborationBlockedUserFilterInput>;
};

export type QueryCollaborationBlockedUserByIdArgs = {
  id: Scalars['String1']['input'];
};

export type QueryCollaborationBookmarkArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationBookmarkOrderByExp>>;
  where?: InputMaybe<CollaborationBookmarkBoolExp>;
};

export type QueryCollaborationBookmarkAggregateArgs = {
  filter_input?: InputMaybe<CollaborationBookmarkFilterInput>;
};

export type QueryCollaborationBookmarkByIdArgs = {
  id: Scalars['String1']['input'];
};

export type QueryCollaborationFieldDefinitionArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationFieldDefinitionOrderByExp>>;
  where?: InputMaybe<CollaborationFieldDefinitionBoolExp>;
};

export type QueryCollaborationFieldDefinitionAggregateArgs = {
  filter_input?: InputMaybe<CollaborationFieldDefinitionFilterInput>;
};

export type QueryCollaborationFieldDefinitionByIdArgs = {
  id: Scalars['String1']['input'];
};

export type QueryCollaborationFieldValueArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationFieldValueOrderByExp>>;
  where?: InputMaybe<CollaborationFieldValueBoolExp>;
};

export type QueryCollaborationFieldValueAggregateArgs = {
  filter_input?: InputMaybe<CollaborationFieldValueFilterInput>;
};

export type QueryCollaborationFieldValueByIdArgs = {
  id: Scalars['String1']['input'];
};

export type QueryCollaborationPostArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationPostOrderByExp>>;
  where?: InputMaybe<CollaborationPostBoolExp>;
};

export type QueryCollaborationPostAggregateArgs = {
  filter_input?: InputMaybe<CollaborationPostFilterInput>;
};

export type QueryCollaborationPostByIdArgs = {
  id: Scalars['String1']['input'];
};

export type QueryCollaborationProfileArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationProfileOrderByExp>>;
  where?: InputMaybe<CollaborationProfileBoolExp>;
};

export type QueryCollaborationProfileAggregateArgs = {
  filter_input?: InputMaybe<CollaborationProfileFilterInput>;
};

export type QueryCollaborationProfileByIdArgs = {
  id: Scalars['String1']['input'];
};

export type QueryCollaborationReportArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationReportOrderByExp>>;
  where?: InputMaybe<CollaborationReportBoolExp>;
};

export type QueryCollaborationReportAggregateArgs = {
  filter_input?: InputMaybe<CollaborationReportFilterInput>;
};

export type QueryCollaborationReportByIdArgs = {
  id: Scalars['String1']['input'];
};

export type QueryCollaborationResponseArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationResponseOrderByExp>>;
  where?: InputMaybe<CollaborationResponseBoolExp>;
};

export type QueryCollaborationResponseAggregateArgs = {
  filter_input?: InputMaybe<CollaborationResponseFilterInput>;
};

export type QueryCollaborationResponseByIdArgs = {
  id: Scalars['String1']['input'];
};

export type QueryCollaborationRuleArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationRuleOrderByExp>>;
  where?: InputMaybe<CollaborationRuleBoolExp>;
};

export type QueryCollaborationRuleAggregateArgs = {
  filter_input?: InputMaybe<CollaborationRuleFilterInput>;
};

export type QueryCollaborationRuleByIdArgs = {
  id: Scalars['String1']['input'];
};

export type QueryCollaborationStatusArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationStatusOrderByExp>>;
  where?: InputMaybe<CollaborationStatusBoolExp>;
};

export type QueryCollaborationStatusAggregateArgs = {
  filter_input?: InputMaybe<CollaborationStatusFilterInput>;
};

export type QueryCollaborationStatusByIdArgs = {
  id: Scalars['Int32']['input'];
};

export type QueryCollaborationTypeArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationTypeOrderByExp>>;
  where?: InputMaybe<CollaborationTypeBoolExp>;
};

export type QueryCollaborationTypeAggregateArgs = {
  filter_input?: InputMaybe<CollaborationTypeFilterInput>;
};

export type QueryCollaborationTypeByIdArgs = {
  id: Scalars['Int32']['input'];
};

export type QueryDeletedMessageArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<DeletedMessageOrderByExp>>;
  where?: InputMaybe<DeletedMessageBoolExp>;
};

export type QueryDeletedMessageAggregateArgs = {
  filter_input?: InputMaybe<DeletedMessageFilterInput>;
};

export type QueryDeletedMessageByMessageIdArgs = {
  messageId: Scalars['Int64']['input'];
};

export type QueryHiringStatusArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<HiringStatusOrderByExp>>;
  where?: InputMaybe<HiringStatusBoolExp>;
};

export type QueryHiringStatusAggregateArgs = {
  filter_input?: InputMaybe<HiringStatusFilterInput>;
};

export type QueryHiringStatusByIdArgs = {
  id: Scalars['Int32']['input'];
};

export type QueryInfractionArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<InfractionOrderByExp>>;
  where?: InputMaybe<InfractionBoolExp>;
};

export type QueryInfractionAggregateArgs = {
  filter_input?: InputMaybe<InfractionFilterInput>;
};

export type QueryInfractionByIdArgs = {
  id: Scalars['Int64']['input'];
};

export type QueryMemberNoteArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<MemberNoteOrderByExp>>;
  where?: InputMaybe<MemberNoteBoolExp>;
};

export type QueryMemberNoteAggregateArgs = {
  filter_input?: InputMaybe<MemberNoteFilterInput>;
};

export type QueryMemberNoteByIdArgs = {
  id: Scalars['Int64']['input'];
};

export type QueryMuteArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<MuteOrderByExp>>;
  where?: InputMaybe<MuteBoolExp>;
};

export type QueryMuteAggregateArgs = {
  filter_input?: InputMaybe<MuteFilterInput>;
};

export type QueryMuteByMutePkArgs = {
  guildId: Scalars['Int64']['input'];
  userId: Scalars['Int64']['input'];
};

export type QueryReportedMessageArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<ReportedMessageOrderByExp>>;
  where?: InputMaybe<ReportedMessageBoolExp>;
};

export type QueryReportedMessageAggregateArgs = {
  filter_input?: InputMaybe<ReportedMessageFilterInput>;
};

export type QueryReportedMessageByIdArgs = {
  id: Scalars['Int64']['input'];
};

export type QueryRuleArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<RuleOrderByExp>>;
  where?: InputMaybe<RuleBoolExp>;
};

export type QueryRuleAggregateArgs = {
  filter_input?: InputMaybe<RuleFilterInput>;
};

export type QueryRuleByRulePkArgs = {
  guildId: Scalars['Int64']['input'];
  id: Scalars['Int32']['input'];
};

export type QueryStaffMessageArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<StaffMessageOrderByExp>>;
  where?: InputMaybe<StaffMessageBoolExp>;
};

export type QueryStaffMessageAggregateArgs = {
  filter_input?: InputMaybe<StaffMessageFilterInput>;
};

export type QueryStaffMessageByIdArgs = {
  id: Scalars['Int64']['input'];
};

export type QueryTemporaryBanArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<TemporaryBanOrderByExp>>;
  where?: InputMaybe<TemporaryBanBoolExp>;
};

export type QueryTemporaryBanAggregateArgs = {
  filter_input?: InputMaybe<TemporaryBanFilterInput>;
};

export type QueryTemporaryBanByTemporaryBanPkArgs = {
  guildId: Scalars['Int64']['input'];
  userId: Scalars['Int64']['input'];
};

export type QueryTrackedMessagesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<TrackedMessagesOrderByExp>>;
  where?: InputMaybe<TrackedMessagesBoolExp>;
};

export type QueryTrackedMessagesAggregateArgs = {
  filter_input?: InputMaybe<TrackedMessagesFilterInput>;
};

export type QueryTrackedMessagesByIdArgs = {
  id: Scalars['Int64']['input'];
};

export type ReportedMessage = {
  __typename?: 'ReportedMessage';
  attachments: Scalars['Bytes']['output'];
  authorId: Scalars['Int64']['output'];
  channelId: Scalars['Int64']['output'];
  content?: Maybe<Scalars['String1']['output']>;
  guildId: Scalars['Int64']['output'];
  id: Scalars['Int64']['output'];
  messageId: Scalars['Int64']['output'];
  reporterId: Scalars['Int64']['output'];
};

export type ReportedMessageAggExp = {
  __typename?: 'ReportedMessageAggExp';
  _count: Scalars['Int']['output'];
  attachments: BytesAggExp;
  authorId: Int64AggExp1;
  channelId: Int64AggExp1;
  content: StringAggExp1;
  guildId: Int64AggExp1;
  id: Int64AggExp1;
  messageId: Int64AggExp1;
  reporterId: Int64AggExp1;
};

export type ReportedMessageBoolExp = {
  _and?: InputMaybe<Array<ReportedMessageBoolExp>>;
  _not?: InputMaybe<ReportedMessageBoolExp>;
  _or?: InputMaybe<Array<ReportedMessageBoolExp>>;
  attachments?: InputMaybe<BytesBoolExp>;
  authorId?: InputMaybe<Int64BoolExp1>;
  channelId?: InputMaybe<Int64BoolExp1>;
  content?: InputMaybe<StringBoolExp1>;
  guildId?: InputMaybe<Int64BoolExp1>;
  id?: InputMaybe<Int64BoolExp1>;
  messageId?: InputMaybe<Int64BoolExp1>;
  reporterId?: InputMaybe<Int64BoolExp1>;
};

export type ReportedMessageFilterInput = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<ReportedMessageOrderByExp>>;
  where?: InputMaybe<ReportedMessageBoolExp>;
};

export type ReportedMessageOrderByExp = {
  attachments?: InputMaybe<OrderBy>;
  authorId?: InputMaybe<OrderBy>;
  channelId?: InputMaybe<OrderBy>;
  content?: InputMaybe<OrderBy>;
  guildId?: InputMaybe<OrderBy>;
  id?: InputMaybe<OrderBy>;
  messageId?: InputMaybe<OrderBy>;
  reporterId?: InputMaybe<OrderBy>;
};

export type Rule = {
  __typename?: 'Rule';
  brief?: Maybe<Scalars['String1']['output']>;
  description: Scalars['String1']['output'];
  guildId: Scalars['Int64']['output'];
  id: Scalars['Int32']['output'];
};

export type RuleAggExp = {
  __typename?: 'RuleAggExp';
  _count: Scalars['Int']['output'];
  brief: StringAggExp1;
  description: StringAggExp1;
  guildId: Int64AggExp1;
  id: Int32AggExp1;
};

export type RuleBoolExp = {
  _and?: InputMaybe<Array<RuleBoolExp>>;
  _not?: InputMaybe<RuleBoolExp>;
  _or?: InputMaybe<Array<RuleBoolExp>>;
  brief?: InputMaybe<StringBoolExp1>;
  description?: InputMaybe<StringBoolExp1>;
  guildId?: InputMaybe<Int64BoolExp1>;
  id?: InputMaybe<Int32BoolExp1>;
};

export type RuleFilterInput = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<RuleOrderByExp>>;
  where?: InputMaybe<RuleBoolExp>;
};

export type RuleOrderByExp = {
  brief?: InputMaybe<OrderBy>;
  description?: InputMaybe<OrderBy>;
  guildId?: InputMaybe<OrderBy>;
  id?: InputMaybe<OrderBy>;
};

export type StaffMessage = {
  __typename?: 'StaffMessage';
  content: Scalars['String1']['output'];
  guildId: Scalars['Int64']['output'];
  id: Scalars['Int64']['output'];
  recipientId: Scalars['Int64']['output'];
  sentAt: Scalars['Timestamp']['output'];
  staffMemberId: Scalars['Int64']['output'];
};

export type StaffMessageAggExp = {
  __typename?: 'StaffMessageAggExp';
  _count: Scalars['Int']['output'];
  content: StringAggExp1;
  guildId: Int64AggExp1;
  id: Int64AggExp1;
  recipientId: Int64AggExp1;
  sentAt: TimestampAggExp1;
  staffMemberId: Int64AggExp1;
};

export type StaffMessageBoolExp = {
  _and?: InputMaybe<Array<StaffMessageBoolExp>>;
  _not?: InputMaybe<StaffMessageBoolExp>;
  _or?: InputMaybe<Array<StaffMessageBoolExp>>;
  content?: InputMaybe<StringBoolExp1>;
  guildId?: InputMaybe<Int64BoolExp1>;
  id?: InputMaybe<Int64BoolExp1>;
  recipientId?: InputMaybe<Int64BoolExp1>;
  sentAt?: InputMaybe<TimestampBoolExp1>;
  staffMemberId?: InputMaybe<Int64BoolExp1>;
};

export type StaffMessageFilterInput = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<StaffMessageOrderByExp>>;
  where?: InputMaybe<StaffMessageBoolExp>;
};

export type StaffMessageOrderByExp = {
  content?: InputMaybe<OrderBy>;
  guildId?: InputMaybe<OrderBy>;
  id?: InputMaybe<OrderBy>;
  recipientId?: InputMaybe<OrderBy>;
  sentAt?: InputMaybe<OrderBy>;
  staffMemberId?: InputMaybe<OrderBy>;
};

export type StringAggExp = {
  __typename?: 'StringAggExp';
  _count: Scalars['Int']['output'];
  _count_distinct: Scalars['Int']['output'];
  max: Scalars['String1']['output'];
  min: Scalars['String1']['output'];
};

export type StringAggExp1 = {
  __typename?: 'StringAggExp1';
  _count: Scalars['Int']['output'];
  _count_distinct: Scalars['Int']['output'];
  max: Scalars['String1']['output'];
  min: Scalars['String1']['output'];
};

export type StringBoolExp = {
  _and?: InputMaybe<Array<StringBoolExp>>;
  _contains?: InputMaybe<Scalars['String1']['input']>;
  _eq?: InputMaybe<Scalars['String1']['input']>;
  _in?: InputMaybe<Array<Scalars['String1']['input']>>;
  _is_null?: InputMaybe<Scalars['Boolean']['input']>;
  _like?: InputMaybe<Scalars['String1']['input']>;
  _not?: InputMaybe<StringBoolExp>;
  _or?: InputMaybe<Array<StringBoolExp>>;
};

export type StringBoolExp1 = {
  _and?: InputMaybe<Array<StringBoolExp1>>;
  _contains?: InputMaybe<Scalars['String1']['input']>;
  _eq?: InputMaybe<Scalars['String1']['input']>;
  _in?: InputMaybe<Array<Scalars['String1']['input']>>;
  _is_null?: InputMaybe<Scalars['Boolean']['input']>;
  _like?: InputMaybe<Scalars['String1']['input']>;
  _not?: InputMaybe<StringBoolExp1>;
  _or?: InputMaybe<Array<StringBoolExp1>>;
};

export type Subscription = {
  __typename?: 'Subscription';
  altAccount?: Maybe<Array<AltAccount>>;
  altAccountAggregate?: Maybe<AltAccountAggExp>;
  altAccountByAltAccountPk?: Maybe<AltAccount>;
  blockedReporter?: Maybe<Array<BlockedReporter>>;
  blockedReporterAggregate?: Maybe<BlockedReporterAggExp>;
  blockedReporterByBlockedReporterPk?: Maybe<BlockedReporter>;
  collaborationAlert?: Maybe<Array<CollaborationAlert>>;
  collaborationAlertAggregate?: Maybe<CollaborationAlertAggExp>;
  collaborationAlertById?: Maybe<CollaborationAlert>;
  collaborationAuditLog?: Maybe<Array<CollaborationAuditLog>>;
  collaborationAuditLogAggregate?: Maybe<CollaborationAuditLogAggExp>;
  collaborationAuditLogById?: Maybe<CollaborationAuditLog>;
  collaborationBlockedUser?: Maybe<Array<CollaborationBlockedUser>>;
  collaborationBlockedUserAggregate?: Maybe<CollaborationBlockedUserAggExp>;
  collaborationBlockedUserById?: Maybe<CollaborationBlockedUser>;
  collaborationBookmark?: Maybe<Array<CollaborationBookmark>>;
  collaborationBookmarkAggregate?: Maybe<CollaborationBookmarkAggExp>;
  collaborationBookmarkById?: Maybe<CollaborationBookmark>;
  collaborationFieldDefinition?: Maybe<Array<CollaborationFieldDefinition>>;
  collaborationFieldDefinitionAggregate?: Maybe<CollaborationFieldDefinitionAggExp>;
  collaborationFieldDefinitionById?: Maybe<CollaborationFieldDefinition>;
  collaborationFieldValue?: Maybe<Array<CollaborationFieldValue>>;
  collaborationFieldValueAggregate?: Maybe<CollaborationFieldValueAggExp>;
  collaborationFieldValueById?: Maybe<CollaborationFieldValue>;
  collaborationPost?: Maybe<Array<CollaborationPost>>;
  collaborationPostAggregate?: Maybe<CollaborationPostAggExp>;
  collaborationPostById?: Maybe<CollaborationPost>;
  collaborationProfile?: Maybe<Array<CollaborationProfile>>;
  collaborationProfileAggregate?: Maybe<CollaborationProfileAggExp>;
  collaborationProfileById?: Maybe<CollaborationProfile>;
  collaborationReport?: Maybe<Array<CollaborationReport>>;
  collaborationReportAggregate?: Maybe<CollaborationReportAggExp>;
  collaborationReportById?: Maybe<CollaborationReport>;
  collaborationResponse?: Maybe<Array<CollaborationResponse>>;
  collaborationResponseAggregate?: Maybe<CollaborationResponseAggExp>;
  collaborationResponseById?: Maybe<CollaborationResponse>;
  collaborationRule?: Maybe<Array<CollaborationRule>>;
  collaborationRuleAggregate?: Maybe<CollaborationRuleAggExp>;
  collaborationRuleById?: Maybe<CollaborationRule>;
  collaborationStatus?: Maybe<Array<CollaborationStatus>>;
  collaborationStatusAggregate?: Maybe<CollaborationStatusAggExp>;
  collaborationStatusById?: Maybe<CollaborationStatus>;
  collaborationType?: Maybe<Array<CollaborationType>>;
  collaborationTypeAggregate?: Maybe<CollaborationTypeAggExp>;
  collaborationTypeById?: Maybe<CollaborationType>;
  deletedMessage?: Maybe<Array<DeletedMessage>>;
  deletedMessageAggregate?: Maybe<DeletedMessageAggExp>;
  deletedMessageByMessageId?: Maybe<DeletedMessage>;
  hiringStatus?: Maybe<Array<HiringStatus>>;
  hiringStatusAggregate?: Maybe<HiringStatusAggExp>;
  hiringStatusById?: Maybe<HiringStatus>;
  infraction?: Maybe<Array<Infraction>>;
  infractionAggregate?: Maybe<InfractionAggExp>;
  infractionById?: Maybe<Infraction>;
  memberNote?: Maybe<Array<MemberNote>>;
  memberNoteAggregate?: Maybe<MemberNoteAggExp>;
  memberNoteById?: Maybe<MemberNote>;
  mute?: Maybe<Array<Mute>>;
  muteAggregate?: Maybe<MuteAggExp>;
  muteByMutePk?: Maybe<Mute>;
  reportedMessage?: Maybe<Array<ReportedMessage>>;
  reportedMessageAggregate?: Maybe<ReportedMessageAggExp>;
  reportedMessageById?: Maybe<ReportedMessage>;
  rule?: Maybe<Array<Rule>>;
  ruleAggregate?: Maybe<RuleAggExp>;
  ruleByRulePk?: Maybe<Rule>;
  staffMessage?: Maybe<Array<StaffMessage>>;
  staffMessageAggregate?: Maybe<StaffMessageAggExp>;
  staffMessageById?: Maybe<StaffMessage>;
  temporaryBan?: Maybe<Array<TemporaryBan>>;
  temporaryBanAggregate?: Maybe<TemporaryBanAggExp>;
  temporaryBanByTemporaryBanPk?: Maybe<TemporaryBan>;
  trackedMessages?: Maybe<Array<TrackedMessages>>;
  trackedMessagesAggregate?: Maybe<TrackedMessagesAggExp>;
  trackedMessagesById?: Maybe<TrackedMessages>;
};

export type SubscriptionAltAccountArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<AltAccountOrderByExp>>;
  where?: InputMaybe<AltAccountBoolExp>;
};

export type SubscriptionAltAccountAggregateArgs = {
  filter_input?: InputMaybe<AltAccountFilterInput>;
};

export type SubscriptionAltAccountByAltAccountPkArgs = {
  altId: Scalars['Int64']['input'];
  userId: Scalars['Int64']['input'];
};

export type SubscriptionBlockedReporterArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<BlockedReporterOrderByExp>>;
  where?: InputMaybe<BlockedReporterBoolExp>;
};

export type SubscriptionBlockedReporterAggregateArgs = {
  filter_input?: InputMaybe<BlockedReporterFilterInput>;
};

export type SubscriptionBlockedReporterByBlockedReporterPkArgs = {
  guildId: Scalars['Int64']['input'];
  userId: Scalars['Int64']['input'];
};

export type SubscriptionCollaborationAlertArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationAlertOrderByExp>>;
  where?: InputMaybe<CollaborationAlertBoolExp>;
};

export type SubscriptionCollaborationAlertAggregateArgs = {
  filter_input?: InputMaybe<CollaborationAlertFilterInput>;
};

export type SubscriptionCollaborationAlertByIdArgs = {
  id: Scalars['String1']['input'];
};

export type SubscriptionCollaborationAuditLogArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationAuditLogOrderByExp>>;
  where?: InputMaybe<CollaborationAuditLogBoolExp>;
};

export type SubscriptionCollaborationAuditLogAggregateArgs = {
  filter_input?: InputMaybe<CollaborationAuditLogFilterInput>;
};

export type SubscriptionCollaborationAuditLogByIdArgs = {
  id: Scalars['String1']['input'];
};

export type SubscriptionCollaborationBlockedUserArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationBlockedUserOrderByExp>>;
  where?: InputMaybe<CollaborationBlockedUserBoolExp>;
};

export type SubscriptionCollaborationBlockedUserAggregateArgs = {
  filter_input?: InputMaybe<CollaborationBlockedUserFilterInput>;
};

export type SubscriptionCollaborationBlockedUserByIdArgs = {
  id: Scalars['String1']['input'];
};

export type SubscriptionCollaborationBookmarkArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationBookmarkOrderByExp>>;
  where?: InputMaybe<CollaborationBookmarkBoolExp>;
};

export type SubscriptionCollaborationBookmarkAggregateArgs = {
  filter_input?: InputMaybe<CollaborationBookmarkFilterInput>;
};

export type SubscriptionCollaborationBookmarkByIdArgs = {
  id: Scalars['String1']['input'];
};

export type SubscriptionCollaborationFieldDefinitionArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationFieldDefinitionOrderByExp>>;
  where?: InputMaybe<CollaborationFieldDefinitionBoolExp>;
};

export type SubscriptionCollaborationFieldDefinitionAggregateArgs = {
  filter_input?: InputMaybe<CollaborationFieldDefinitionFilterInput>;
};

export type SubscriptionCollaborationFieldDefinitionByIdArgs = {
  id: Scalars['String1']['input'];
};

export type SubscriptionCollaborationFieldValueArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationFieldValueOrderByExp>>;
  where?: InputMaybe<CollaborationFieldValueBoolExp>;
};

export type SubscriptionCollaborationFieldValueAggregateArgs = {
  filter_input?: InputMaybe<CollaborationFieldValueFilterInput>;
};

export type SubscriptionCollaborationFieldValueByIdArgs = {
  id: Scalars['String1']['input'];
};

export type SubscriptionCollaborationPostArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationPostOrderByExp>>;
  where?: InputMaybe<CollaborationPostBoolExp>;
};

export type SubscriptionCollaborationPostAggregateArgs = {
  filter_input?: InputMaybe<CollaborationPostFilterInput>;
};

export type SubscriptionCollaborationPostByIdArgs = {
  id: Scalars['String1']['input'];
};

export type SubscriptionCollaborationProfileArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationProfileOrderByExp>>;
  where?: InputMaybe<CollaborationProfileBoolExp>;
};

export type SubscriptionCollaborationProfileAggregateArgs = {
  filter_input?: InputMaybe<CollaborationProfileFilterInput>;
};

export type SubscriptionCollaborationProfileByIdArgs = {
  id: Scalars['String1']['input'];
};

export type SubscriptionCollaborationReportArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationReportOrderByExp>>;
  where?: InputMaybe<CollaborationReportBoolExp>;
};

export type SubscriptionCollaborationReportAggregateArgs = {
  filter_input?: InputMaybe<CollaborationReportFilterInput>;
};

export type SubscriptionCollaborationReportByIdArgs = {
  id: Scalars['String1']['input'];
};

export type SubscriptionCollaborationResponseArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationResponseOrderByExp>>;
  where?: InputMaybe<CollaborationResponseBoolExp>;
};

export type SubscriptionCollaborationResponseAggregateArgs = {
  filter_input?: InputMaybe<CollaborationResponseFilterInput>;
};

export type SubscriptionCollaborationResponseByIdArgs = {
  id: Scalars['String1']['input'];
};

export type SubscriptionCollaborationRuleArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationRuleOrderByExp>>;
  where?: InputMaybe<CollaborationRuleBoolExp>;
};

export type SubscriptionCollaborationRuleAggregateArgs = {
  filter_input?: InputMaybe<CollaborationRuleFilterInput>;
};

export type SubscriptionCollaborationRuleByIdArgs = {
  id: Scalars['String1']['input'];
};

export type SubscriptionCollaborationStatusArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationStatusOrderByExp>>;
  where?: InputMaybe<CollaborationStatusBoolExp>;
};

export type SubscriptionCollaborationStatusAggregateArgs = {
  filter_input?: InputMaybe<CollaborationStatusFilterInput>;
};

export type SubscriptionCollaborationStatusByIdArgs = {
  id: Scalars['Int32']['input'];
};

export type SubscriptionCollaborationTypeArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationTypeOrderByExp>>;
  where?: InputMaybe<CollaborationTypeBoolExp>;
};

export type SubscriptionCollaborationTypeAggregateArgs = {
  filter_input?: InputMaybe<CollaborationTypeFilterInput>;
};

export type SubscriptionCollaborationTypeByIdArgs = {
  id: Scalars['Int32']['input'];
};

export type SubscriptionDeletedMessageArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<DeletedMessageOrderByExp>>;
  where?: InputMaybe<DeletedMessageBoolExp>;
};

export type SubscriptionDeletedMessageAggregateArgs = {
  filter_input?: InputMaybe<DeletedMessageFilterInput>;
};

export type SubscriptionDeletedMessageByMessageIdArgs = {
  messageId: Scalars['Int64']['input'];
};

export type SubscriptionHiringStatusArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<HiringStatusOrderByExp>>;
  where?: InputMaybe<HiringStatusBoolExp>;
};

export type SubscriptionHiringStatusAggregateArgs = {
  filter_input?: InputMaybe<HiringStatusFilterInput>;
};

export type SubscriptionHiringStatusByIdArgs = {
  id: Scalars['Int32']['input'];
};

export type SubscriptionInfractionArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<InfractionOrderByExp>>;
  where?: InputMaybe<InfractionBoolExp>;
};

export type SubscriptionInfractionAggregateArgs = {
  filter_input?: InputMaybe<InfractionFilterInput>;
};

export type SubscriptionInfractionByIdArgs = {
  id: Scalars['Int64']['input'];
};

export type SubscriptionMemberNoteArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<MemberNoteOrderByExp>>;
  where?: InputMaybe<MemberNoteBoolExp>;
};

export type SubscriptionMemberNoteAggregateArgs = {
  filter_input?: InputMaybe<MemberNoteFilterInput>;
};

export type SubscriptionMemberNoteByIdArgs = {
  id: Scalars['Int64']['input'];
};

export type SubscriptionMuteArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<MuteOrderByExp>>;
  where?: InputMaybe<MuteBoolExp>;
};

export type SubscriptionMuteAggregateArgs = {
  filter_input?: InputMaybe<MuteFilterInput>;
};

export type SubscriptionMuteByMutePkArgs = {
  guildId: Scalars['Int64']['input'];
  userId: Scalars['Int64']['input'];
};

export type SubscriptionReportedMessageArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<ReportedMessageOrderByExp>>;
  where?: InputMaybe<ReportedMessageBoolExp>;
};

export type SubscriptionReportedMessageAggregateArgs = {
  filter_input?: InputMaybe<ReportedMessageFilterInput>;
};

export type SubscriptionReportedMessageByIdArgs = {
  id: Scalars['Int64']['input'];
};

export type SubscriptionRuleArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<RuleOrderByExp>>;
  where?: InputMaybe<RuleBoolExp>;
};

export type SubscriptionRuleAggregateArgs = {
  filter_input?: InputMaybe<RuleFilterInput>;
};

export type SubscriptionRuleByRulePkArgs = {
  guildId: Scalars['Int64']['input'];
  id: Scalars['Int32']['input'];
};

export type SubscriptionStaffMessageArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<StaffMessageOrderByExp>>;
  where?: InputMaybe<StaffMessageBoolExp>;
};

export type SubscriptionStaffMessageAggregateArgs = {
  filter_input?: InputMaybe<StaffMessageFilterInput>;
};

export type SubscriptionStaffMessageByIdArgs = {
  id: Scalars['Int64']['input'];
};

export type SubscriptionTemporaryBanArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<TemporaryBanOrderByExp>>;
  where?: InputMaybe<TemporaryBanBoolExp>;
};

export type SubscriptionTemporaryBanAggregateArgs = {
  filter_input?: InputMaybe<TemporaryBanFilterInput>;
};

export type SubscriptionTemporaryBanByTemporaryBanPkArgs = {
  guildId: Scalars['Int64']['input'];
  userId: Scalars['Int64']['input'];
};

export type SubscriptionTrackedMessagesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<TrackedMessagesOrderByExp>>;
  where?: InputMaybe<TrackedMessagesBoolExp>;
};

export type SubscriptionTrackedMessagesAggregateArgs = {
  filter_input?: InputMaybe<TrackedMessagesFilterInput>;
};

export type SubscriptionTrackedMessagesByIdArgs = {
  id: Scalars['Int64']['input'];
};

export type TemporaryBan = {
  __typename?: 'TemporaryBan';
  expiresAt: Scalars['Timestamp']['output'];
  guildId: Scalars['Int64']['output'];
  userId: Scalars['Int64']['output'];
};

export type TemporaryBanAggExp = {
  __typename?: 'TemporaryBanAggExp';
  _count: Scalars['Int']['output'];
  expiresAt: TimestampAggExp1;
  guildId: Int64AggExp1;
  userId: Int64AggExp1;
};

export type TemporaryBanBoolExp = {
  _and?: InputMaybe<Array<TemporaryBanBoolExp>>;
  _not?: InputMaybe<TemporaryBanBoolExp>;
  _or?: InputMaybe<Array<TemporaryBanBoolExp>>;
  expiresAt?: InputMaybe<TimestampBoolExp1>;
  guildId?: InputMaybe<Int64BoolExp1>;
  userId?: InputMaybe<Int64BoolExp1>;
};

export type TemporaryBanFilterInput = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<TemporaryBanOrderByExp>>;
  where?: InputMaybe<TemporaryBanBoolExp>;
};

export type TemporaryBanOrderByExp = {
  expiresAt?: InputMaybe<OrderBy>;
  guildId?: InputMaybe<OrderBy>;
  userId?: InputMaybe<OrderBy>;
};

export type TimestampAggExp = {
  __typename?: 'TimestampAggExp';
  _count: Scalars['Int']['output'];
  _count_distinct: Scalars['Int']['output'];
};

export type TimestampAggExp1 = {
  __typename?: 'TimestampAggExp1';
  _count: Scalars['Int']['output'];
  _count_distinct: Scalars['Int']['output'];
};

export type TimestampBoolExp = {
  _and?: InputMaybe<Array<TimestampBoolExp>>;
  _eq?: InputMaybe<Scalars['Timestamp']['input']>;
  _gt?: InputMaybe<Scalars['Timestamp']['input']>;
  _gte?: InputMaybe<Scalars['Timestamp']['input']>;
  _in?: InputMaybe<Array<Scalars['Timestamp']['input']>>;
  _is_null?: InputMaybe<Scalars['Boolean']['input']>;
  _lt?: InputMaybe<Scalars['Timestamp']['input']>;
  _lte?: InputMaybe<Scalars['Timestamp']['input']>;
  _not?: InputMaybe<TimestampBoolExp>;
  _or?: InputMaybe<Array<TimestampBoolExp>>;
};

export type TimestampBoolExp1 = {
  _and?: InputMaybe<Array<TimestampBoolExp1>>;
  _eq?: InputMaybe<Scalars['Timestamp']['input']>;
  _gt?: InputMaybe<Scalars['Timestamp']['input']>;
  _gte?: InputMaybe<Scalars['Timestamp']['input']>;
  _in?: InputMaybe<Array<Scalars['Timestamp']['input']>>;
  _is_null?: InputMaybe<Scalars['Boolean']['input']>;
  _lt?: InputMaybe<Scalars['Timestamp']['input']>;
  _lte?: InputMaybe<Scalars['Timestamp']['input']>;
  _not?: InputMaybe<TimestampBoolExp1>;
  _or?: InputMaybe<Array<TimestampBoolExp1>>;
};

export type TrackedMessages = {
  __typename?: 'TrackedMessages';
  attachments: Scalars['Bytes']['output'];
  authorId: Scalars['Int64']['output'];
  channelId: Scalars['Int64']['output'];
  content?: Maybe<Scalars['String1']['output']>;
  creationTimestamp: Scalars['Timestamp']['output'];
  deletionTimestamp?: Maybe<Scalars['Timestamp']['output']>;
  guildId: Scalars['Int64']['output'];
  id: Scalars['Int64']['output'];
  isDeleted: Scalars['Int8']['output'];
};

export type TrackedMessagesAggExp = {
  __typename?: 'TrackedMessagesAggExp';
  _count: Scalars['Int']['output'];
  attachments: BytesAggExp;
  authorId: Int64AggExp1;
  channelId: Int64AggExp1;
  content: StringAggExp1;
  creationTimestamp: TimestampAggExp1;
  deletionTimestamp: TimestampAggExp1;
  guildId: Int64AggExp1;
  id: Int64AggExp1;
  isDeleted: Int8AggExp1;
};

export type TrackedMessagesBoolExp = {
  _and?: InputMaybe<Array<TrackedMessagesBoolExp>>;
  _not?: InputMaybe<TrackedMessagesBoolExp>;
  _or?: InputMaybe<Array<TrackedMessagesBoolExp>>;
  attachments?: InputMaybe<BytesBoolExp>;
  authorId?: InputMaybe<Int64BoolExp1>;
  channelId?: InputMaybe<Int64BoolExp1>;
  content?: InputMaybe<StringBoolExp1>;
  creationTimestamp?: InputMaybe<TimestampBoolExp1>;
  deletionTimestamp?: InputMaybe<TimestampBoolExp1>;
  guildId?: InputMaybe<Int64BoolExp1>;
  id?: InputMaybe<Int64BoolExp1>;
  isDeleted?: InputMaybe<Int8BoolExp1>;
};

export type TrackedMessagesFilterInput = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<TrackedMessagesOrderByExp>>;
  where?: InputMaybe<TrackedMessagesBoolExp>;
};

export type TrackedMessagesOrderByExp = {
  attachments?: InputMaybe<OrderBy>;
  authorId?: InputMaybe<OrderBy>;
  channelId?: InputMaybe<OrderBy>;
  content?: InputMaybe<OrderBy>;
  creationTimestamp?: InputMaybe<OrderBy>;
  deletionTimestamp?: InputMaybe<OrderBy>;
  guildId?: InputMaybe<OrderBy>;
  id?: InputMaybe<OrderBy>;
  isDeleted?: InputMaybe<OrderBy>;
};

export type AltAccountsQueryVariables = Exact<{ [key: string]: never }>;

export type AltAccountsQuery = {
  __typename?: 'Query';
  altAccount?: Array<{
    __typename?: 'AltAccount';
    userId: any;
    altId: any;
    staffMemberId: any;
    registeredAt: any;
  }> | null;
};

export type CollabsQueryVariables = Exact<{ [key: string]: never }>;

export type CollabsQuery = {
  __typename?: 'Query';
  collaborationProfile?: Array<{
    __typename?: 'CollaborationProfile';
    id: any;
    displayName?: any | null;
    bio?: any | null;
  }> | null;
};

export type CollaborationTypesQueryVariables = Exact<{ [key: string]: never }>;

export type CollaborationTypesQuery = {
  __typename?: 'Query';
  collaborationType?: Array<{
    __typename?: 'CollaborationType';
    id: any;
    name: any;
    description?: any | null;
  }> | null;
};

export type HiringStatusesQueryVariables = Exact<{ [key: string]: never }>;

export type HiringStatusesQuery = {
  __typename?: 'Query';
  hiringStatus?: Array<{
    __typename?: 'HiringStatus';
    id: any;
    name: any;
    description?: any | null;
  }> | null;
};

export type CollaborationStatusesQueryVariables = Exact<{
  [key: string]: never;
}>;

export type CollaborationStatusesQuery = {
  __typename?: 'Query';
  collaborationStatus?: Array<{
    __typename?: 'CollaborationStatus';
    id: any;
    name: any;
    description?: any | null;
  }> | null;
};

export type MyCollaborationProfileQueryVariables = Exact<{
  userId: Scalars['Int64']['input'];
}>;

export type MyCollaborationProfileQuery = {
  __typename?: 'Query';
  collaborationProfile?: Array<{
    __typename?: 'CollaborationProfile';
    id: any;
    userId: any;
    guildId: any;
    displayName?: any | null;
    bio?: any | null;
    skills?: any | null;
    portfolio?: any | null;
    contactPreferences?: any | null;
    isPublic: any;
    createdAt: any;
    updatedAt: any;
    lastActiveAt?: any | null;
    collaborationPosts?: Array<{
      __typename?: 'CollaborationPost';
      id: any;
      statusId: any;
      responseCount: any;
      viewCount: any;
    }> | null;
    collaborationResponses?: Array<{
      __typename?: 'CollaborationResponse';
      id: any;
      collaborationPostId: any;
      isRead: any;
    }> | null;
    collaborationBookmarks?: Array<{
      __typename?: 'CollaborationBookmark';
      id: any;
      collaborationPostId: any;
    }> | null;
  }> | null;
};

export type CollaborationProfileByIdQueryVariables = Exact<{
  id: Scalars['String1']['input'];
}>;

export type CollaborationProfileByIdQuery = {
  __typename?: 'Query';
  collaborationProfileById?: {
    __typename?: 'CollaborationProfile';
    id: any;
    userId: any;
    displayName?: any | null;
    bio?: any | null;
    skills?: any | null;
    portfolio?: any | null;
    contactPreferences?: any | null;
    isPublic: any;
    lastActiveAt?: any | null;
    collaborationPosts?: Array<{
      __typename?: 'CollaborationPost';
      id: any;
      collaborationTypeId: any;
      hiringStatusId: any;
      statusId: any;
      postedAt?: any | null;
      expiresAt?: any | null;
      viewCount: any;
      responseCount: any;
      tags?: any | null;
      collaborationType?: {
        __typename?: 'CollaborationType';
        name: any;
      } | null;
      hiringStatus?: { __typename?: 'HiringStatus'; name: any } | null;
      collaborationFieldValues?: Array<{
        __typename?: 'CollaborationFieldValue';
        id: any;
        value: any;
        collaborationFieldDefinition?: {
          __typename?: 'CollaborationFieldDefinition';
          id: any;
          fieldName: any;
          displayName: any;
        } | null;
      }> | null;
    }> | null;
  } | null;
};

export type CollaborationPostsQueryVariables = Exact<{
  where?: InputMaybe<CollaborationPostBoolExp>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<
    Array<CollaborationPostOrderByExp> | CollaborationPostOrderByExp
  >;
}>;

export type CollaborationPostsQuery = {
  __typename?: 'Query';
  collaborationPost?: Array<{
    __typename?: 'CollaborationPost';
    id: any;
    profileId: any;
    guildId: any;
    collaborationTypeId: any;
    hiringStatusId: any;
    statusId: any;
    createdAt: any;
    postedAt?: any | null;
    expiresAt?: any | null;
    viewCount: any;
    responseCount: any;
    isHighlighted: any;
    tags?: any | null;
    collaborationProfile?: {
      __typename?: 'CollaborationProfile';
      id: any;
      displayName?: any | null;
      userId: any;
    } | null;
    collaborationType?: {
      __typename?: 'CollaborationType';
      id: any;
      name: any;
    } | null;
    hiringStatus?: { __typename?: 'HiringStatus'; id: any; name: any } | null;
    collaborationStatus?: {
      __typename?: 'CollaborationStatus';
      id: any;
      name: any;
    } | null;
    collaborationFieldValues?: Array<{
      __typename?: 'CollaborationFieldValue';
      id: any;
      value: any;
      collaborationFieldDefinition?: {
        __typename?: 'CollaborationFieldDefinition';
        id: any;
        fieldName: any;
        displayName: any;
        fieldType: any;
      } | null;
    }> | null;
    collaborationBookmarks?: Array<{
      __typename?: 'CollaborationBookmark';
      profileId: any;
    }> | null;
  }> | null;
  collaborationPostAggregate?: {
    __typename?: 'CollaborationPostAggExp';
    _count: number;
  } | null;
};

export type CollaborationPostDetailQueryVariables = Exact<{
  id: Scalars['String1']['input'];
}>;

export type CollaborationPostDetailQuery = {
  __typename?: 'Query';
  collaborationPostById?: {
    __typename?: 'CollaborationPost';
    id: any;
    profileId: any;
    guildId: any;
    collaborationTypeId: any;
    hiringStatusId: any;
    statusId: any;
    createdAt: any;
    postedAt?: any | null;
    expiresAt?: any | null;
    viewCount: any;
    responseCount: any;
    isHighlighted: any;
    tags?: any | null;
    collaborationProfile?: {
      __typename?: 'CollaborationProfile';
      id: any;
      displayName?: any | null;
      bio?: any | null;
      skills?: any | null;
      portfolio?: any | null;
      contactPreferences?: any | null;
      userId: any;
      lastActiveAt?: any | null;
      isPublic: any;
    } | null;
    collaborationType?: {
      __typename?: 'CollaborationType';
      id: any;
      name: any;
      description?: any | null;
    } | null;
    hiringStatus?: {
      __typename?: 'HiringStatus';
      id: any;
      name: any;
      description?: any | null;
    } | null;
    collaborationStatus?: {
      __typename?: 'CollaborationStatus';
      id: any;
      name: any;
      description?: any | null;
    } | null;
    collaborationFieldValues?: Array<{
      __typename?: 'CollaborationFieldValue';
      id: any;
      value: any;
      collaborationFieldDefinition?: {
        __typename?: 'CollaborationFieldDefinition';
        id: any;
        fieldName: any;
        displayName: any;
        fieldType: any;
        helpText?: any | null;
      } | null;
    }> | null;
    collaborationResponses?: Array<{
      __typename?: 'CollaborationResponse';
      id: any;
      profileId: any;
      message: any;
      contactInfo?: any | null;
      isPublic: any;
      createdAt: any;
      isRead: any;
      collaborationProfile?: {
        __typename?: 'CollaborationProfile';
        id: any;
        displayName?: any | null;
        userId: any;
      } | null;
    }> | null;
  } | null;
};

export type CollaborationFieldDefinitionsQueryVariables = Exact<{
  typeId: Scalars['Int32']['input'];
  hiringStatusId: Scalars['Int32']['input'];
}>;

export type CollaborationFieldDefinitionsQuery = {
  __typename?: 'Query';
  collaborationFieldDefinition?: Array<{
    __typename?: 'CollaborationFieldDefinition';
    id: any;
    fieldName: any;
    displayName: any;
    fieldType: any;
    isRequired: any;
    fieldOrder: any;
    maxLength?: any | null;
    validationRegex?: any | null;
    helpText?: any | null;
    options?: any | null;
  }> | null;
};

export type MyCollaborationResponsesQueryVariables = Exact<{
  profileId: Scalars['String1']['input'];
}>;

export type MyCollaborationResponsesQuery = {
  __typename?: 'Query';
  collaborationResponse?: Array<{
    __typename?: 'CollaborationResponse';
    id: any;
    collaborationPostId: any;
    message: any;
    contactInfo?: any | null;
    isPublic: any;
    isHidden: any;
    createdAt: any;
    isRead: any;
    readAt?: any | null;
    collaborationPost?: {
      __typename?: 'CollaborationPost';
      id: any;
      statusId: any;
      collaborationProfile?: {
        __typename?: 'CollaborationProfile';
        displayName?: any | null;
      } | null;
      collaborationType?: {
        __typename?: 'CollaborationType';
        name: any;
      } | null;
      hiringStatus?: { __typename?: 'HiringStatus'; name: any } | null;
    } | null;
  }> | null;
};

export type PostResponsesQueryVariables = Exact<{
  postId: Scalars['String1']['input'];
  profileId: Scalars['String1']['input'];
}>;

export type PostResponsesQuery = {
  __typename?: 'Query';
  collaborationResponse?: Array<{
    __typename?: 'CollaborationResponse';
    id: any;
    profileId: any;
    message: any;
    contactInfo?: any | null;
    isPublic: any;
    createdAt: any;
    isRead: any;
    readAt?: any | null;
    collaborationProfile?: {
      __typename?: 'CollaborationProfile';
      id: any;
      displayName?: any | null;
      bio?: any | null;
      skills?: any | null;
      userId: any;
    } | null;
  }> | null;
};

export type MyBookmarksQueryVariables = Exact<{
  profileId: Scalars['String1']['input'];
}>;

export type MyBookmarksQuery = {
  __typename?: 'Query';
  collaborationBookmark?: Array<{
    __typename?: 'CollaborationBookmark';
    id: any;
    collaborationPostId: any;
    createdAt: any;
    collaborationPost?: {
      __typename?: 'CollaborationPost';
      id: any;
      statusId: any;
      postedAt?: any | null;
      expiresAt?: any | null;
      viewCount: any;
      responseCount: any;
      tags?: any | null;
      collaborationProfile?: {
        __typename?: 'CollaborationProfile';
        displayName?: any | null;
      } | null;
      collaborationType?: {
        __typename?: 'CollaborationType';
        name: any;
      } | null;
      hiringStatus?: { __typename?: 'HiringStatus'; name: any } | null;
      collaborationFieldValues?: Array<{
        __typename?: 'CollaborationFieldValue';
        value: any;
        collaborationFieldDefinition?: {
          __typename?: 'CollaborationFieldDefinition';
          fieldName: any;
          displayName: any;
        } | null;
      }> | null;
    } | null;
  }> | null;
};

export const AltAccountsDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'AltAccounts' },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'altAccount' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'userId' } },
                { kind: 'Field', name: { kind: 'Name', value: 'altId' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'staffMemberId' },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'registeredAt' },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<AltAccountsQuery, AltAccountsQueryVariables>;
export const CollabsDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'Collabs' },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'collaborationProfile' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'displayName' } },
                { kind: 'Field', name: { kind: 'Name', value: 'bio' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<CollabsQuery, CollabsQueryVariables>;
export const CollaborationTypesDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'CollaborationTypes' },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'collaborationType' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                { kind: 'Field', name: { kind: 'Name', value: 'description' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  CollaborationTypesQuery,
  CollaborationTypesQueryVariables
>;
export const HiringStatusesDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'HiringStatuses' },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'hiringStatus' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                { kind: 'Field', name: { kind: 'Name', value: 'description' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<HiringStatusesQuery, HiringStatusesQueryVariables>;
export const CollaborationStatusesDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'CollaborationStatuses' },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'collaborationStatus' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                { kind: 'Field', name: { kind: 'Name', value: 'description' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  CollaborationStatusesQuery,
  CollaborationStatusesQueryVariables
>;
export const MyCollaborationProfileDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'MyCollaborationProfile' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: {
            kind: 'Variable',
            name: { kind: 'Name', value: 'userId' },
          },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'Int64' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'collaborationProfile' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'where' },
                value: {
                  kind: 'ObjectValue',
                  fields: [
                    {
                      kind: 'ObjectField',
                      name: { kind: 'Name', value: 'userId' },
                      value: {
                        kind: 'ObjectValue',
                        fields: [
                          {
                            kind: 'ObjectField',
                            name: { kind: 'Name', value: '_eq' },
                            value: {
                              kind: 'Variable',
                              name: { kind: 'Name', value: 'userId' },
                            },
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'userId' } },
                { kind: 'Field', name: { kind: 'Name', value: 'guildId' } },
                { kind: 'Field', name: { kind: 'Name', value: 'displayName' } },
                { kind: 'Field', name: { kind: 'Name', value: 'bio' } },
                { kind: 'Field', name: { kind: 'Name', value: 'skills' } },
                { kind: 'Field', name: { kind: 'Name', value: 'portfolio' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'contactPreferences' },
                },
                { kind: 'Field', name: { kind: 'Name', value: 'isPublic' } },
                { kind: 'Field', name: { kind: 'Name', value: 'createdAt' } },
                { kind: 'Field', name: { kind: 'Name', value: 'updatedAt' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'lastActiveAt' },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'collaborationPosts' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'statusId' },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'responseCount' },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'viewCount' },
                      },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'collaborationResponses' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'collaborationPostId' },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'isRead' },
                      },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'collaborationBookmarks' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'collaborationPostId' },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  MyCollaborationProfileQuery,
  MyCollaborationProfileQueryVariables
>;
export const CollaborationProfileByIdDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'CollaborationProfileById' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String1' },
            },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'collaborationProfileById' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'id' },
                value: {
                  kind: 'Variable',
                  name: { kind: 'Name', value: 'id' },
                },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'userId' } },
                { kind: 'Field', name: { kind: 'Name', value: 'displayName' } },
                { kind: 'Field', name: { kind: 'Name', value: 'bio' } },
                { kind: 'Field', name: { kind: 'Name', value: 'skills' } },
                { kind: 'Field', name: { kind: 'Name', value: 'portfolio' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'contactPreferences' },
                },
                { kind: 'Field', name: { kind: 'Name', value: 'isPublic' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'lastActiveAt' },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'collaborationPosts' },
                  arguments: [
                    {
                      kind: 'Argument',
                      name: { kind: 'Name', value: 'where' },
                      value: {
                        kind: 'ObjectValue',
                        fields: [
                          {
                            kind: 'ObjectField',
                            name: { kind: 'Name', value: 'statusId' },
                            value: {
                              kind: 'ObjectValue',
                              fields: [
                                {
                                  kind: 'ObjectField',
                                  name: { kind: 'Name', value: '_eq' },
                                  value: { kind: 'IntValue', value: '2' },
                                },
                              ],
                            },
                          },
                        ],
                      },
                    },
                    {
                      kind: 'Argument',
                      name: { kind: 'Name', value: 'order_by' },
                      value: {
                        kind: 'ObjectValue',
                        fields: [
                          {
                            kind: 'ObjectField',
                            name: { kind: 'Name', value: 'postedAt' },
                            value: { kind: 'EnumValue', value: 'Desc' },
                          },
                        ],
                      },
                    },
                  ],
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'collaborationTypeId' },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'hiringStatusId' },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'statusId' },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'postedAt' },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'expiresAt' },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'viewCount' },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'responseCount' },
                      },
                      { kind: 'Field', name: { kind: 'Name', value: 'tags' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'collaborationType' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'name' },
                            },
                          ],
                        },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'hiringStatus' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'name' },
                            },
                          ],
                        },
                      },
                      {
                        kind: 'Field',
                        name: {
                          kind: 'Name',
                          value: 'collaborationFieldValues',
                        },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'id' },
                            },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'value' },
                            },
                            {
                              kind: 'Field',
                              name: {
                                kind: 'Name',
                                value: 'collaborationFieldDefinition',
                              },
                              selectionSet: {
                                kind: 'SelectionSet',
                                selections: [
                                  {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'id' },
                                  },
                                  {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'fieldName' },
                                  },
                                  {
                                    kind: 'Field',
                                    name: {
                                      kind: 'Name',
                                      value: 'displayName',
                                    },
                                  },
                                ],
                              },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  CollaborationProfileByIdQuery,
  CollaborationProfileByIdQueryVariables
>;
export const CollaborationPostsDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'CollaborationPosts' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: {
            kind: 'Variable',
            name: { kind: 'Name', value: 'where' },
          },
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'CollaborationPostBoolExp' },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: {
            kind: 'Variable',
            name: { kind: 'Name', value: 'limit' },
          },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'Int' } },
        },
        {
          kind: 'VariableDefinition',
          variable: {
            kind: 'Variable',
            name: { kind: 'Name', value: 'offset' },
          },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'Int' } },
        },
        {
          kind: 'VariableDefinition',
          variable: {
            kind: 'Variable',
            name: { kind: 'Name', value: 'order_by' },
          },
          type: {
            kind: 'ListType',
            type: {
              kind: 'NonNullType',
              type: {
                kind: 'NamedType',
                name: { kind: 'Name', value: 'CollaborationPostOrderByExp' },
              },
            },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'collaborationPost' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'where' },
                value: {
                  kind: 'Variable',
                  name: { kind: 'Name', value: 'where' },
                },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'limit' },
                value: {
                  kind: 'Variable',
                  name: { kind: 'Name', value: 'limit' },
                },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'offset' },
                value: {
                  kind: 'Variable',
                  name: { kind: 'Name', value: 'offset' },
                },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'order_by' },
                value: {
                  kind: 'Variable',
                  name: { kind: 'Name', value: 'order_by' },
                },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'profileId' } },
                { kind: 'Field', name: { kind: 'Name', value: 'guildId' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'collaborationTypeId' },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'hiringStatusId' },
                },
                { kind: 'Field', name: { kind: 'Name', value: 'statusId' } },
                { kind: 'Field', name: { kind: 'Name', value: 'createdAt' } },
                { kind: 'Field', name: { kind: 'Name', value: 'postedAt' } },
                { kind: 'Field', name: { kind: 'Name', value: 'expiresAt' } },
                { kind: 'Field', name: { kind: 'Name', value: 'viewCount' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'responseCount' },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'isHighlighted' },
                },
                { kind: 'Field', name: { kind: 'Name', value: 'tags' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'collaborationProfile' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'displayName' },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'userId' },
                      },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'collaborationType' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'hiringStatus' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'collaborationStatus' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'collaborationFieldValues' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'value' } },
                      {
                        kind: 'Field',
                        name: {
                          kind: 'Name',
                          value: 'collaborationFieldDefinition',
                        },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'id' },
                            },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'fieldName' },
                            },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'displayName' },
                            },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'fieldType' },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'collaborationBookmarks' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'profileId' },
                      },
                    ],
                  },
                },
              ],
            },
          },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'collaborationPostAggregate' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'filter_input' },
                value: {
                  kind: 'ObjectValue',
                  fields: [
                    {
                      kind: 'ObjectField',
                      name: { kind: 'Name', value: 'where' },
                      value: {
                        kind: 'Variable',
                        name: { kind: 'Name', value: 'where' },
                      },
                    },
                  ],
                },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: '_count' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  CollaborationPostsQuery,
  CollaborationPostsQueryVariables
>;
export const CollaborationPostDetailDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'CollaborationPostDetail' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String1' },
            },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'collaborationPostById' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'id' },
                value: {
                  kind: 'Variable',
                  name: { kind: 'Name', value: 'id' },
                },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'profileId' } },
                { kind: 'Field', name: { kind: 'Name', value: 'guildId' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'collaborationTypeId' },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'hiringStatusId' },
                },
                { kind: 'Field', name: { kind: 'Name', value: 'statusId' } },
                { kind: 'Field', name: { kind: 'Name', value: 'createdAt' } },
                { kind: 'Field', name: { kind: 'Name', value: 'postedAt' } },
                { kind: 'Field', name: { kind: 'Name', value: 'expiresAt' } },
                { kind: 'Field', name: { kind: 'Name', value: 'viewCount' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'responseCount' },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'isHighlighted' },
                },
                { kind: 'Field', name: { kind: 'Name', value: 'tags' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'collaborationProfile' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'displayName' },
                      },
                      { kind: 'Field', name: { kind: 'Name', value: 'bio' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'skills' },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'portfolio' },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'contactPreferences' },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'userId' },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'lastActiveAt' },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'isPublic' },
                      },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'collaborationType' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'description' },
                      },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'hiringStatus' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'description' },
                      },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'collaborationStatus' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'description' },
                      },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'collaborationFieldValues' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'value' } },
                      {
                        kind: 'Field',
                        name: {
                          kind: 'Name',
                          value: 'collaborationFieldDefinition',
                        },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'id' },
                            },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'fieldName' },
                            },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'displayName' },
                            },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'fieldType' },
                            },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'helpText' },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'collaborationResponses' },
                  arguments: [
                    {
                      kind: 'Argument',
                      name: { kind: 'Name', value: 'where' },
                      value: {
                        kind: 'ObjectValue',
                        fields: [
                          {
                            kind: 'ObjectField',
                            name: { kind: 'Name', value: 'isHidden' },
                            value: {
                              kind: 'ObjectValue',
                              fields: [
                                {
                                  kind: 'ObjectField',
                                  name: { kind: 'Name', value: '_eq' },
                                  value: { kind: 'IntValue', value: '0' },
                                },
                              ],
                            },
                          },
                        ],
                      },
                    },
                    {
                      kind: 'Argument',
                      name: { kind: 'Name', value: 'order_by' },
                      value: {
                        kind: 'ObjectValue',
                        fields: [
                          {
                            kind: 'ObjectField',
                            name: { kind: 'Name', value: 'createdAt' },
                            value: { kind: 'EnumValue', value: 'Desc' },
                          },
                        ],
                      },
                    },
                  ],
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'profileId' },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'message' },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'contactInfo' },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'isPublic' },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'createdAt' },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'isRead' },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'collaborationProfile' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'id' },
                            },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'displayName' },
                            },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'userId' },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  CollaborationPostDetailQuery,
  CollaborationPostDetailQueryVariables
>;
export const CollaborationFieldDefinitionsDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'CollaborationFieldDefinitions' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: {
            kind: 'Variable',
            name: { kind: 'Name', value: 'typeId' },
          },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'Int32' } },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: {
            kind: 'Variable',
            name: { kind: 'Name', value: 'hiringStatusId' },
          },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'Int32' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'collaborationFieldDefinition' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'where' },
                value: {
                  kind: 'ObjectValue',
                  fields: [
                    {
                      kind: 'ObjectField',
                      name: { kind: 'Name', value: 'collaborationTypeId' },
                      value: {
                        kind: 'ObjectValue',
                        fields: [
                          {
                            kind: 'ObjectField',
                            name: { kind: 'Name', value: '_eq' },
                            value: {
                              kind: 'Variable',
                              name: { kind: 'Name', value: 'typeId' },
                            },
                          },
                        ],
                      },
                    },
                    {
                      kind: 'ObjectField',
                      name: { kind: 'Name', value: 'hiringStatusId' },
                      value: {
                        kind: 'ObjectValue',
                        fields: [
                          {
                            kind: 'ObjectField',
                            name: { kind: 'Name', value: '_eq' },
                            value: {
                              kind: 'Variable',
                              name: { kind: 'Name', value: 'hiringStatusId' },
                            },
                          },
                        ],
                      },
                    },
                  ],
                },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'order_by' },
                value: {
                  kind: 'ObjectValue',
                  fields: [
                    {
                      kind: 'ObjectField',
                      name: { kind: 'Name', value: 'fieldOrder' },
                      value: { kind: 'EnumValue', value: 'Asc' },
                    },
                  ],
                },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'fieldName' } },
                { kind: 'Field', name: { kind: 'Name', value: 'displayName' } },
                { kind: 'Field', name: { kind: 'Name', value: 'fieldType' } },
                { kind: 'Field', name: { kind: 'Name', value: 'isRequired' } },
                { kind: 'Field', name: { kind: 'Name', value: 'fieldOrder' } },
                { kind: 'Field', name: { kind: 'Name', value: 'maxLength' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'validationRegex' },
                },
                { kind: 'Field', name: { kind: 'Name', value: 'helpText' } },
                { kind: 'Field', name: { kind: 'Name', value: 'options' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  CollaborationFieldDefinitionsQuery,
  CollaborationFieldDefinitionsQueryVariables
>;
export const MyCollaborationResponsesDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'MyCollaborationResponses' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: {
            kind: 'Variable',
            name: { kind: 'Name', value: 'profileId' },
          },
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String1' },
            },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'collaborationResponse' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'where' },
                value: {
                  kind: 'ObjectValue',
                  fields: [
                    {
                      kind: 'ObjectField',
                      name: { kind: 'Name', value: 'profileId' },
                      value: {
                        kind: 'ObjectValue',
                        fields: [
                          {
                            kind: 'ObjectField',
                            name: { kind: 'Name', value: '_eq' },
                            value: {
                              kind: 'Variable',
                              name: { kind: 'Name', value: 'profileId' },
                            },
                          },
                        ],
                      },
                    },
                  ],
                },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'order_by' },
                value: {
                  kind: 'ObjectValue',
                  fields: [
                    {
                      kind: 'ObjectField',
                      name: { kind: 'Name', value: 'createdAt' },
                      value: { kind: 'EnumValue', value: 'Desc' },
                    },
                  ],
                },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'collaborationPostId' },
                },
                { kind: 'Field', name: { kind: 'Name', value: 'message' } },
                { kind: 'Field', name: { kind: 'Name', value: 'contactInfo' } },
                { kind: 'Field', name: { kind: 'Name', value: 'isPublic' } },
                { kind: 'Field', name: { kind: 'Name', value: 'isHidden' } },
                { kind: 'Field', name: { kind: 'Name', value: 'createdAt' } },
                { kind: 'Field', name: { kind: 'Name', value: 'isRead' } },
                { kind: 'Field', name: { kind: 'Name', value: 'readAt' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'collaborationPost' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'statusId' },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'collaborationProfile' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'displayName' },
                            },
                          ],
                        },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'collaborationType' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'name' },
                            },
                          ],
                        },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'hiringStatus' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'name' },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  MyCollaborationResponsesQuery,
  MyCollaborationResponsesQueryVariables
>;
export const PostResponsesDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'PostResponses' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: {
            kind: 'Variable',
            name: { kind: 'Name', value: 'postId' },
          },
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String1' },
            },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: {
            kind: 'Variable',
            name: { kind: 'Name', value: 'profileId' },
          },
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String1' },
            },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'collaborationResponse' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'where' },
                value: {
                  kind: 'ObjectValue',
                  fields: [
                    {
                      kind: 'ObjectField',
                      name: { kind: 'Name', value: 'collaborationPostId' },
                      value: {
                        kind: 'ObjectValue',
                        fields: [
                          {
                            kind: 'ObjectField',
                            name: { kind: 'Name', value: '_eq' },
                            value: {
                              kind: 'Variable',
                              name: { kind: 'Name', value: 'postId' },
                            },
                          },
                        ],
                      },
                    },
                    {
                      kind: 'ObjectField',
                      name: { kind: 'Name', value: '_or' },
                      value: {
                        kind: 'ListValue',
                        values: [
                          {
                            kind: 'ObjectValue',
                            fields: [
                              {
                                kind: 'ObjectField',
                                name: {
                                  kind: 'Name',
                                  value: 'collaborationPost',
                                },
                                value: {
                                  kind: 'ObjectValue',
                                  fields: [
                                    {
                                      kind: 'ObjectField',
                                      name: {
                                        kind: 'Name',
                                        value: 'profileId',
                                      },
                                      value: {
                                        kind: 'ObjectValue',
                                        fields: [
                                          {
                                            kind: 'ObjectField',
                                            name: {
                                              kind: 'Name',
                                              value: '_eq',
                                            },
                                            value: {
                                              kind: 'Variable',
                                              name: {
                                                kind: 'Name',
                                                value: 'profileId',
                                              },
                                            },
                                          },
                                        ],
                                      },
                                    },
                                  ],
                                },
                              },
                            ],
                          },
                          {
                            kind: 'ObjectValue',
                            fields: [
                              {
                                kind: 'ObjectField',
                                name: { kind: 'Name', value: 'isPublic' },
                                value: {
                                  kind: 'ObjectValue',
                                  fields: [
                                    {
                                      kind: 'ObjectField',
                                      name: { kind: 'Name', value: '_eq' },
                                      value: { kind: 'IntValue', value: '1' },
                                    },
                                  ],
                                },
                              },
                            ],
                          },
                        ],
                      },
                    },
                    {
                      kind: 'ObjectField',
                      name: { kind: 'Name', value: 'isHidden' },
                      value: {
                        kind: 'ObjectValue',
                        fields: [
                          {
                            kind: 'ObjectField',
                            name: { kind: 'Name', value: '_eq' },
                            value: { kind: 'IntValue', value: '0' },
                          },
                        ],
                      },
                    },
                  ],
                },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'order_by' },
                value: {
                  kind: 'ObjectValue',
                  fields: [
                    {
                      kind: 'ObjectField',
                      name: { kind: 'Name', value: 'createdAt' },
                      value: { kind: 'EnumValue', value: 'Desc' },
                    },
                  ],
                },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'profileId' } },
                { kind: 'Field', name: { kind: 'Name', value: 'message' } },
                { kind: 'Field', name: { kind: 'Name', value: 'contactInfo' } },
                { kind: 'Field', name: { kind: 'Name', value: 'isPublic' } },
                { kind: 'Field', name: { kind: 'Name', value: 'createdAt' } },
                { kind: 'Field', name: { kind: 'Name', value: 'isRead' } },
                { kind: 'Field', name: { kind: 'Name', value: 'readAt' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'collaborationProfile' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'displayName' },
                      },
                      { kind: 'Field', name: { kind: 'Name', value: 'bio' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'skills' },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'userId' },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<PostResponsesQuery, PostResponsesQueryVariables>;
export const MyBookmarksDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'MyBookmarks' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: {
            kind: 'Variable',
            name: { kind: 'Name', value: 'profileId' },
          },
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String1' },
            },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'collaborationBookmark' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'where' },
                value: {
                  kind: 'ObjectValue',
                  fields: [
                    {
                      kind: 'ObjectField',
                      name: { kind: 'Name', value: 'profileId' },
                      value: {
                        kind: 'ObjectValue',
                        fields: [
                          {
                            kind: 'ObjectField',
                            name: { kind: 'Name', value: '_eq' },
                            value: {
                              kind: 'Variable',
                              name: { kind: 'Name', value: 'profileId' },
                            },
                          },
                        ],
                      },
                    },
                  ],
                },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'order_by' },
                value: {
                  kind: 'ObjectValue',
                  fields: [
                    {
                      kind: 'ObjectField',
                      name: { kind: 'Name', value: 'createdAt' },
                      value: { kind: 'EnumValue', value: 'Desc' },
                    },
                  ],
                },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'collaborationPostId' },
                },
                { kind: 'Field', name: { kind: 'Name', value: 'createdAt' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'collaborationPost' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'statusId' },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'postedAt' },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'expiresAt' },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'viewCount' },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'responseCount' },
                      },
                      { kind: 'Field', name: { kind: 'Name', value: 'tags' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'collaborationProfile' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'displayName' },
                            },
                          ],
                        },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'collaborationType' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'name' },
                            },
                          ],
                        },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'hiringStatus' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'name' },
                            },
                          ],
                        },
                      },
                      {
                        kind: 'Field',
                        name: {
                          kind: 'Name',
                          value: 'collaborationFieldValues',
                        },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'value' },
                            },
                            {
                              kind: 'Field',
                              name: {
                                kind: 'Name',
                                value: 'collaborationFieldDefinition',
                              },
                              selectionSet: {
                                kind: 'SelectionSet',
                                selections: [
                                  {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'fieldName' },
                                  },
                                  {
                                    kind: 'Field',
                                    name: {
                                      kind: 'Name',
                                      value: 'displayName',
                                    },
                                  },
                                ],
                              },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<MyBookmarksQuery, MyBookmarksQueryVariables>;
