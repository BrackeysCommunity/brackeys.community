/* eslint-disable */
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  bytes: { input: any; output: any; }
  float64: { input: any; output: any; }
  int8: { input: any; output: any; }
  int32: { input: any; output: any; }
  int64: { input: any; output: any; }
  string: { input: any; output: any; }
  timestamp: { input: any; output: any; }
};

export type Mutation = {
  __typename?: 'Mutation';
  _no_fields_accessible?: Maybe<Scalars['String']['output']>;
};

export enum OrderBy {
  /** Sorts the data in ascending order */
  Asc = 'Asc',
  /** Sorts the data in descending order */
  Desc = 'Desc'
}

export type Query = {
  __typename?: 'Query';
  alt_account?: Maybe<Array<Alt_Account>>;
  alt_account_aggregate?: Maybe<Alt_Account_Agg_Exp>;
  alt_account_by_alt_account_pk?: Maybe<Alt_Account>;
  blocked_reporter?: Maybe<Array<Blocked_Reporter>>;
  blocked_reporter_aggregate?: Maybe<Blocked_Reporter_Agg_Exp>;
  blocked_reporter_by_blocked_reporter_pk?: Maybe<Blocked_Reporter>;
  deleted_message?: Maybe<Array<Deleted_Message>>;
  deleted_message_aggregate?: Maybe<Deleted_Message_Agg_Exp>;
  deleted_message_by_message_id?: Maybe<Deleted_Message>;
  infraction?: Maybe<Array<Infraction>>;
  infraction_aggregate?: Maybe<Infraction_Agg_Exp>;
  infraction_by_id?: Maybe<Infraction>;
  member_note?: Maybe<Array<Member_Note>>;
  member_note_aggregate?: Maybe<Member_Note_Agg_Exp>;
  member_note_by_id?: Maybe<Member_Note>;
  mute?: Maybe<Array<Mute>>;
  mute_aggregate?: Maybe<Mute_Agg_Exp>;
  mute_by_mute_pk?: Maybe<Mute>;
  reported_message?: Maybe<Array<Reported_Message>>;
  reported_message_aggregate?: Maybe<Reported_Message_Agg_Exp>;
  reported_message_by_id?: Maybe<Reported_Message>;
  rule?: Maybe<Array<Rule>>;
  rule_aggregate?: Maybe<Rule_Agg_Exp>;
  rule_by_rule_pk?: Maybe<Rule>;
  staff_message?: Maybe<Array<Staff_Message>>;
  staff_message_aggregate?: Maybe<Staff_Message_Agg_Exp>;
  staff_message_by_id?: Maybe<Staff_Message>;
  temporary_ban?: Maybe<Array<Temporary_Ban>>;
  temporary_ban_aggregate?: Maybe<Temporary_Ban_Agg_Exp>;
  temporary_ban_by_temporary_ban_pk?: Maybe<Temporary_Ban>;
  tracked_messages?: Maybe<Array<Tracked_Messages>>;
  tracked_messages_aggregate?: Maybe<Tracked_Messages_Agg_Exp>;
  tracked_messages_by_id?: Maybe<Tracked_Messages>;
};


export type QueryAlt_AccountArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Alt_Account_Order_By_Exp>>;
  where?: InputMaybe<Alt_Account_Bool_Exp>;
};


export type QueryAlt_Account_AggregateArgs = {
  filter_input?: InputMaybe<Alt_Account_Filter_Input>;
};


export type QueryAlt_Account_By_Alt_Account_PkArgs = {
  alt_id: Scalars['int64']['input'];
  user_id: Scalars['int64']['input'];
};


export type QueryBlocked_ReporterArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Blocked_Reporter_Order_By_Exp>>;
  where?: InputMaybe<Blocked_Reporter_Bool_Exp>;
};


export type QueryBlocked_Reporter_AggregateArgs = {
  filter_input?: InputMaybe<Blocked_Reporter_Filter_Input>;
};


export type QueryBlocked_Reporter_By_Blocked_Reporter_PkArgs = {
  guild_id: Scalars['int64']['input'];
  user_id: Scalars['int64']['input'];
};


export type QueryDeleted_MessageArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Deleted_Message_Order_By_Exp>>;
  where?: InputMaybe<Deleted_Message_Bool_Exp>;
};


export type QueryDeleted_Message_AggregateArgs = {
  filter_input?: InputMaybe<Deleted_Message_Filter_Input>;
};


export type QueryDeleted_Message_By_Message_IdArgs = {
  message_id: Scalars['int64']['input'];
};


export type QueryInfractionArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Infraction_Order_By_Exp>>;
  where?: InputMaybe<Infraction_Bool_Exp>;
};


export type QueryInfraction_AggregateArgs = {
  filter_input?: InputMaybe<Infraction_Filter_Input>;
};


export type QueryInfraction_By_IdArgs = {
  id: Scalars['int64']['input'];
};


export type QueryMember_NoteArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Member_Note_Order_By_Exp>>;
  where?: InputMaybe<Member_Note_Bool_Exp>;
};


export type QueryMember_Note_AggregateArgs = {
  filter_input?: InputMaybe<Member_Note_Filter_Input>;
};


export type QueryMember_Note_By_IdArgs = {
  id: Scalars['int64']['input'];
};


export type QueryMuteArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Mute_Order_By_Exp>>;
  where?: InputMaybe<Mute_Bool_Exp>;
};


export type QueryMute_AggregateArgs = {
  filter_input?: InputMaybe<Mute_Filter_Input>;
};


export type QueryMute_By_Mute_PkArgs = {
  guild_id: Scalars['int64']['input'];
  user_id: Scalars['int64']['input'];
};


export type QueryReported_MessageArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Reported_Message_Order_By_Exp>>;
  where?: InputMaybe<Reported_Message_Bool_Exp>;
};


export type QueryReported_Message_AggregateArgs = {
  filter_input?: InputMaybe<Reported_Message_Filter_Input>;
};


export type QueryReported_Message_By_IdArgs = {
  id: Scalars['int64']['input'];
};


export type QueryRuleArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Rule_Order_By_Exp>>;
  where?: InputMaybe<Rule_Bool_Exp>;
};


