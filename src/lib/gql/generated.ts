import { useQuery, UseQueryOptions } from '@tanstack/react-query';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };

function fetcher<TData, TVariables>(endpoint: string, requestInit: RequestInit, query: string, variables?: TVariables) {
  return async (): Promise<TData> => {
    const res = await fetch(endpoint, {
      method: 'POST',
      ...requestInit,
      body: JSON.stringify({ query, variables }),
    });

    const json = await res.json();

    if (json.errors) {
      const { message } = json.errors[0];

      throw new Error(message);
    }

    return json.data;
  }
}
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  Bytes: { input: any; output: any; }
  Float64: { input: any; output: any; }
  Int8: { input: any; output: any; }
  Int32: { input: any; output: any; }
  Int64: { input: any; output: any; }
  String1: { input: any; output: any; }
  Timestamp: { input: any; output: any; }
};

export type AltAccount = {
  altId: Scalars['Int64']['output'];
  registeredAt: Scalars['Timestamp']['output'];
  staffMemberId: Scalars['Int64']['output'];
  userId: Scalars['Int64']['output'];
};

export type AltAccountAggExp = {
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
  blockedAt: Scalars['Timestamp']['output'];
  guildId: Scalars['Int64']['output'];
  staffMemberId: Scalars['Int64']['output'];
  userId: Scalars['Int64']['output'];
};

export type BlockedReporterAggExp = {
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
  collaborationPost?: Maybe<CollaborationPost>;
  collaborationPostId: Scalars['String1']['output'];
  collaborationProfile?: Maybe<CollaborationProfile>;
  createdAt: Scalars['Timestamp']['output'];
  id: Scalars['String1']['output'];
  notes?: Maybe<Scalars['String1']['output']>;
  profileId: Scalars['String1']['output'];
};

