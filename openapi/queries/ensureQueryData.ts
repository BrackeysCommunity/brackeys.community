// generated with @7nohe/openapi-react-query-codegen@1.6.2 

import { type QueryClient } from "@tanstack/react-query";
import { DefaultService } from "../requests/services.gen";
import * as Common from "./common";
export const ensureUseDefaultServiceGetHealthData = (queryClient: QueryClient) => queryClient.ensureQueryData({ queryKey: Common.UseDefaultServiceGetHealthKeyFn(), queryFn: () => DefaultService.getHealth() });
export const ensureUseDefaultServiceGetGuildsByGuildIdRulesData = (queryClient: QueryClient, { guildId }: {
  guildId: string;
}) => queryClient.ensureQueryData({ queryKey: Common.UseDefaultServiceGetGuildsByGuildIdRulesKeyFn({ guildId }), queryFn: () => DefaultService.getGuildsByGuildIdRules({ guildId }) });
export const ensureUseDefaultServiceGetGuildsByGuildIdRulesByRuleIdData = (queryClient: QueryClient, { guildId, ruleId }: {
  guildId: string;
  ruleId: string;
}) => queryClient.ensureQueryData({ queryKey: Common.UseDefaultServiceGetGuildsByGuildIdRulesByRuleIdKeyFn({ guildId, ruleId }), queryFn: () => DefaultService.getGuildsByGuildIdRulesByRuleId({ guildId, ruleId }) });
export const ensureUseDefaultServiceGetGuildsByGuildIdInfractionsData = (queryClient: QueryClient, { guildId, limit, offset, type, userId }: {
  guildId: string;
  limit?: string;
  offset?: string;
  type?: "0" | "1" | "2" | "3";
  userId?: string;
}) => queryClient.ensureQueryData({ queryKey: Common.UseDefaultServiceGetGuildsByGuildIdInfractionsKeyFn({ guildId, limit, offset, type, userId }), queryFn: () => DefaultService.getGuildsByGuildIdInfractions({ guildId, limit, offset, type, userId }) });
export const ensureUseDefaultServiceGetGuildsByGuildIdUsersByUserIdInfractionsData = (queryClient: QueryClient, { guildId, limit, offset, userId }: {
  guildId: string;
  limit?: string;
  offset?: string;
  userId: string;
}) => queryClient.ensureQueryData({ queryKey: Common.UseDefaultServiceGetGuildsByGuildIdUsersByUserIdInfractionsKeyFn({ guildId, limit, offset, userId }), queryFn: () => DefaultService.getGuildsByGuildIdUsersByUserIdInfractions({ guildId, limit, offset, userId }) });
export const ensureUseDefaultServiceGetGuildsByGuildIdNotesData = (queryClient: QueryClient, { guildId, limit, offset, type, userId }: {
  guildId: string;
  limit?: string;
  offset?: string;
  type?: string;
  userId?: string;
}) => queryClient.ensureQueryData({ queryKey: Common.UseDefaultServiceGetGuildsByGuildIdNotesKeyFn({ guildId, limit, offset, type, userId }), queryFn: () => DefaultService.getGuildsByGuildIdNotes({ guildId, limit, offset, type, userId }) });
export const ensureUseDefaultServiceGetGuildsByGuildIdUsersByUserIdNotesData = (queryClient: QueryClient, { guildId, limit, offset, userId }: {
  guildId: string;
  limit?: string;
  offset?: string;
  userId: string;
}) => queryClient.ensureQueryData({ queryKey: Common.UseDefaultServiceGetGuildsByGuildIdUsersByUserIdNotesKeyFn({ guildId, limit, offset, userId }), queryFn: () => DefaultService.getGuildsByGuildIdUsersByUserIdNotes({ guildId, limit, offset, userId }) });