export type QueryRule_AggregateArgs = {
  filter_input?: InputMaybe<Rule_Filter_Input>;
};


export type QueryRule_By_Rule_PkArgs = {
  guild_id: Scalars['int64']['input'];
  id: Scalars['int32']['input'];
};


export type QueryStaff_MessageArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Staff_Message_Order_By_Exp>>;
  where?: InputMaybe<Staff_Message_Bool_Exp>;
};


export type QueryStaff_Message_AggregateArgs = {
  filter_input?: InputMaybe<Staff_Message_Filter_Input>;
};


export type QueryStaff_Message_By_IdArgs = {
  id: Scalars['int64']['input'];
};


export type QueryTemporary_BanArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Temporary_Ban_Order_By_Exp>>;
  where?: InputMaybe<Temporary_Ban_Bool_Exp>;
};


export type QueryTemporary_Ban_AggregateArgs = {
  filter_input?: InputMaybe<Temporary_Ban_Filter_Input>;
};


export type QueryTemporary_Ban_By_Temporary_Ban_PkArgs = {
  guild_id: Scalars['int64']['input'];
  user_id: Scalars['int64']['input'];
};


export type QueryTracked_MessagesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Tracked_Messages_Order_By_Exp>>;
  where?: InputMaybe<Tracked_Messages_Bool_Exp>;
};


export type QueryTracked_Messages_AggregateArgs = {
  filter_input?: InputMaybe<Tracked_Messages_Filter_Input>;
};


export type QueryTracked_Messages_By_IdArgs = {
  id: Scalars['int64']['input'];
};

export type Subscription = {
  __typename?: 'Subscription';
  alt_account?: Maybe<Array<Alt_Account>>;
  alt_account_aggregate?: Maybe<Alt_Account_Agg_Exp>;
  alt_account_by_alt_account_pk?: Maybe<Alt_Account>;
  blocked_reporter?: Maybe<Array<Blocked_Reporter>>;
  blocked_reporter_aggregate?: Maybe<Blocked_Reporter_Agg_Exp>;
  blocked_reporter_by_blocked_reporter_pk?: Maybe<Blocked_Reporter>;
  deleted_message?: Maybe<Array<Deleted_Message>>;
  deleted_message_aggregate?: Maybe<Deleted_Message_Agg_Exp>;
  deleted_message_by_message_id?: Maybe<Deleted_Message>;
  infraction?: Maybe<Array<Infraction>>;
  infraction_aggregate?: Maybe<Infraction_Agg_Exp>;
  infraction_by_id?: Maybe<Infraction>;
  member_note?: Maybe<Array<Member_Note>>;
  member_note_aggregate?: Maybe<Member_Note_Agg_Exp>;
  member_note_by_id?: Maybe<Member_Note>;
  mute?: Maybe<Array<Mute>>;
  mute_aggregate?: Maybe<Mute_Agg_Exp>;
  mute_by_mute_pk?: Maybe<Mute>;
  reported_message?: Maybe<Array<Reported_Message>>;
  reported_message_aggregate?: Maybe<Reported_Message_Agg_Exp>;
  reported_message_by_id?: Maybe<Reported_Message>;
  rule?: Maybe<Array<Rule>>;
  rule_aggregate?: Maybe<Rule_Agg_Exp>;
  rule_by_rule_pk?: Maybe<Rule>;
  staff_message?: Maybe<Array<Staff_Message>>;
  staff_message_aggregate?: Maybe<Staff_Message_Agg_Exp>;
  staff_message_by_id?: Maybe<Staff_Message>;
  temporary_ban?: Maybe<Array<Temporary_Ban>>;
  temporary_ban_aggregate?: Maybe<Temporary_Ban_Agg_Exp>;
  temporary_ban_by_temporary_ban_pk?: Maybe<Temporary_Ban>;
  tracked_messages?: Maybe<Array<Tracked_Messages>>;
  tracked_messages_aggregate?: Maybe<Tracked_Messages_Agg_Exp>;
  tracked_messages_by_id?: Maybe<Tracked_Messages>;
};


export type SubscriptionAlt_AccountArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Alt_Account_Order_By_Exp>>;
  where?: InputMaybe<Alt_Account_Bool_Exp>;
};


export type SubscriptionAlt_Account_AggregateArgs = {
  filter_input?: InputMaybe<Alt_Account_Filter_Input>;
};


export type SubscriptionAlt_Account_By_Alt_Account_PkArgs = {
  alt_id: Scalars['int64']['input'];
  user_id: Scalars['int64']['input'];
};


export type SubscriptionBlocked_ReporterArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Blocked_Reporter_Order_By_Exp>>;
  where?: InputMaybe<Blocked_Reporter_Bool_Exp>;
};


export type SubscriptionBlocked_Reporter_AggregateArgs = {
  filter_input?: InputMaybe<Blocked_Reporter_Filter_Input>;
};


export type SubscriptionBlocked_Reporter_By_Blocked_Reporter_PkArgs = {
  guild_id: Scalars['int64']['input'];
  user_id: Scalars['int64']['input'];
};


export type SubscriptionDeleted_MessageArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Deleted_Message_Order_By_Exp>>;
  where?: InputMaybe<Deleted_Message_Bool_Exp>;
};


export type SubscriptionDeleted_Message_AggregateArgs = {
  filter_input?: InputMaybe<Deleted_Message_Filter_Input>;
};


export type SubscriptionDeleted_Message_By_Message_IdArgs = {
  message_id: Scalars['int64']['input'];
};


export type SubscriptionInfractionArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Infraction_Order_By_Exp>>;
  where?: InputMaybe<Infraction_Bool_Exp>;
};


export type SubscriptionInfraction_AggregateArgs = {
  filter_input?: InputMaybe<Infraction_Filter_Input>;
};


export type SubscriptionInfraction_By_IdArgs = {
  id: Scalars['int64']['input'];
};


export type SubscriptionMember_NoteArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Member_Note_Order_By_Exp>>;
  where?: InputMaybe<Member_Note_Bool_Exp>;
};


export type SubscriptionMember_Note_AggregateArgs = {
  filter_input?: InputMaybe<Member_Note_Filter_Input>;
};