export type CollaborationBookmarkAggExp = {
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


export type CollaborationFieldDefinitionCollaborationFieldValuesAggregateArgs = {
  filter_input?: InputMaybe<CollaborationFieldValueFilterInput>;
};

export type CollaborationFieldDefinitionAggExp = {
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
  collaborationFieldDefinition?: Maybe<CollaborationFieldDefinition>;
  collaborationPost?: Maybe<CollaborationPost>;
  collaborationPostId: Scalars['String1']['output'];
  fieldDefinitionId: Scalars['String1']['output'];
  id: Scalars['String1']['output'];
  value: Scalars['String1']['output'];
};

export type CollaborationFieldValueAggExp = {
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


export type CollaborationProfileCollaborationReportsByReportedByProfileIdArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationReportOrderByExp>>;
  where?: InputMaybe<CollaborationReportBoolExp>;
};


export type CollaborationProfileCollaborationReportsByReportedByProfileIdAggregateArgs = {
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
  _count: Scalars['Int']['output'];
  _count_distinct: Scalars['Int']['output'];
  avg: Scalars['Float64']['output'];
  max: Scalars['Int8']['output'];
  min: Scalars['Int8']['output'];
  sum: Scalars['Int64']['output'];
};

export type Int8AggExp1 = {
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
  _count: Scalars['Int']['output'];
  _count_distinct: Scalars['Int']['output'];
  avg: Scalars['Float64']['output'];
  max: Scalars['Int32']['output'];
  min: Scalars['Int32']['output'];
  sum: Scalars['Int64']['output'];
};

export type Int32AggExp1 = {
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
  _count: Scalars['Int']['output'];
  _count_distinct: Scalars['Int']['output'];
  avg: Scalars['Float64']['output'];
  max: Scalars['Int64']['output'];
  min: Scalars['Int64']['output'];
  sum: Scalars['Int64']['output'];
};

export type Int64AggExp1 = {
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
  authorId: Scalars['Int64']['output'];
  content: Scalars['String1']['output'];
  creationTimestamp: Scalars['Timestamp']['output'];
  guildId: Scalars['Int64']['output'];
  id: Scalars['Int64']['output'];
  type: Scalars['Int32']['output'];
  userId: Scalars['Int64']['output'];
};

export type MemberNoteAggExp = {
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
  _no_fields_accessible?: Maybe<Scalars['String']['output']>;
};

export type Mute = {
  expiresAt?: Maybe<Scalars['Timestamp']['output']>;
  guildId: Scalars['Int64']['output'];
  userId: Scalars['Int64']['output'];
};

export type MuteAggExp = {
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
  Desc = 'Desc'
}

export type Query = {
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
  brief?: Maybe<Scalars['String1']['output']>;
  description: Scalars['String1']['output'];
  guildId: Scalars['Int64']['output'];
  id: Scalars['Int32']['output'];
};

export type RuleAggExp = {
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
  content: Scalars['String1']['output'];
  guildId: Scalars['Int64']['output'];
  id: Scalars['Int64']['output'];
  recipientId: Scalars['Int64']['output'];
  sentAt: Scalars['Timestamp']['output'];
  staffMemberId: Scalars['Int64']['output'];
};

export type StaffMessageAggExp = {
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
  _count: Scalars['Int']['output'];
  _count_distinct: Scalars['Int']['output'];
  max: Scalars['String1']['output'];
  min: Scalars['String1']['output'];
};

export type StringAggExp1 = {
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
  expiresAt: Scalars['Timestamp']['output'];
  guildId: Scalars['Int64']['output'];
  userId: Scalars['Int64']['output'];
};

export type TemporaryBanAggExp = {
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
  _count: Scalars['Int']['output'];
  _count_distinct: Scalars['Int']['output'];
};

export type TimestampAggExp1 = {
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

export type AltAccountsQueryVariables = Exact<{ [key: string]: never; }>;


export type AltAccountsQuery = { altAccount?: Array<{ userId: any, altId: any, staffMemberId: any, registeredAt: any }> | null };

export type CollabsQueryVariables = Exact<{ [key: string]: never; }>;


export type CollabsQuery = { collaborationProfile?: Array<{ id: any, displayName?: any | null, bio?: any | null }> | null };

export type CollaborationTypesQueryVariables = Exact<{ [key: string]: never; }>;


export type CollaborationTypesQuery = { collaborationType?: Array<{ id: any, name: any, description?: any | null }> | null };

export type HiringStatusesQueryVariables = Exact<{ [key: string]: never; }>;


export type HiringStatusesQuery = { hiringStatus?: Array<{ id: any, name: any, description?: any | null }> | null };

export type CollaborationStatusesQueryVariables = Exact<{ [key: string]: never; }>;


export type CollaborationStatusesQuery = { collaborationStatus?: Array<{ id: any, name: any, description?: any | null }> | null };

export type MyCollaborationProfileQueryVariables = Exact<{
  userId: Scalars['Int64']['input'];
}>;


export type MyCollaborationProfileQuery = { collaborationProfile?: Array<{ id: any, userId: any, guildId: any, displayName?: any | null, bio?: any | null, skills?: any | null, portfolio?: any | null, contactPreferences?: any | null, isPublic: any, createdAt: any, updatedAt: any, lastActiveAt?: any | null, collaborationPosts?: Array<{ id: any, statusId: any, responseCount: any, viewCount: any }> | null, collaborationResponses?: Array<{ id: any, collaborationPostId: any, isRead: any }> | null, collaborationBookmarks?: Array<{ id: any, collaborationPostId: any }> | null }> | null };

export type CollaborationProfileByIdQueryVariables = Exact<{
  id: Scalars['String1']['input'];
}>;


export type CollaborationProfileByIdQuery = { collaborationProfileById?: { id: any, userId: any, displayName?: any | null, bio?: any | null, skills?: any | null, portfolio?: any | null, contactPreferences?: any | null, isPublic: any, lastActiveAt?: any | null, collaborationPosts?: Array<{ id: any, collaborationTypeId: any, hiringStatusId: any, statusId: any, postedAt?: any | null, expiresAt?: any | null, viewCount: any, responseCount: any, tags?: any | null, collaborationType?: { name: any } | null, hiringStatus?: { name: any } | null, collaborationFieldValues?: Array<{ id: any, value: any, collaborationFieldDefinition?: { id: any, fieldName: any, displayName: any } | null }> | null }> | null } | null };

export type CollaborationPostsQueryVariables = Exact<{
  where?: InputMaybe<CollaborationPostBoolExp>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<CollaborationPostOrderByExp> | CollaborationPostOrderByExp>;
}>;


export type CollaborationPostsQuery = { collaborationPost?: Array<{ id: any, profileId: any, guildId: any, collaborationTypeId: any, hiringStatusId: any, statusId: any, createdAt: any, postedAt?: any | null, expiresAt?: any | null, viewCount: any, responseCount: any, isHighlighted: any, tags?: any | null, collaborationProfile?: { id: any, displayName?: any | null, userId: any } | null, collaborationType?: { id: any, name: any } | null, hiringStatus?: { id: any, name: any } | null, collaborationStatus?: { id: any, name: any } | null, collaborationFieldValues?: Array<{ id: any, value: any, collaborationFieldDefinition?: { id: any, fieldName: any, displayName: any, fieldType: any } | null }> | null, collaborationBookmarks?: Array<{ profileId: any }> | null }> | null, collaborationPostAggregate?: { _count: number } | null };

export type CollaborationPostDetailQueryVariables = Exact<{
  id: Scalars['String1']['input'];
}>;


export type CollaborationPostDetailQuery = { collaborationPostById?: { id: any, profileId: any, guildId: any, collaborationTypeId: any, hiringStatusId: any, statusId: any, createdAt: any, postedAt?: any | null, expiresAt?: any | null, viewCount: any, responseCount: any, isHighlighted: any, tags?: any | null, collaborationProfile?: { id: any, displayName?: any | null, bio?: any | null, skills?: any | null, portfolio?: any | null, contactPreferences?: any | null, userId: any, lastActiveAt?: any | null, isPublic: any } | null, collaborationType?: { id: any, name: any, description?: any | null } | null, hiringStatus?: { id: any, name: any, description?: any | null } | null, collaborationStatus?: { id: any, name: any, description?: any | null } | null, collaborationFieldValues?: Array<{ id: any, value: any, collaborationFieldDefinition?: { id: any, fieldName: any, displayName: any, fieldType: any, helpText?: any | null } | null }> | null, collaborationResponses?: Array<{ id: any, profileId: any, message: any, contactInfo?: any | null, isPublic: any, createdAt: any, isRead: any, collaborationProfile?: { id: any, displayName?: any | null, userId: any } | null }> | null } | null };

export type CollaborationFieldDefinitionsQueryVariables = Exact<{
  typeId: Scalars['Int32']['input'];
  hiringStatusId: Scalars['Int32']['input'];
}>;


export type CollaborationFieldDefinitionsQuery = { collaborationFieldDefinition?: Array<{ id: any, fieldName: any, displayName: any, fieldType: any, isRequired: any, fieldOrder: any, maxLength?: any | null, validationRegex?: any | null, helpText?: any | null, options?: any | null }> | null };

export type MyCollaborationResponsesQueryVariables = Exact<{
  profileId: Scalars['String1']['input'];
}>;


export type MyCollaborationResponsesQuery = { collaborationResponse?: Array<{ id: any, collaborationPostId: any, message: any, contactInfo?: any | null, isPublic: any, isHidden: any, createdAt: any, isRead: any, readAt?: any | null, collaborationPost?: { id: any, statusId: any, collaborationProfile?: { displayName?: any | null } | null, collaborationType?: { name: any } | null, hiringStatus?: { name: any } | null } | null }> | null };

export type PostResponsesQueryVariables = Exact<{
  postId: Scalars['String1']['input'];
  profileId: Scalars['String1']['input'];
}>;


export type PostResponsesQuery = { collaborationResponse?: Array<{ id: any, profileId: any, message: any, contactInfo?: any | null, isPublic: any, createdAt: any, isRead: any, readAt?: any | null, collaborationProfile?: { id: any, displayName?: any | null, bio?: any | null, skills?: any | null, userId: any } | null }> | null };

export type MyBookmarksQueryVariables = Exact<{
  profileId: Scalars['String1']['input'];
}>;


export type MyBookmarksQuery = { collaborationBookmark?: Array<{ id: any, collaborationPostId: any, createdAt: any, collaborationPost?: { id: any, statusId: any, postedAt?: any | null, expiresAt?: any | null, viewCount: any, responseCount: any, tags?: any | null, collaborationProfile?: { displayName?: any | null } | null, collaborationType?: { name: any } | null, hiringStatus?: { name: any } | null, collaborationFieldValues?: Array<{ value: any, collaborationFieldDefinition?: { fieldName: any, displayName: any } | null }> | null } | null }> | null };



export const AltAccountsDocument = `
    query AltAccounts {
  altAccount {
    userId
    altId
    staffMemberId
    registeredAt
  }
}
    `;

export const useAltAccountsQuery = <
      TData = AltAccountsQuery,
      TError = unknown
    >(
      dataSource: { endpoint: string, fetchParams?: RequestInit },
      variables?: AltAccountsQueryVariables,
      options?: Omit<UseQueryOptions<AltAccountsQuery, TError, TData>, 'queryKey'> & { queryKey?: UseQueryOptions<AltAccountsQuery, TError, TData>['queryKey'] }
    ) => {
    
    return useQuery<AltAccountsQuery, TError, TData>(
      {
    queryKey: variables === undefined ? ['AltAccounts'] : ['AltAccounts', variables],
    queryFn: fetcher<AltAccountsQuery, AltAccountsQueryVariables>(dataSource.endpoint, dataSource.fetchParams || {}, AltAccountsDocument, variables),
    ...options
  }
    )};

useAltAccountsQuery.document = AltAccountsDocument;

export const CollabsDocument = `
    query Collabs {
  collaborationProfile {
    id
    displayName
    bio
  }
}
    `;

export const useCollabsQuery = <
      TData = CollabsQuery,
      TError = unknown
    >(
      dataSource: { endpoint: string, fetchParams?: RequestInit },
      variables?: CollabsQueryVariables,
      options?: Omit<UseQueryOptions<CollabsQuery, TError, TData>, 'queryKey'> & { queryKey?: UseQueryOptions<CollabsQuery, TError, TData>['queryKey'] }
    ) => {
    
    return useQuery<CollabsQuery, TError, TData>(
      {
    queryKey: variables === undefined ? ['Collabs'] : ['Collabs', variables],
    queryFn: fetcher<CollabsQuery, CollabsQueryVariables>(dataSource.endpoint, dataSource.fetchParams || {}, CollabsDocument, variables),
    ...options
  }
    )};

useCollabsQuery.document = CollabsDocument;

export const CollaborationTypesDocument = `
    query CollaborationTypes {
  collaborationType {
    id
    name
    description
  }
}
    `;

export const useCollaborationTypesQuery = <
      TData = CollaborationTypesQuery,
      TError = unknown
    >(
      dataSource: { endpoint: string, fetchParams?: RequestInit },
      variables?: CollaborationTypesQueryVariables,
      options?: Omit<UseQueryOptions<CollaborationTypesQuery, TError, TData>, 'queryKey'> & { queryKey?: UseQueryOptions<CollaborationTypesQuery, TError, TData>['queryKey'] }
    ) => {
    
    return useQuery<CollaborationTypesQuery, TError, TData>(
      {
    queryKey: variables === undefined ? ['CollaborationTypes'] : ['CollaborationTypes', variables],
    queryFn: fetcher<CollaborationTypesQuery, CollaborationTypesQueryVariables>(dataSource.endpoint, dataSource.fetchParams || {}, CollaborationTypesDocument, variables),
    ...options
  }
    )};

useCollaborationTypesQuery.document = CollaborationTypesDocument;

export const HiringStatusesDocument = `
    query HiringStatuses {
  hiringStatus {
    id
    name
    description
  }
}
    `;

export const useHiringStatusesQuery = <
      TData = HiringStatusesQuery,
      TError = unknown
    >(
      dataSource: { endpoint: string, fetchParams?: RequestInit },
      variables?: HiringStatusesQueryVariables,
      options?: Omit<UseQueryOptions<HiringStatusesQuery, TError, TData>, 'queryKey'> & { queryKey?: UseQueryOptions<HiringStatusesQuery, TError, TData>['queryKey'] }
    ) => {
    
    return useQuery<HiringStatusesQuery, TError, TData>(
      {
    queryKey: variables === undefined ? ['HiringStatuses'] : ['HiringStatuses', variables],
    queryFn: fetcher<HiringStatusesQuery, HiringStatusesQueryVariables>(dataSource.endpoint, dataSource.fetchParams || {}, HiringStatusesDocument, variables),
    ...options
  }
    )};

useHiringStatusesQuery.document = HiringStatusesDocument;

export const CollaborationStatusesDocument = `
    query CollaborationStatuses {
  collaborationStatus {
    id
    name
    description
  }
}
    `;

export const useCollaborationStatusesQuery = <
      TData = CollaborationStatusesQuery,
      TError = unknown
    >(
      dataSource: { endpoint: string, fetchParams?: RequestInit },
      variables?: CollaborationStatusesQueryVariables,
      options?: Omit<UseQueryOptions<CollaborationStatusesQuery, TError, TData>, 'queryKey'> & { queryKey?: UseQueryOptions<CollaborationStatusesQuery, TError, TData>['queryKey'] }
    ) => {
    
    return useQuery<CollaborationStatusesQuery, TError, TData>(
      {
    queryKey: variables === undefined ? ['CollaborationStatuses'] : ['CollaborationStatuses', variables],
    queryFn: fetcher<CollaborationStatusesQuery, CollaborationStatusesQueryVariables>(dataSource.endpoint, dataSource.fetchParams || {}, CollaborationStatusesDocument, variables),
    ...options
  }
    )};

useCollaborationStatusesQuery.document = CollaborationStatusesDocument;

export const MyCollaborationProfileDocument = `
    query MyCollaborationProfile($userId: Int64!) {
  collaborationProfile(where: {userId: {_eq: $userId}}) {
    id
    userId
    guildId
    displayName
    bio
    skills
    portfolio
    contactPreferences
    isPublic
    createdAt
    updatedAt
    lastActiveAt
    collaborationPosts {
      id
      statusId
      responseCount
      viewCount
    }
    collaborationResponses {
      id
      collaborationPostId
      isRead
    }
    collaborationBookmarks {
      id
      collaborationPostId
    }
  }
}
    `;

export const useMyCollaborationProfileQuery = <
      TData = MyCollaborationProfileQuery,
      TError = unknown
    >(
      dataSource: { endpoint: string, fetchParams?: RequestInit },
      variables: MyCollaborationProfileQueryVariables,
      options?: Omit<UseQueryOptions<MyCollaborationProfileQuery, TError, TData>, 'queryKey'> & { queryKey?: UseQueryOptions<MyCollaborationProfileQuery, TError, TData>['queryKey'] }
    ) => {
    
    return useQuery<MyCollaborationProfileQuery, TError, TData>(
      {
    queryKey: ['MyCollaborationProfile', variables],
    queryFn: fetcher<MyCollaborationProfileQuery, MyCollaborationProfileQueryVariables>(dataSource.endpoint, dataSource.fetchParams || {}, MyCollaborationProfileDocument, variables),
    ...options
  }
    )};

useMyCollaborationProfileQuery.document = MyCollaborationProfileDocument;

export const CollaborationProfileByIdDocument = `
    query CollaborationProfileById($id: String1!) {
  collaborationProfileById(id: $id) {
    id
    userId
    displayName
    bio
    skills
    portfolio
    contactPreferences
    isPublic
    lastActiveAt
    collaborationPosts(where: {statusId: {_eq: 2}}, order_by: {postedAt: Desc}) {
      id
      collaborationTypeId
      hiringStatusId
      statusId
      postedAt
      expiresAt
      viewCount
      responseCount
      tags
      collaborationType {
        name
      }
      hiringStatus {
        name
      }
      collaborationFieldValues {
        id
        value
        collaborationFieldDefinition {
          id
          fieldName
          displayName
        }
      }
    }
  }
}
    `;

export const useCollaborationProfileByIdQuery = <
      TData = CollaborationProfileByIdQuery,
      TError = unknown
    >(
      dataSource: { endpoint: string, fetchParams?: RequestInit },
      variables: CollaborationProfileByIdQueryVariables,
      options?: Omit<UseQueryOptions<CollaborationProfileByIdQuery, TError, TData>, 'queryKey'> & { queryKey?: UseQueryOptions<CollaborationProfileByIdQuery, TError, TData>['queryKey'] }
    ) => {
    
    return useQuery<CollaborationProfileByIdQuery, TError, TData>(
      {
    queryKey: ['CollaborationProfileById', variables],
    queryFn: fetcher<CollaborationProfileByIdQuery, CollaborationProfileByIdQueryVariables>(dataSource.endpoint, dataSource.fetchParams || {}, CollaborationProfileByIdDocument, variables),
    ...options
  }
    )};

useCollaborationProfileByIdQuery.document = CollaborationProfileByIdDocument;

export const CollaborationPostsDocument = `
    query CollaborationPosts($where: CollaborationPostBoolExp, $limit: Int, $offset: Int, $order_by: [CollaborationPostOrderByExp!]) {
  collaborationPost(
    where: $where
    limit: $limit
    offset: $offset
    order_by: $order_by
  ) {
    id
    profileId
    guildId
    collaborationTypeId
    hiringStatusId
    statusId
    createdAt
    postedAt
    expiresAt
    viewCount
    responseCount
    isHighlighted
    tags
    collaborationProfile {
      id
      displayName
      userId
    }
    collaborationType {
      id
      name
    }
    hiringStatus {
      id
      name
    }
    collaborationStatus {
      id
      name
    }
    collaborationFieldValues {
      id
      value
      collaborationFieldDefinition {
        id
        fieldName
        displayName
        fieldType
      }
    }
    collaborationBookmarks {
      profileId
    }
  }
  collaborationPostAggregate(filter_input: {where: $where}) {
    _count
  }
}
    `;

export const useCollaborationPostsQuery = <
      TData = CollaborationPostsQuery,
      TError = unknown
    >(
      dataSource: { endpoint: string, fetchParams?: RequestInit },
      variables?: CollaborationPostsQueryVariables,
      options?: Omit<UseQueryOptions<CollaborationPostsQuery, TError, TData>, 'queryKey'> & { queryKey?: UseQueryOptions<CollaborationPostsQuery, TError, TData>['queryKey'] }
    ) => {
    
    return useQuery<CollaborationPostsQuery, TError, TData>(
      {
    queryKey: variables === undefined ? ['CollaborationPosts'] : ['CollaborationPosts', variables],
    queryFn: fetcher<CollaborationPostsQuery, CollaborationPostsQueryVariables>(dataSource.endpoint, dataSource.fetchParams || {}, CollaborationPostsDocument, variables),
    ...options
  }
    )};

useCollaborationPostsQuery.document = CollaborationPostsDocument;

export const CollaborationPostDetailDocument = `
    query CollaborationPostDetail($id: String1!) {
  collaborationPostById(id: $id) {
    id
    profileId
    guildId
    collaborationTypeId
    hiringStatusId
    statusId
    createdAt
    postedAt
    expiresAt
    viewCount
    responseCount
    isHighlighted
    tags
    collaborationProfile {
      id
      displayName
      bio
      skills
      portfolio
      contactPreferences
      userId
      lastActiveAt
      isPublic
    }
    collaborationType {
      id
      name
      description
    }
    hiringStatus {
      id
      name
      description
    }
    collaborationStatus {
      id
      name
      description
    }
    collaborationFieldValues {
      id
      value
      collaborationFieldDefinition {
        id
        fieldName
        displayName
        fieldType
        helpText
      }
    }
    collaborationResponses(where: {isHidden: {_eq: 0}}, order_by: {createdAt: Desc}) {
      id
      profileId
      message
      contactInfo
      isPublic
      createdAt
      isRead
      collaborationProfile {
        id
        displayName
        userId
      }
    }
  }
}
    `;

export const useCollaborationPostDetailQuery = <
      TData = CollaborationPostDetailQuery,
      TError = unknown
    >(
      dataSource: { endpoint: string, fetchParams?: RequestInit },
      variables: CollaborationPostDetailQueryVariables,
      options?: Omit<UseQueryOptions<CollaborationPostDetailQuery, TError, TData>, 'queryKey'> & { queryKey?: UseQueryOptions<CollaborationPostDetailQuery, TError, TData>['queryKey'] }
    ) => {
    
    return useQuery<CollaborationPostDetailQuery, TError, TData>(
      {
    queryKey: ['CollaborationPostDetail', variables],
    queryFn: fetcher<CollaborationPostDetailQuery, CollaborationPostDetailQueryVariables>(dataSource.endpoint, dataSource.fetchParams || {}, CollaborationPostDetailDocument, variables),
    ...options
  }
    )};

useCollaborationPostDetailQuery.document = CollaborationPostDetailDocument;

export const CollaborationFieldDefinitionsDocument = `
    query CollaborationFieldDefinitions($typeId: Int32!, $hiringStatusId: Int32!) {
  collaborationFieldDefinition(
    where: {collaborationTypeId: {_eq: $typeId}, hiringStatusId: {_eq: $hiringStatusId}}
    order_by: {fieldOrder: Asc}
  ) {
    id
    fieldName
    displayName
    fieldType
    isRequired
    fieldOrder
    maxLength
    validationRegex
    helpText
    options
  }
}
    `;

export const useCollaborationFieldDefinitionsQuery = <
      TData = CollaborationFieldDefinitionsQuery,
      TError = unknown
    >(
      dataSource: { endpoint: string, fetchParams?: RequestInit },
      variables: CollaborationFieldDefinitionsQueryVariables,
      options?: Omit<UseQueryOptions<CollaborationFieldDefinitionsQuery, TError, TData>, 'queryKey'> & { queryKey?: UseQueryOptions<CollaborationFieldDefinitionsQuery, TError, TData>['queryKey'] }
    ) => {
    
    return useQuery<CollaborationFieldDefinitionsQuery, TError, TData>(
      {
    queryKey: ['CollaborationFieldDefinitions', variables],
    queryFn: fetcher<CollaborationFieldDefinitionsQuery, CollaborationFieldDefinitionsQueryVariables>(dataSource.endpoint, dataSource.fetchParams || {}, CollaborationFieldDefinitionsDocument, variables),
    ...options
  }
    )};

useCollaborationFieldDefinitionsQuery.document = CollaborationFieldDefinitionsDocument;

export const MyCollaborationResponsesDocument = `
    query MyCollaborationResponses($profileId: String1!) {
  collaborationResponse(
    where: {profileId: {_eq: $profileId}}
    order_by: {createdAt: Desc}
  ) {
    id
    collaborationPostId
    message
    contactInfo
    isPublic
    isHidden
    createdAt
    isRead
    readAt
    collaborationPost {
      id
      statusId
      collaborationProfile {
        displayName
      }
      collaborationType {
        name
      }
      hiringStatus {
        name
      }
    }
  }
}
    `;

export const useMyCollaborationResponsesQuery = <
      TData = MyCollaborationResponsesQuery,
      TError = unknown
    >(
      dataSource: { endpoint: string, fetchParams?: RequestInit },
      variables: MyCollaborationResponsesQueryVariables,
      options?: Omit<UseQueryOptions<MyCollaborationResponsesQuery, TError, TData>, 'queryKey'> & { queryKey?: UseQueryOptions<MyCollaborationResponsesQuery, TError, TData>['queryKey'] }
    ) => {
    
    return useQuery<MyCollaborationResponsesQuery, TError, TData>(
      {
    queryKey: ['MyCollaborationResponses', variables],
    queryFn: fetcher<MyCollaborationResponsesQuery, MyCollaborationResponsesQueryVariables>(dataSource.endpoint, dataSource.fetchParams || {}, MyCollaborationResponsesDocument, variables),
    ...options
  }
    )};

useMyCollaborationResponsesQuery.document = MyCollaborationResponsesDocument;

export const PostResponsesDocument = `
    query PostResponses($postId: String1!, $profileId: String1!) {
  collaborationResponse(
    where: {collaborationPostId: {_eq: $postId}, _or: [{collaborationPost: {profileId: {_eq: $profileId}}}, {isPublic: {_eq: 1}}], isHidden: {_eq: 0}}
    order_by: {createdAt: Desc}
  ) {
    id
    profileId
    message
    contactInfo
    isPublic
    createdAt
    isRead
    readAt
    collaborationProfile {
      id
      displayName
      bio
      skills
      userId
    }
  }
}
    `;

export const usePostResponsesQuery = <
      TData = PostResponsesQuery,
      TError = unknown
    >(
      dataSource: { endpoint: string, fetchParams?: RequestInit },
      variables: PostResponsesQueryVariables,
      options?: Omit<UseQueryOptions<PostResponsesQuery, TError, TData>, 'queryKey'> & { queryKey?: UseQueryOptions<PostResponsesQuery, TError, TData>['queryKey'] }
    ) => {
    
    return useQuery<PostResponsesQuery, TError, TData>(
      {
    queryKey: ['PostResponses', variables],
    queryFn: fetcher<PostResponsesQuery, PostResponsesQueryVariables>(dataSource.endpoint, dataSource.fetchParams || {}, PostResponsesDocument, variables),
    ...options
  }
    )};

usePostResponsesQuery.document = PostResponsesDocument;

export const MyBookmarksDocument = `
    query MyBookmarks($profileId: String1!) {
  collaborationBookmark(
    where: {profileId: {_eq: $profileId}}
    order_by: {createdAt: Desc}
  ) {
    id
    collaborationPostId
    createdAt
    collaborationPost {
      id
      statusId
      postedAt
      expiresAt
      viewCount
      responseCount
      tags
      collaborationProfile {
        displayName
      }
      collaborationType {
        name
      }
      hiringStatus {
        name
      }
      collaborationFieldValues {
        value
        collaborationFieldDefinition {
          fieldName
          displayName
        }
      }
    }
  }
}
    `;

export const useMyBookmarksQuery = <
      TData = MyBookmarksQuery,
      TError = unknown
    >(
      dataSource: { endpoint: string, fetchParams?: RequestInit },
      variables: MyBookmarksQueryVariables,
      options?: Omit<UseQueryOptions<MyBookmarksQuery, TError, TData>, 'queryKey'> & { queryKey?: UseQueryOptions<MyBookmarksQuery, TError, TData>['queryKey'] }
    ) => {
    
    return useQuery<MyBookmarksQuery, TError, TData>(
      {
    queryKey: ['MyBookmarks', variables],
    queryFn: fetcher<MyBookmarksQuery, MyBookmarksQueryVariables>(dataSource.endpoint, dataSource.fetchParams || {}, MyBookmarksDocument, variables),
    ...options
  }
    )};

useMyBookmarksQuery.document = MyBookmarksDocument;
