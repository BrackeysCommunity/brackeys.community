import { useState } from 'react';
import { useAuth } from '../context/useAuth';
import axios from 'axios';

type SyncResult = {
  success: boolean;
  roles?: string[];
  defaultRole?: string;
  error?: string;
  notInGuild?: boolean;
};

export function useDiscordSync() {
  const { state, dispatch } = useAuth();
  const [syncing, setSyncing] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null);

  const syncDiscordRoles = async () => {
    if (!state.user?.id) {
      console.error('No user ID found');
      return { success: false, error: 'Not logged in' };
    }

    setSyncing(true);
    setLastSyncResult(null);

    try {
      // Use relative URL when deployed to same domain, or VITE_API_URL for cross-domain
      const apiUrl = import.meta.env.VITE_API_URL || '';
      const endpoint = apiUrl ? `${apiUrl}/api/sync-discord-roles` : '/api/sync-discord-roles';
      const response = await axios.post(
        endpoint,
        {
          userId: state.user.id,
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      const data = response.data;

      if (!response.data.success) {
        console.error('Failed to sync Discord roles:', data);
        setLastSyncResult({ success: false, error: data.error || 'Sync failed' });
        return data;
      }

      console.log('Discord roles synced successfully:', data);
      setLastSyncResult(data);

      // Update local state with new Discord metadata
      if (data.success && data.memberData) {
        dispatch({
          type: 'UPDATE_DISCORD_DATA',
          payload: {
            discordMemberData: {
              avatar: data.memberData.avatar,
              roles: data.memberData.roles,
              nick: data.memberData.nick,
              joined_at: data.memberData.joined_at,
              premium_since: data.memberData.premium_since,
              inGuild: true,
            },
            hasuraClaims: {
              defaultRole: data.defaultRole,
              allowedRoles: data.roles,
            },
          },
        });
      }

      return data;
    } catch (error) {
      console.error('Error syncing Discord roles:', error);
      const result = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
      setLastSyncResult(result);
      return result;
    } finally {
      setSyncing(false);
    }
  };

  return {
    syncDiscordRoles,
    syncing,
    lastSyncResult,
  };
}