export type SubscriptionMember_Note_By_IdArgs = {
  id: Scalars['int64']['input'];
};


export type SubscriptionMuteArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Mute_Order_By_Exp>>;
  where?: InputMaybe<Mute_Bool_Exp>;
};


export type SubscriptionMute_AggregateArgs = {
  filter_input?: InputMaybe<Mute_Filter_Input>;
};


export type SubscriptionMute_By_Mute_PkArgs = {
  guild_id: Scalars['int64']['input'];
  user_id: Scalars['int64']['input'];
};


export type SubscriptionReported_MessageArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Reported_Message_Order_By_Exp>>;
  where?: InputMaybe<Reported_Message_Bool_Exp>;
};


export type SubscriptionReported_Message_AggregateArgs = {
  filter_input?: InputMaybe<Reported_Message_Filter_Input>;
};


export type SubscriptionReported_Message_By_IdArgs = {
  id: Scalars['int64']['input'];
};


export type SubscriptionRuleArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Rule_Order_By_Exp>>;
  where?: InputMaybe<Rule_Bool_Exp>;
};


export type SubscriptionRule_AggregateArgs = {
  filter_input?: InputMaybe<Rule_Filter_Input>;
};


export type SubscriptionRule_By_Rule_PkArgs = {
  guild_id: Scalars['int64']['input'];
  id: Scalars['int32']['input'];
};


export type SubscriptionStaff_MessageArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Staff_Message_Order_By_Exp>>;
  where?: InputMaybe<Staff_Message_Bool_Exp>;
};


export type SubscriptionStaff_Message_AggregateArgs = {
  filter_input?: InputMaybe<Staff_Message_Filter_Input>;
};


export type SubscriptionStaff_Message_By_IdArgs = {
  id: Scalars['int64']['input'];
};


export type SubscriptionTemporary_BanArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Temporary_Ban_Order_By_Exp>>;
  where?: InputMaybe<Temporary_Ban_Bool_Exp>;
};


export type SubscriptionTemporary_Ban_AggregateArgs = {
  filter_input?: InputMaybe<Temporary_Ban_Filter_Input>;
};


export type SubscriptionTemporary_Ban_By_Temporary_Ban_PkArgs = {
  guild_id: Scalars['int64']['input'];
  user_id: Scalars['int64']['input'];
};


export type SubscriptionTracked_MessagesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Tracked_Messages_Order_By_Exp>>;
  where?: InputMaybe<Tracked_Messages_Bool_Exp>;
};


export type SubscriptionTracked_Messages_AggregateArgs = {
  filter_input?: InputMaybe<Tracked_Messages_Filter_Input>;
};


export type SubscriptionTracked_Messages_By_IdArgs = {
  id: Scalars['int64']['input'];
};

export type Alt_Account = {
  __typename?: 'alt_account';
  alt_id: Scalars['int64']['output'];
  /** All infractions for the alt account */
  alt_user_infractions?: Maybe<Array<Infraction>>;
  /** All infractions for the main user account */
  main_user_infractions?: Maybe<Array<Infraction>>;
  registered_at: Scalars['timestamp']['output'];
  staff_member_id: Scalars['int64']['output'];
  user_id: Scalars['int64']['output'];
};


export type Alt_AccountAlt_User_InfractionsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Infraction_Order_By_Exp>>;
  where?: InputMaybe<Infraction_Bool_Exp>;
};


export type Alt_AccountMain_User_InfractionsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Infraction_Order_By_Exp>>;
  where?: InputMaybe<Infraction_Bool_Exp>;
};

export type Alt_Account_Agg_Exp = {
  __typename?: 'alt_account_agg_exp';
  _count: Scalars['Int']['output'];
  alt_id: Int64_Agg_Exp;
  registered_at: Timestamp_Agg_Exp;
  staff_member_id: Int64_Agg_Exp;
  user_id: Int64_Agg_Exp;
};

export type Alt_Account_Bool_Exp = {
  _and?: InputMaybe<Array<Alt_Account_Bool_Exp>>;
  _not?: InputMaybe<Alt_Account_Bool_Exp>;
  _or?: InputMaybe<Array<Alt_Account_Bool_Exp>>;
  alt_id?: InputMaybe<Int64_Bool_Exp>;
  registered_at?: InputMaybe<Timestamp_Bool_Exp>;
  staff_member_id?: InputMaybe<Int64_Bool_Exp>;
  user_id?: InputMaybe<Int64_Bool_Exp>;
};

export type Alt_Account_Filter_Input = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Alt_Account_Order_By_Exp>>;
  where?: InputMaybe<Alt_Account_Bool_Exp>;
};

export type Alt_Account_Order_By_Exp = {
  alt_id?: InputMaybe<OrderBy>;
  registered_at?: InputMaybe<OrderBy>;
  staff_member_id?: InputMaybe<OrderBy>;
  user_id?: InputMaybe<OrderBy>;
};

export type Blocked_Reporter = {
  __typename?: 'blocked_reporter';
  blocked_at: Scalars['timestamp']['output'];
  guild_id: Scalars['int64']['output'];
  staff_member_id: Scalars['int64']['output'];
  user_id: Scalars['int64']['output'];
  /** All infractions for this blocked reporter */
  user_infractions?: Maybe<Array<Infraction>>;
  /** All reports made by this blocked user */
  user_reports?: Maybe<Array<Reported_Message>>;
};


export type Blocked_ReporterUser_InfractionsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Infraction_Order_By_Exp>>;
  where?: InputMaybe<Infraction_Bool_Exp>;
};


export type Blocked_ReporterUser_ReportsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Reported_Message_Order_By_Exp>>;
  where?: InputMaybe<Reported_Message_Bool_Exp>;
};

export type Blocked_Reporter_Agg_Exp = {
  __typename?: 'blocked_reporter_agg_exp';
  _count: Scalars['Int']['output'];
  blocked_at: Timestamp_Agg_Exp;
  guild_id: Int64_Agg_Exp;
  staff_member_id: Int64_Agg_Exp;
  user_id: Int64_Agg_Exp;
};

