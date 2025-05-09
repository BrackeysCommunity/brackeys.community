// generated with @7nohe/openapi-react-query-codegen@1.6.2 

import { UseQueryOptions, useQuery } from "@tanstack/react-query";
import { DefaultService } from "../requests/services.gen";
import * as Common from "./common";
export const useDefaultServiceGetHealth = <TData = Common.DefaultServiceGetHealthDefaultResponse, TError = unknown, TQueryKey extends Array<unknown> = unknown[]>(queryKey?: TQueryKey, options?: Omit<UseQueryOptions<TData, TError>, "queryKey" | "queryFn">) => useQuery<TData, TError>({ queryKey: Common.UseDefaultServiceGetHealthKeyFn(queryKey), queryFn: () => DefaultService.getHealth() as TData, ...options });
export const useDefaultServiceGetGuildsByGuildIdRules = <TData = Common.DefaultServiceGetGuildsByGuildIdRulesDefaultResponse, TError = unknown, TQueryKey extends Array<unknown> = unknown[]>({ guildId }: {
  guildId: string;
}, queryKey?: TQueryKey, options?: Omit<UseQueryOptions<TData, TError>, "queryKey" | "queryFn">) => useQuery<TData, TError>({ queryKey: Common.UseDefaultServiceGetGuildsByGuildIdRulesKeyFn({ guildId }, queryKey), queryFn: () => DefaultService.getGuildsByGuildIdRules({ guildId }) as TData, ...options });
export const useDefaultServiceGetGuildsByGuildIdRulesByRuleId = <TData = Common.DefaultServiceGetGuildsByGuildIdRulesByRuleIdDefaultResponse, TError = unknown, TQueryKey extends Array<unknown> = unknown[]>({ guildId, ruleId }: {
  guildId: string;
  ruleId: string;
}, queryKey?: TQueryKey, options?: Omit<UseQueryOptions<TData, TError>, "queryKey" | "queryFn">) => useQuery<TData, TError>({ queryKey: Common.UseDefaultServiceGetGuildsByGuildIdRulesByRuleIdKeyFn({ guildId, ruleId }, queryKey), queryFn: () => DefaultService.getGuildsByGuildIdRulesByRuleId({ guildId, ruleId }) as TData, ...options });
export const useDefaultServiceGetGuildsByGuildIdInfractions = <TData = Common.DefaultServiceGetGuildsByGuildIdInfractionsDefaultResponse, TError = unknown, TQueryKey extends Array<unknown> = unknown[]>({ guildId, limit, offset, type, userId }: {
  guildId: string;
  limit?: string;
  offset?: string;
  type?: "0" | "1" | "2" | "3";
  userId?: string;
}, queryKey?: TQueryKey, options?: Omit<UseQueryOptions<TData, TError>, "queryKey" | "queryFn">) => useQuery<TData, TError>({ queryKey: Common.UseDefaultServiceGetGuildsByGuildIdInfractionsKeyFn({ guildId, limit, offset, type, userId }, queryKey), queryFn: () => DefaultService.getGuildsByGuildIdInfractions({ guildId, limit, offset, type, userId }) as TData, ...options });
export const useDefaultServiceGetGuildsByGuildIdUsersByUserIdInfractions = <TData = Common.DefaultServiceGetGuildsByGuildIdUsersByUserIdInfractionsDefaultResponse, TError = unknown, TQueryKey extends Array<unknown> = unknown[]>({ guildId, limit, offset, userId }: {
  guildId: string;
  limit?: string;
  offset?: string;
  userId: string;
}, queryKey?: TQueryKey, options?: Omit<UseQueryOptions<TData, TError>, "queryKey" | "queryFn">) => useQuery<TData, TError>({ queryKey: Common.UseDefaultServiceGetGuildsByGuildIdUsersByUserIdInfractionsKeyFn({ guildId, limit, offset, userId }, queryKey), queryFn: () => DefaultService.getGuildsByGuildIdUsersByUserIdInfractions({ guildId, limit, offset, userId }) as TData, ...options });
export const useDefaultServiceGetGuildsByGuildIdNotes = <TData = Common.DefaultServiceGetGuildsByGuildIdNotesDefaultResponse, TError = unknown, TQueryKey extends Array<unknown> = unknown[]>({ guildId, limit, offset, type, userId }: {
  guildId: string;
  limit?: string;
  offset?: string;
  type?: string;
  userId?: string;
}, queryKey?: TQueryKey, options?: Omit<UseQueryOptions<TData, TError>, "queryKey" | "queryFn">) => useQuery<TData, TError>({ queryKey: Common.UseDefaultServiceGetGuildsByGuildIdNotesKeyFn({ guildId, limit, offset, type, userId }, queryKey), queryFn: () => DefaultService.getGuildsByGuildIdNotes({ guildId, limit, offset, type, userId }) as TData, ...options });
export const useDefaultServiceGetGuildsByGuildIdUsersByUserIdNotes = <TData = Common.DefaultServiceGetGuildsByGuildIdUsersByUserIdNotesDefaultResponse, TError = unknown, TQueryKey extends Array<unknown> = unknown[]>({ guildId, limit, offset, userId }: {
  guildId: string;
  limit?: string;
  offset?: string;
  userId: string;
}, queryKey?: TQueryKey, options?: Omit<UseQueryOptions<TData, TError>, "queryKey" | "queryFn">) => useQuery<TData, TError>({ queryKey: Common.UseDefaultServiceGetGuildsByGuildIdUsersByUserIdNotesKeyFn({ guildId, limit, offset, userId }, queryKey), queryFn: () => DefaultService.getGuildsByGuildIdUsersByUserIdNotes({ guildId, limit, offset, userId }) as TData, ...options });
