import { operations, preferredRoles } from '../../lib/gql/operations';
import { useAuth } from '../../context/useAuth';
import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { AxiosHeaders, AxiosRequestHeaders } from 'axios';
import { X_HASURA_ROLE } from '../../lib/constants';
import { useEffect } from 'react';

/**
 * Builds headers with authentication and Hasura role headers
 * @param model - The model to build headers for
 * @returns The headers
 */
export const useAuthHeaders = (opName?: keyof typeof operations) => {
  const { state: authState } = useAuth();
  const [headers, setHeaders] = useState<AxiosRequestHeaders>(new AxiosHeaders());
  const [error, setError] = useState<unknown>();
  const loading = !headers.Authorization;

  useEffect(() => {
    const buildHeaders = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;

        if (opName && authState.hasuraClaims) {
          const preferredRole = preferredRoles[opName];
          if (preferredRole && authState.hasuraClaims.allowedRoles.includes(preferredRole)) {
            headers.set(X_HASURA_ROLE, preferredRole);
          }
        }

        setHeaders(headers);
      } catch (error) {
        setError(error);
      }
    };

    buildHeaders();
  }, [authState.hasuraClaims, opName, headers]);

  return { headers, loading, error };
};