export type Blocked_Reporter_Bool_Exp = {
  _and?: InputMaybe<Array<Blocked_Reporter_Bool_Exp>>;
  _not?: InputMaybe<Blocked_Reporter_Bool_Exp>;
  _or?: InputMaybe<Array<Blocked_Reporter_Bool_Exp>>;
  blocked_at?: InputMaybe<Timestamp_Bool_Exp>;
  guild_id?: InputMaybe<Int64_Bool_Exp>;
  staff_member_id?: InputMaybe<Int64_Bool_Exp>;
  user_id?: InputMaybe<Int64_Bool_Exp>;
};

export type Blocked_Reporter_Filter_Input = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Blocked_Reporter_Order_By_Exp>>;
  where?: InputMaybe<Blocked_Reporter_Bool_Exp>;
};

export type Blocked_Reporter_Order_By_Exp = {
  blocked_at?: InputMaybe<OrderBy>;
  guild_id?: InputMaybe<OrderBy>;
  staff_member_id?: InputMaybe<OrderBy>;
  user_id?: InputMaybe<OrderBy>;
};

export type Bytes_Agg_Exp = {
  __typename?: 'bytes_agg_exp';
  _count: Scalars['Int']['output'];
  _count_distinct: Scalars['Int']['output'];
};

export type Bytes_Bool_Exp = {
  _and?: InputMaybe<Array<Bytes_Bool_Exp>>;
  _eq?: InputMaybe<Scalars['bytes']['input']>;
  _is_null?: InputMaybe<Scalars['Boolean']['input']>;
  _not?: InputMaybe<Bytes_Bool_Exp>;
  _or?: InputMaybe<Array<Bytes_Bool_Exp>>;
};

export type Deleted_Message = {
  __typename?: 'deleted_message';
  added_by_bot: Scalars['string']['output'];
  attachments: Scalars['bytes']['output'];
  author_id: Scalars['int64']['output'];
  /** All infractions for the author of this deleted message */
  author_infractions?: Maybe<Array<Infraction>>;
  channel_id: Scalars['int64']['output'];
  content?: Maybe<Scalars['string']['output']>;
  creation_timestamp: Scalars['timestamp']['output'];
  deletion_timestamp: Scalars['timestamp']['output'];
  guild_id: Scalars['int64']['output'];
  message_id: Scalars['int64']['output'];
  /** The original tracked message that was deleted */
  original_tracked_message?: Maybe<Tracked_Messages>;
  /** All reports made against this deleted message */
  reports?: Maybe<Array<Reported_Message>>;
  staff_member_id: Scalars['int64']['output'];
};


export type Deleted_MessageAuthor_InfractionsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Infraction_Order_By_Exp>>;
  where?: InputMaybe<Infraction_Bool_Exp>;
};


export type Deleted_MessageReportsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Reported_Message_Order_By_Exp>>;
  where?: InputMaybe<Reported_Message_Bool_Exp>;
};

export type Deleted_Message_Agg_Exp = {
  __typename?: 'deleted_message_agg_exp';
  _count: Scalars['Int']['output'];
  added_by_bot: String_Agg_Exp;
  attachments: Bytes_Agg_Exp;
  author_id: Int64_Agg_Exp;
  channel_id: Int64_Agg_Exp;
  content: String_Agg_Exp;
  creation_timestamp: Timestamp_Agg_Exp;
  deletion_timestamp: Timestamp_Agg_Exp;
  guild_id: Int64_Agg_Exp;
  message_id: Int64_Agg_Exp;
  staff_member_id: Int64_Agg_Exp;
};

export type Deleted_Message_Bool_Exp = {
  _and?: InputMaybe<Array<Deleted_Message_Bool_Exp>>;
  _not?: InputMaybe<Deleted_Message_Bool_Exp>;
  _or?: InputMaybe<Array<Deleted_Message_Bool_Exp>>;
  added_by_bot?: InputMaybe<String_Bool_Exp>;
  attachments?: InputMaybe<Bytes_Bool_Exp>;
  author_id?: InputMaybe<Int64_Bool_Exp>;
  channel_id?: InputMaybe<Int64_Bool_Exp>;
  content?: InputMaybe<String_Bool_Exp>;
  creation_timestamp?: InputMaybe<Timestamp_Bool_Exp>;
  deletion_timestamp?: InputMaybe<Timestamp_Bool_Exp>;
  guild_id?: InputMaybe<Int64_Bool_Exp>;
  message_id?: InputMaybe<Int64_Bool_Exp>;
  staff_member_id?: InputMaybe<Int64_Bool_Exp>;
};

export type Deleted_Message_Filter_Input = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Deleted_Message_Order_By_Exp>>;
  where?: InputMaybe<Deleted_Message_Bool_Exp>;
};

export type Deleted_Message_Order_By_Exp = {
  added_by_bot?: InputMaybe<OrderBy>;
  attachments?: InputMaybe<OrderBy>;
  author_id?: InputMaybe<OrderBy>;
  channel_id?: InputMaybe<OrderBy>;
  content?: InputMaybe<OrderBy>;
  creation_timestamp?: InputMaybe<OrderBy>;
  deletion_timestamp?: InputMaybe<OrderBy>;
  guild_id?: InputMaybe<OrderBy>;
  message_id?: InputMaybe<OrderBy>;
  original_tracked_message?: InputMaybe<Tracked_Messages_Order_By_Exp>;
  staff_member_id?: InputMaybe<OrderBy>;
};

export type Infraction = {
  __typename?: 'infraction';
  additional_information?: Maybe<Scalars['string']['output']>;
  guild_id: Scalars['int64']['output'];
  id: Scalars['int64']['output'];
  issued_at: Scalars['timestamp']['output'];
  /** Member notes for the user who received this infraction */
  member_notes?: Maybe<Array<Member_Note>>;
  reason?: Maybe<Scalars['string']['output']>;
  /** The rule that was violated in this infraction */
  rule?: Maybe<Rule>;
  rule_id?: Maybe<Scalars['int32']['output']>;
  rule_text?: Maybe<Scalars['string']['output']>;
  staff_member_id: Scalars['int64']['output'];
  type: Scalars['int32']['output'];
  user_id: Scalars['int64']['output'];
};


export type InfractionMember_NotesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Member_Note_Order_By_Exp>>;
  where?: InputMaybe<Member_Note_Bool_Exp>;
};

