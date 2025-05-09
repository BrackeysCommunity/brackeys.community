// generated with @7nohe/openapi-react-query-codegen@1.6.2 

import { UseQueryResult } from "@tanstack/react-query";
import { DefaultService } from "../requests/services.gen";
export type DefaultServiceGetHealthDefaultResponse = Awaited<ReturnType<typeof DefaultService.getHealth>>;
export type DefaultServiceGetHealthQueryResult<TData = DefaultServiceGetHealthDefaultResponse, TError = unknown> = UseQueryResult<TData, TError>;
export const useDefaultServiceGetHealthKey = "DefaultServiceGetHealth";
export const UseDefaultServiceGetHealthKeyFn = (queryKey?: Array<unknown>) => [useDefaultServiceGetHealthKey, ...(queryKey ?? [])];
export type DefaultServiceGetGuildsByGuildIdRulesDefaultResponse = Awaited<ReturnType<typeof DefaultService.getGuildsByGuildIdRules>>;
export type DefaultServiceGetGuildsByGuildIdRulesQueryResult<TData = DefaultServiceGetGuildsByGuildIdRulesDefaultResponse, TError = unknown> = UseQueryResult<TData, TError>;
export const useDefaultServiceGetGuildsByGuildIdRulesKey = "DefaultServiceGetGuildsByGuildIdRules";
export const UseDefaultServiceGetGuildsByGuildIdRulesKeyFn = ({ guildId }: {
  guildId: string;
}, queryKey?: Array<unknown>) => [useDefaultServiceGetGuildsByGuildIdRulesKey, ...(queryKey ?? [{ guildId }])];
export type DefaultServiceGetGuildsByGuildIdRulesByRuleIdDefaultResponse = Awaited<ReturnType<typeof DefaultService.getGuildsByGuildIdRulesByRuleId>>;
export type DefaultServiceGetGuildsByGuildIdRulesByRuleIdQueryResult<TData = DefaultServiceGetGuildsByGuildIdRulesByRuleIdDefaultResponse, TError = unknown> = UseQueryResult<TData, TError>;
export const useDefaultServiceGetGuildsByGuildIdRulesByRuleIdKey = "DefaultServiceGetGuildsByGuildIdRulesByRuleId";
export const UseDefaultServiceGetGuildsByGuildIdRulesByRuleIdKeyFn = ({ guildId, ruleId }: {
  guildId: string;
  ruleId: string;
}, queryKey?: Array<unknown>) => [useDefaultServiceGetGuildsByGuildIdRulesByRuleIdKey, ...(queryKey ?? [{ guildId, ruleId }])];
export type DefaultServiceGetGuildsByGuildIdInfractionsDefaultResponse = Awaited<ReturnType<typeof DefaultService.getGuildsByGuildIdInfractions>>;
export type DefaultServiceGetGuildsByGuildIdInfractionsQueryResult<TData = DefaultServiceGetGuildsByGuildIdInfractionsDefaultResponse, TError = unknown> = UseQueryResult<TData, TError>;
export const useDefaultServiceGetGuildsByGuildIdInfractionsKey = "DefaultServiceGetGuildsByGuildIdInfractions";
export const UseDefaultServiceGetGuildsByGuildIdInfractionsKeyFn = ({ guildId, limit, offset, type, userId }: {
  guildId: string;
  limit?: string;
  offset?: string;
  type?: "0" | "1" | "2" | "3";
  userId?: string;
}, queryKey?: Array<unknown>) => [useDefaultServiceGetGuildsByGuildIdInfractionsKey, ...(queryKey ?? [{ guildId, limit, offset, type, userId }])];
export type DefaultServiceGetGuildsByGuildIdUsersByUserIdInfractionsDefaultResponse = Awaited<ReturnType<typeof DefaultService.getGuildsByGuildIdUsersByUserIdInfractions>>;
export type DefaultServiceGetGuildsByGuildIdUsersByUserIdInfractionsQueryResult<TData = DefaultServiceGetGuildsByGuildIdUsersByUserIdInfractionsDefaultResponse, TError = unknown> = UseQueryResult<TData, TError>;
export const useDefaultServiceGetGuildsByGuildIdUsersByUserIdInfractionsKey = "DefaultServiceGetGuildsByGuildIdUsersByUserIdInfractions";
export const UseDefaultServiceGetGuildsByGuildIdUsersByUserIdInfractionsKeyFn = ({ guildId, limit, offset, userId }: {
  guildId: string;
  limit?: string;
  offset?: string;
  userId: string;
}, queryKey?: Array<unknown>) => [useDefaultServiceGetGuildsByGuildIdUsersByUserIdInfractionsKey, ...(queryKey ?? [{ guildId, limit, offset, userId }])];
export type DefaultServiceGetGuildsByGuildIdNotesDefaultResponse = Awaited<ReturnType<typeof DefaultService.getGuildsByGuildIdNotes>>;
export type DefaultServiceGetGuildsByGuildIdNotesQueryResult<TData = DefaultServiceGetGuildsByGuildIdNotesDefaultResponse, TError = unknown> = UseQueryResult<TData, TError>;
export const useDefaultServiceGetGuildsByGuildIdNotesKey = "DefaultServiceGetGuildsByGuildIdNotes";
export const UseDefaultServiceGetGuildsByGuildIdNotesKeyFn = ({ guildId, limit, offset, type, userId }: {
  guildId: string;
  limit?: string;
  offset?: string;
  type?: string;
  userId?: string;
}, queryKey?: Array<unknown>) => [useDefaultServiceGetGuildsByGuildIdNotesKey, ...(queryKey ?? [{ guildId, limit, offset, type, userId }])];
export type DefaultServiceGetGuildsByGuildIdUsersByUserIdNotesDefaultResponse = Awaited<ReturnType<typeof DefaultService.getGuildsByGuildIdUsersByUserIdNotes>>;
export type DefaultServiceGetGuildsByGuildIdUsersByUserIdNotesQueryResult<TData = DefaultServiceGetGuildsByGuildIdUsersByUserIdNotesDefaultResponse, TError = unknown> = UseQueryResult<TData, TError>;
export const useDefaultServiceGetGuildsByGuildIdUsersByUserIdNotesKey = "DefaultServiceGetGuildsByGuildIdUsersByUserIdNotes";
export const UseDefaultServiceGetGuildsByGuildIdUsersByUserIdNotesKeyFn = ({ guildId, limit, offset, userId }: {
  guildId: string;
  limit?: string;
  offset?: string;
  userId: string;
}, queryKey?: Array<unknown>) => [useDefaultServiceGetGuildsByGuildIdUsersByUserIdNotesKey, ...(queryKey ?? [{ guildId, limit, offset, userId }])];
