import { RefreshCw } from 'lucide-react';
import { useActiveUser } from '../../store';
import { formatDate, cn } from '../../lib/utils';
import { useDiscordSync } from '../../hooks/useDiscordSync';

type DiscordInfoProps = {
  /**
   * Compact mode for UserButton dropdown (smaller text, tighter spacing)
   * Full mode for Profile page (larger text, more spacing)
   */
  variant?: 'compact' | 'full';
};

export const DiscordIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
  >
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z" />
  </svg>
);

export function DiscordInfo({ variant = 'full' }: DiscordInfoProps) {
  const { user } = useActiveUser();
  const { syncDiscordRoles, syncing, lastSyncResult } = useDiscordSync();

  const isCompact = variant === 'compact';

  if (!user) {
    return (
      <div className="p-4">
        <p className={cn(isCompact ? 'text-sm' : 'text-base', 'text-gray-400')}>
          No user data available.
        </p>
      </div>
    );
  }

  const discordMemberData = user.discord.guildMember;
  const hasuraClaims = user.hasura;
  const discordId = user.discord.externalAccount?.discordId;

  return (
    <div className={cn('space-y-4', isCompact ? 'p-4' : '')}>
      {/* Header - only show in full mode, UserButton has its own header */}
      {!isCompact && (
        <div className="mb-6">
          <h2 className="text-lg font-bold leading-tight text-white">
            Discord Details
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            View and manage your Discord-connected account information.
          </p>
        </div>
      )}

      {discordMemberData && (
        <div className="space-y-4">
          {/* Guild Status */}
          <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-4">
            <div className={cn(isCompact ? 'space-y-2' : 'grid grid-cols-1 md:grid-cols-2 gap-4')}>
              {!isCompact && (
                <div>
                  <p className="text-sm font-bold text-gray-300 mb-1">
                    Guild Membership
                  </p>
                  <p className="text-xs text-gray-500 mb-3">
                    Connection to Brackeys server
                  </p>
                </div>
              )}

              <div className={cn(isCompact ? 'space-y-3' : 'space-y-4')}>
                {/* Discord User Info */}
                <div>
                  <p className="text-sm text-white font-medium">
                    @{user.username || 'Not available'}
                  </p>
                  {discordId && (
                    <p className="text-xs text-gray-500 font-mono mt-1">
                      {discordId}
                    </p>
                  )}
                </div>

                <div>
                  <p className="text-sm font-medium text-gray-300 mb-1">
                    Status
                  </p>
                  <p className="text-sm text-white">
                    <span
                      className={cn(
                        discordMemberData.inGuild
                          ? 'text-green-400'
                          : 'text-yellow-400',
                        'font-medium',
                      )}
                    >
                      {discordMemberData.inGuild
                        ? 'Active member'
                        : 'Not a member'}
                    </span>{' '}
                    {discordMemberData.inGuild &&
                      discordMemberData.joined_at && (
                        <span className="text-gray-400">
                          since {formatDate(discordMemberData.joined_at)}
                        </span>
                      )}
                  </p>
                </div>

                {/* Server Nickname */}
                {discordMemberData.inGuild && discordMemberData.nick && (
                  <div>
                    <p className="text-sm font-medium text-gray-300 mb-1">
                      Server Nickname
                    </p>
                    <p className={cn(isCompact ? 'text-base' : 'text-lg', 'font-semibold text-white')}>
                      {discordMemberData.nick}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Premium Status */}
          {discordMemberData.premium_since && (
            <div className="bg-gradient-to-r from-brackeys-fuscia/10 to-brackeys-purple/10 border border-brackeys-fuscia/30 rounded-lg p-4">
              <div className={cn(isCompact ? 'space-y-2' : 'grid grid-cols-1 md:grid-cols-2 gap-4')}>
                {!isCompact && (
                  <div>
                    <p className="text-sm font-bold text-brackeys-fuscia mb-1">
                      Server Booster
                    </p>
                    <p className="text-xs text-gray-500 mb-3">
                      Premium supporter perks active
                    </p>
                  </div>
                )}

                <div>
                  <p className="text-sm font-bold text-brackeys-fuscia mb-2">
                    {isCompact && 'Server Booster 💖'}
                    {!isCompact && 'Boosting Since'}
                  </p>
                  {!isCompact && (
                    <p className="text-sm font-medium text-gray-300 mb-1">
                      Boosting Since
                    </p>
                  )}
                  <p className="text-sm text-brackeys-fuscia font-semibold">
                    {formatDate(discordMemberData.premium_since)}
                  </p>
                  <p className="text-xs text-gray-400 mt-2">
                    Thank you for supporting the server! 💖
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Communication Status */}
          {discordMemberData.communication_disabled_until && (
            <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-4">
              <div className={cn(isCompact ? 'space-y-2' : 'grid grid-cols-1 md:grid-cols-2 gap-4')}>
                {!isCompact && (
                  <div>
                    <p className="text-sm font-bold text-red-400 mb-1">
                      Communication Timeout
                    </p>
                  </div>
                )}

                <div>
                  <p className="text-sm font-bold text-red-400 mb-2">
                    {isCompact && 'Communication Timeout'}
                  </p>
                  <p className="text-sm font-medium text-gray-300 mb-1">
                    Timeout Until
                  </p>
                  <p className="text-sm text-red-400 font-semibold">
                    {formatDate(discordMemberData.communication_disabled_until)}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Authorized Roles */}
          {hasuraClaims && (
            <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-4">
              <div className={cn(isCompact ? 'space-y-3' : 'grid grid-cols-1 md:grid-cols-2 gap-4')}>
                {!isCompact && (
                  <div>
                    <p className="text-sm font-bold text-gray-300 mb-1">
                      Authorized Roles
                    </p>
                    <p className="text-xs text-gray-500 mb-3">
                      Your permission levels in the community
                    </p>
                    {lastSyncResult && (
                      <div
                        className={cn(
                          'text-xs p-2 rounded',
                          lastSyncResult.success
                            ? 'bg-green-900/30 text-green-300'
                            : 'bg-red-900/30 text-red-300',
                        )}
                      >
                        {lastSyncResult.success
                          ? `✓ Synced! Role: ${lastSyncResult.defaultRole}`
                          : `✗ ${lastSyncResult.error}`}
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-sm font-bold text-gray-300">
                        {isCompact ? 'Authorized Roles' : 'Available Roles'}
                      </p>
                      {isCompact && (
                        <p className="text-xs text-gray-500 mt-1">
                          Your permission levels
                        </p>
                      )}
                    </div>
                    <button
                      onClick={syncDiscordRoles}
                      disabled={syncing}
                      className={cn(
                        'p-1.5 rounded-md hover:bg-gray-700/50 transition-colors',
                        syncing && 'animate-spin',
                      )}
                      title="Sync roles from Discord"
                    >
                      <RefreshCw className="h-4 w-4 text-gray-400 hover:text-brackeys-purple-400" />
                    </button>
                  </div>

                  {isCompact && lastSyncResult && (
                    <div
                      className={cn(
                        'text-xs p-2 rounded mb-3',
                        lastSyncResult.success
                          ? 'bg-green-900/30 text-green-300'
                          : 'bg-red-900/30 text-red-300',
                      )}
                    >
                      {lastSyncResult.success
                        ? `✓ Synced! Role: ${lastSyncResult.defaultRole}`
                        : `✗ ${lastSyncResult.error}`}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {hasuraClaims.allowedRoles?.map((role) => (
                      <span
                        key={role}
                        className={cn(
                          'px-3 py-1 rounded-full font-medium',
                          isCompact ? 'text-xs' : 'text-sm',
                          role === hasuraClaims.defaultRole
                            ? 'bg-brackeys-purple-600 text-white'
                            : 'bg-gray-700 text-gray-200',
                        )}
                      >
                        {role}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {!discordMemberData && (
        <div className="bg-yellow-900/20 border border-yellow-500/30 rounded-lg p-4">
          <p className={cn(isCompact ? 'text-sm' : 'text-base', 'text-yellow-300')}>
            Discord guild data is not available. Try syncing your Discord
            roles.
          </p>
        </div>
      )}
    </div>
  );
}