export type Infraction_Agg_Exp = {
  __typename?: 'infraction_agg_exp';
  _count: Scalars['Int']['output'];
  additional_information: String_Agg_Exp;
  guild_id: Int64_Agg_Exp;
  id: Int64_Agg_Exp;
  issued_at: Timestamp_Agg_Exp;
  reason: String_Agg_Exp;
  rule_id: Int32_Agg_Exp;
  rule_text: String_Agg_Exp;
  staff_member_id: Int64_Agg_Exp;
  type: Int32_Agg_Exp;
  user_id: Int64_Agg_Exp;
};

export type Infraction_Bool_Exp = {
  _and?: InputMaybe<Array<Infraction_Bool_Exp>>;
  _not?: InputMaybe<Infraction_Bool_Exp>;
  _or?: InputMaybe<Array<Infraction_Bool_Exp>>;
  additional_information?: InputMaybe<String_Bool_Exp>;
  guild_id?: InputMaybe<Int64_Bool_Exp>;
  id?: InputMaybe<Int64_Bool_Exp>;
  issued_at?: InputMaybe<Timestamp_Bool_Exp>;
  reason?: InputMaybe<String_Bool_Exp>;
  rule_id?: InputMaybe<Int32_Bool_Exp>;
  rule_text?: InputMaybe<String_Bool_Exp>;
  staff_member_id?: InputMaybe<Int64_Bool_Exp>;
  type?: InputMaybe<Int32_Bool_Exp>;
  user_id?: InputMaybe<Int64_Bool_Exp>;
};

export type Infraction_Filter_Input = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Infraction_Order_By_Exp>>;
  where?: InputMaybe<Infraction_Bool_Exp>;
};

export type Infraction_Order_By_Exp = {
  additional_information?: InputMaybe<OrderBy>;
  guild_id?: InputMaybe<OrderBy>;
  id?: InputMaybe<OrderBy>;
  issued_at?: InputMaybe<OrderBy>;
  reason?: InputMaybe<OrderBy>;
  rule?: InputMaybe<Rule_Order_By_Exp>;
  rule_id?: InputMaybe<OrderBy>;
  rule_text?: InputMaybe<OrderBy>;
  staff_member_id?: InputMaybe<OrderBy>;
  type?: InputMaybe<OrderBy>;
  user_id?: InputMaybe<OrderBy>;
};

export type Int8_Agg_Exp = {
  __typename?: 'int8_agg_exp';
  _count: Scalars['Int']['output'];
  _count_distinct: Scalars['Int']['output'];
  avg: Scalars['float64']['output'];
  max: Scalars['int8']['output'];
  min: Scalars['int8']['output'];
  sum: Scalars['int64']['output'];
};

export type Int8_Bool_Exp = {
  _and?: InputMaybe<Array<Int8_Bool_Exp>>;
  _eq?: InputMaybe<Scalars['int8']['input']>;
  _gt?: InputMaybe<Scalars['int8']['input']>;
  _gte?: InputMaybe<Scalars['int8']['input']>;
  _in?: InputMaybe<Array<Scalars['int8']['input']>>;
  _is_null?: InputMaybe<Scalars['Boolean']['input']>;
  _lt?: InputMaybe<Scalars['int8']['input']>;
  _lte?: InputMaybe<Scalars['int8']['input']>;
  _not?: InputMaybe<Int8_Bool_Exp>;
  _or?: InputMaybe<Array<Int8_Bool_Exp>>;
};

export type Int32_Agg_Exp = {
  __typename?: 'int32_agg_exp';
  _count: Scalars['Int']['output'];
  _count_distinct: Scalars['Int']['output'];
  avg: Scalars['float64']['output'];
  max: Scalars['int32']['output'];
  min: Scalars['int32']['output'];
  sum: Scalars['int64']['output'];
};

export type Int32_Bool_Exp = {
  _and?: InputMaybe<Array<Int32_Bool_Exp>>;
  _eq?: InputMaybe<Scalars['int32']['input']>;
  _gt?: InputMaybe<Scalars['int32']['input']>;
  _gte?: InputMaybe<Scalars['int32']['input']>;
  _in?: InputMaybe<Array<Scalars['int32']['input']>>;
  _is_null?: InputMaybe<Scalars['Boolean']['input']>;
  _lt?: InputMaybe<Scalars['int32']['input']>;
  _lte?: InputMaybe<Scalars['int32']['input']>;
  _not?: InputMaybe<Int32_Bool_Exp>;
  _or?: InputMaybe<Array<Int32_Bool_Exp>>;
};

export type Int64_Agg_Exp = {
  __typename?: 'int64_agg_exp';
  _count: Scalars['Int']['output'];
  _count_distinct: Scalars['Int']['output'];
  avg: Scalars['float64']['output'];
  max: Scalars['int64']['output'];
  min: Scalars['int64']['output'];
  sum: Scalars['int64']['output'];
};

export type Int64_Bool_Exp = {
  _and?: InputMaybe<Array<Int64_Bool_Exp>>;
  _eq?: InputMaybe<Scalars['int64']['input']>;
  _gt?: InputMaybe<Scalars['int64']['input']>;
  _gte?: InputMaybe<Scalars['int64']['input']>;
  _in?: InputMaybe<Array<Scalars['int64']['input']>>;
  _is_null?: InputMaybe<Scalars['Boolean']['input']>;
  _lt?: InputMaybe<Scalars['int64']['input']>;
  _lte?: InputMaybe<Scalars['int64']['input']>;
  _not?: InputMaybe<Int64_Bool_Exp>;
  _or?: InputMaybe<Array<Int64_Bool_Exp>>;
};

export type Member_Note = {
  __typename?: 'member_note';
  author_id: Scalars['int64']['output'];
  content: Scalars['string']['output'];
  creation_timestamp: Scalars['timestamp']['output'];
  guild_id: Scalars['int64']['output'];
  id: Scalars['int64']['output'];
  type: Scalars['int32']['output'];
  user_id: Scalars['int64']['output'];
  /** All infractions for the user this note is about */
  user_infractions?: Maybe<Array<Infraction>>;
  /** Current mute status for the user this note is about */
  user_mute?: Maybe<Mute>;
  /** Current temporary ban status for the user this note is about */
  user_temporary_ban?: Maybe<Temporary_Ban>;
};


export type Member_NoteUser_InfractionsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Infraction_Order_By_Exp>>;
  where?: InputMaybe<Infraction_Bool_Exp>;
};

export type Member_Note_Agg_Exp = {
  __typename?: 'member_note_agg_exp';
  _count: Scalars['Int']['output'];
  author_id: Int64_Agg_Exp;
  content: String_Agg_Exp;
  creation_timestamp: Timestamp_Agg_Exp;
  guild_id: Int64_Agg_Exp;
  id: Int64_Agg_Exp;
  type: Int32_Agg_Exp;
  user_id: Int64_Agg_Exp;
};

export type Member_Note_Bool_Exp = {
  _and?: InputMaybe<Array<Member_Note_Bool_Exp>>;
  _not?: InputMaybe<Member_Note_Bool_Exp>;
  _or?: InputMaybe<Array<Member_Note_Bool_Exp>>;
  author_id?: InputMaybe<Int64_Bool_Exp>;
  content?: InputMaybe<String_Bool_Exp>;
  creation_timestamp?: InputMaybe<Timestamp_Bool_Exp>;
  guild_id?: InputMaybe<Int64_Bool_Exp>;
  id?: InputMaybe<Int64_Bool_Exp>;
  type?: InputMaybe<Int32_Bool_Exp>;
  user_id?: InputMaybe<Int64_Bool_Exp>;
};

export type Member_Note_Filter_Input = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Member_Note_Order_By_Exp>>;
  where?: InputMaybe<Member_Note_Bool_Exp>;
};

export type Member_Note_Order_By_Exp = {
  author_id?: InputMaybe<OrderBy>;
  content?: InputMaybe<OrderBy>;
  creation_timestamp?: InputMaybe<OrderBy>;
  guild_id?: InputMaybe<OrderBy>;
  id?: InputMaybe<OrderBy>;
  type?: InputMaybe<OrderBy>;
  user_id?: InputMaybe<OrderBy>;
  user_mute?: InputMaybe<Mute_Order_By_Exp>;
  user_temporary_ban?: InputMaybe<Temporary_Ban_Order_By_Exp>;
};

export type Mute = {
  __typename?: 'mute';
  expires_at?: Maybe<Scalars['timestamp']['output']>;
  guild_id: Scalars['int64']['output'];
  user_id: Scalars['int64']['output'];
  /** All infractions for the muted user */
  user_infractions?: Maybe<Array<Infraction>>;
  /** All member notes for the muted user */
  user_notes?: Maybe<Array<Member_Note>>;
};


export type MuteUser_InfractionsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Infraction_Order_By_Exp>>;
  where?: InputMaybe<Infraction_Bool_Exp>;
};


export type MuteUser_NotesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Member_Note_Order_By_Exp>>;
  where?: InputMaybe<Member_Note_Bool_Exp>;
};

export type Mute_Agg_Exp = {
  __typename?: 'mute_agg_exp';
  _count: Scalars['Int']['output'];
  expires_at: Timestamp_Agg_Exp;
  guild_id: Int64_Agg_Exp;
  user_id: Int64_Agg_Exp;
};

export type Mute_Bool_Exp = {
  _and?: InputMaybe<Array<Mute_Bool_Exp>>;
  _not?: InputMaybe<Mute_Bool_Exp>;
  _or?: InputMaybe<Array<Mute_Bool_Exp>>;
  expires_at?: InputMaybe<Timestamp_Bool_Exp>;
  guild_id?: InputMaybe<Int64_Bool_Exp>;
  user_id?: InputMaybe<Int64_Bool_Exp>;
};

export type Mute_Filter_Input = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Mute_Order_By_Exp>>;
  where?: InputMaybe<Mute_Bool_Exp>;
};

export type Mute_Order_By_Exp = {
  expires_at?: InputMaybe<OrderBy>;
  guild_id?: InputMaybe<OrderBy>;
  user_id?: InputMaybe<OrderBy>;
};

export type Reported_Message = {
  __typename?: 'reported_message';
  attachments: Scalars['bytes']['output'];
  author_id: Scalars['int64']['output'];
  channel_id: Scalars['int64']['output'];
  content?: Maybe<Scalars['string']['output']>;
  /** The deleted message record if this reported message was deleted */
  deleted_message?: Maybe<Deleted_Message>;
  guild_id: Scalars['int64']['output'];
  id: Scalars['int64']['output'];
  message_id: Scalars['int64']['output'];
  /** Check if the reporter is blocked from making reports */
  reporter_blocked_status?: Maybe<Blocked_Reporter>;
  reporter_id: Scalars['int64']['output'];
  /** The original tracked message that was reported */
  tracked_message?: Maybe<Tracked_Messages>;
};

export type Reported_Message_Agg_Exp = {
  __typename?: 'reported_message_agg_exp';
  _count: Scalars['Int']['output'];
  attachments: Bytes_Agg_Exp;
  author_id: Int64_Agg_Exp;
  channel_id: Int64_Agg_Exp;
  content: String_Agg_Exp;
  guild_id: Int64_Agg_Exp;
  id: Int64_Agg_Exp;
  message_id: Int64_Agg_Exp;
  reporter_id: Int64_Agg_Exp;
};

export type Reported_Message_Bool_Exp = {
  _and?: InputMaybe<Array<Reported_Message_Bool_Exp>>;
  _not?: InputMaybe<Reported_Message_Bool_Exp>;
  _or?: InputMaybe<Array<Reported_Message_Bool_Exp>>;
  attachments?: InputMaybe<Bytes_Bool_Exp>;
  author_id?: InputMaybe<Int64_Bool_Exp>;
  channel_id?: InputMaybe<Int64_Bool_Exp>;
  content?: InputMaybe<String_Bool_Exp>;
  guild_id?: InputMaybe<Int64_Bool_Exp>;
  id?: InputMaybe<Int64_Bool_Exp>;
  message_id?: InputMaybe<Int64_Bool_Exp>;
  reporter_id?: InputMaybe<Int64_Bool_Exp>;
};

export type Reported_Message_Filter_Input = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Reported_Message_Order_By_Exp>>;
  where?: InputMaybe<Reported_Message_Bool_Exp>;
};

export type Reported_Message_Order_By_Exp = {
  attachments?: InputMaybe<OrderBy>;
  author_id?: InputMaybe<OrderBy>;
  channel_id?: InputMaybe<OrderBy>;
  content?: InputMaybe<OrderBy>;
  deleted_message?: InputMaybe<Deleted_Message_Order_By_Exp>;
  guild_id?: InputMaybe<OrderBy>;
  id?: InputMaybe<OrderBy>;
  message_id?: InputMaybe<OrderBy>;
  reporter_blocked_status?: InputMaybe<Blocked_Reporter_Order_By_Exp>;
  reporter_id?: InputMaybe<OrderBy>;
  tracked_message?: InputMaybe<Tracked_Messages_Order_By_Exp>;
};

export type Rule = {
  __typename?: 'rule';
  brief?: Maybe<Scalars['string']['output']>;
  description: Scalars['string']['output'];
  guild_id: Scalars['int64']['output'];
  id: Scalars['int32']['output'];
  /** All infractions that cite this rule */
  infractions?: Maybe<Array<Infraction>>;
};


export type RuleInfractionsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Infraction_Order_By_Exp>>;
  where?: InputMaybe<Infraction_Bool_Exp>;
};

export type Rule_Agg_Exp = {
  __typename?: 'rule_agg_exp';
  _count: Scalars['Int']['output'];
  brief: String_Agg_Exp;
  description: String_Agg_Exp;
  guild_id: Int64_Agg_Exp;
  id: Int32_Agg_Exp;
};

export type Rule_Bool_Exp = {
  _and?: InputMaybe<Array<Rule_Bool_Exp>>;
  _not?: InputMaybe<Rule_Bool_Exp>;
  _or?: InputMaybe<Array<Rule_Bool_Exp>>;
  brief?: InputMaybe<String_Bool_Exp>;
  description?: InputMaybe<String_Bool_Exp>;
  guild_id?: InputMaybe<Int64_Bool_Exp>;
  id?: InputMaybe<Int32_Bool_Exp>;
};

export type Rule_Filter_Input = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Rule_Order_By_Exp>>;
  where?: InputMaybe<Rule_Bool_Exp>;
};

export type Rule_Order_By_Exp = {
  brief?: InputMaybe<OrderBy>;
  description?: InputMaybe<OrderBy>;
  guild_id?: InputMaybe<OrderBy>;
  id?: InputMaybe<OrderBy>;
};

export type Staff_Message = {
  __typename?: 'staff_message';
  content: Scalars['string']['output'];
  guild_id: Scalars['int64']['output'];
  id: Scalars['int64']['output'];
  recipient_id: Scalars['int64']['output'];
  /** All infractions for the message recipient */
  recipient_infractions?: Maybe<Array<Infraction>>;
  /** All member notes for the message recipient */
  recipient_notes?: Maybe<Array<Member_Note>>;
  sent_at: Scalars['timestamp']['output'];
  staff_member_id: Scalars['int64']['output'];
};


export type Staff_MessageRecipient_InfractionsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Infraction_Order_By_Exp>>;
  where?: InputMaybe<Infraction_Bool_Exp>;
};


export type Staff_MessageRecipient_NotesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Member_Note_Order_By_Exp>>;
  where?: InputMaybe<Member_Note_Bool_Exp>;
};

export type Staff_Message_Agg_Exp = {
  __typename?: 'staff_message_agg_exp';
  _count: Scalars['Int']['output'];
  content: String_Agg_Exp;
  guild_id: Int64_Agg_Exp;
  id: Int64_Agg_Exp;
  recipient_id: Int64_Agg_Exp;
  sent_at: Timestamp_Agg_Exp;
  staff_member_id: Int64_Agg_Exp;
};

export type Staff_Message_Bool_Exp = {
  _and?: InputMaybe<Array<Staff_Message_Bool_Exp>>;
  _not?: InputMaybe<Staff_Message_Bool_Exp>;
  _or?: InputMaybe<Array<Staff_Message_Bool_Exp>>;
  content?: InputMaybe<String_Bool_Exp>;
  guild_id?: InputMaybe<Int64_Bool_Exp>;
  id?: InputMaybe<Int64_Bool_Exp>;
  recipient_id?: InputMaybe<Int64_Bool_Exp>;
  sent_at?: InputMaybe<Timestamp_Bool_Exp>;
  staff_member_id?: InputMaybe<Int64_Bool_Exp>;
};

export type Staff_Message_Filter_Input = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Staff_Message_Order_By_Exp>>;
  where?: InputMaybe<Staff_Message_Bool_Exp>;
};

export type Staff_Message_Order_By_Exp = {
  content?: InputMaybe<OrderBy>;
  guild_id?: InputMaybe<OrderBy>;
  id?: InputMaybe<OrderBy>;
  recipient_id?: InputMaybe<OrderBy>;
  sent_at?: InputMaybe<OrderBy>;
  staff_member_id?: InputMaybe<OrderBy>;
};

export type String_Agg_Exp = {
  __typename?: 'string_agg_exp';
  _count: Scalars['Int']['output'];
  _count_distinct: Scalars['Int']['output'];
  max: Scalars['string']['output'];
  min: Scalars['string']['output'];
};

export type String_Bool_Exp = {
  _and?: InputMaybe<Array<String_Bool_Exp>>;
  _contains?: InputMaybe<Scalars['string']['input']>;
  _eq?: InputMaybe<Scalars['string']['input']>;
  _in?: InputMaybe<Array<Scalars['string']['input']>>;
  _is_null?: InputMaybe<Scalars['Boolean']['input']>;
  _like?: InputMaybe<Scalars['string']['input']>;
  _not?: InputMaybe<String_Bool_Exp>;
  _or?: InputMaybe<Array<String_Bool_Exp>>;
};

export type Temporary_Ban = {
  __typename?: 'temporary_ban';
  expires_at: Scalars['timestamp']['output'];
  guild_id: Scalars['int64']['output'];
  user_id: Scalars['int64']['output'];
  /** All infractions for the temporarily banned user */
  user_infractions?: Maybe<Array<Infraction>>;
  /** All member notes for the temporarily banned user */
  user_notes?: Maybe<Array<Member_Note>>;
};


export type Temporary_BanUser_InfractionsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Infraction_Order_By_Exp>>;
  where?: InputMaybe<Infraction_Bool_Exp>;
};


export type Temporary_BanUser_NotesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Member_Note_Order_By_Exp>>;
  where?: InputMaybe<Member_Note_Bool_Exp>;
};

export type Temporary_Ban_Agg_Exp = {
  __typename?: 'temporary_ban_agg_exp';
  _count: Scalars['Int']['output'];
  expires_at: Timestamp_Agg_Exp;
  guild_id: Int64_Agg_Exp;
  user_id: Int64_Agg_Exp;
};

export type Temporary_Ban_Bool_Exp = {
  _and?: InputMaybe<Array<Temporary_Ban_Bool_Exp>>;
  _not?: InputMaybe<Temporary_Ban_Bool_Exp>;
  _or?: InputMaybe<Array<Temporary_Ban_Bool_Exp>>;
  expires_at?: InputMaybe<Timestamp_Bool_Exp>;
  guild_id?: InputMaybe<Int64_Bool_Exp>;
  user_id?: InputMaybe<Int64_Bool_Exp>;
};

export type Temporary_Ban_Filter_Input = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Temporary_Ban_Order_By_Exp>>;
  where?: InputMaybe<Temporary_Ban_Bool_Exp>;
};

export type Temporary_Ban_Order_By_Exp = {
  expires_at?: InputMaybe<OrderBy>;
  guild_id?: InputMaybe<OrderBy>;
  user_id?: InputMaybe<OrderBy>;
};

export type Timestamp_Agg_Exp = {
  __typename?: 'timestamp_agg_exp';
  _count: Scalars['Int']['output'];
  _count_distinct: Scalars['Int']['output'];
};

export type Timestamp_Bool_Exp = {
  _and?: InputMaybe<Array<Timestamp_Bool_Exp>>;
  _eq?: InputMaybe<Scalars['timestamp']['input']>;
  _gt?: InputMaybe<Scalars['timestamp']['input']>;
  _gte?: InputMaybe<Scalars['timestamp']['input']>;
  _in?: InputMaybe<Array<Scalars['timestamp']['input']>>;
  _is_null?: InputMaybe<Scalars['Boolean']['input']>;
  _lt?: InputMaybe<Scalars['timestamp']['input']>;
  _lte?: InputMaybe<Scalars['timestamp']['input']>;
  _not?: InputMaybe<Timestamp_Bool_Exp>;
  _or?: InputMaybe<Array<Timestamp_Bool_Exp>>;
};

export type Tracked_Messages = {
  __typename?: 'tracked_messages';
  attachments: Scalars['bytes']['output'];
  author_id: Scalars['int64']['output'];
  /** All infractions for the author of this message */
  author_infractions?: Maybe<Array<Infraction>>;
  channel_id: Scalars['int64']['output'];
  content?: Maybe<Scalars['string']['output']>;
  creation_timestamp: Scalars['timestamp']['output'];
  /** Deletion record if this message was deleted */
  deleted_record?: Maybe<Deleted_Message>;
  deletion_timestamp?: Maybe<Scalars['timestamp']['output']>;
  guild_id: Scalars['int64']['output'];
  id: Scalars['int64']['output'];
  is_deleted: Scalars['int8']['output'];
  /** All reports made against this message */
  reports?: Maybe<Array<Reported_Message>>;
};


export type Tracked_MessagesAuthor_InfractionsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Infraction_Order_By_Exp>>;
  where?: InputMaybe<Infraction_Bool_Exp>;
};


export type Tracked_MessagesReportsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Reported_Message_Order_By_Exp>>;
  where?: InputMaybe<Reported_Message_Bool_Exp>;
};

export type Tracked_Messages_Agg_Exp = {
  __typename?: 'tracked_messages_agg_exp';
  _count: Scalars['Int']['output'];
  attachments: Bytes_Agg_Exp;
  author_id: Int64_Agg_Exp;
  channel_id: Int64_Agg_Exp;
  content: String_Agg_Exp;
  creation_timestamp: Timestamp_Agg_Exp;
  deletion_timestamp: Timestamp_Agg_Exp;
  guild_id: Int64_Agg_Exp;
  id: Int64_Agg_Exp;
  is_deleted: Int8_Agg_Exp;
};

export type Tracked_Messages_Bool_Exp = {
  _and?: InputMaybe<Array<Tracked_Messages_Bool_Exp>>;
  _not?: InputMaybe<Tracked_Messages_Bool_Exp>;
  _or?: InputMaybe<Array<Tracked_Messages_Bool_Exp>>;
  attachments?: InputMaybe<Bytes_Bool_Exp>;
  author_id?: InputMaybe<Int64_Bool_Exp>;
  channel_id?: InputMaybe<Int64_Bool_Exp>;
  content?: InputMaybe<String_Bool_Exp>;
  creation_timestamp?: InputMaybe<Timestamp_Bool_Exp>;
  deletion_timestamp?: InputMaybe<Timestamp_Bool_Exp>;
  guild_id?: InputMaybe<Int64_Bool_Exp>;
  id?: InputMaybe<Int64_Bool_Exp>;
  is_deleted?: InputMaybe<Int8_Bool_Exp>;
};

export type Tracked_Messages_Filter_Input = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Tracked_Messages_Order_By_Exp>>;
  where?: InputMaybe<Tracked_Messages_Bool_Exp>;
};

export type Tracked_Messages_Order_By_Exp = {
  attachments?: InputMaybe<OrderBy>;
  author_id?: InputMaybe<OrderBy>;
  channel_id?: InputMaybe<OrderBy>;
  content?: InputMaybe<OrderBy>;
  creation_timestamp?: InputMaybe<OrderBy>;
  deleted_record?: InputMaybe<Deleted_Message_Order_By_Exp>;
  deletion_timestamp?: InputMaybe<OrderBy>;
  guild_id?: InputMaybe<OrderBy>;
  id?: InputMaybe<OrderBy>;
  is_deleted?: InputMaybe<OrderBy>;
};
