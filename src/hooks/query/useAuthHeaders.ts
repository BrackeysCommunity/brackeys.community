import { operations, preferredRoles } from '../../lib/gql/operations';
import { useAuth } from '../../context/useAuth';
import { useState } from 'react';
import { useAuth as useClerkAuth } from '@clerk/clerk-react';
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
  const { getToken } = useClerkAuth();
  const [headers, setHeaders] = useState<AxiosRequestHeaders>(new AxiosHeaders());
  const [error, setError] = useState<unknown>();
  const loading = !headers.Authorization;

  useEffect(() => {
    const buildHeaders = async () => {
      try {
        const token = await getToken({ template: 'hasura' });
        headers.set('Content-Type', 'application/json');

        if (token) headers.Authorization = `Bearer ${token}`;

        if (opName && authState.hasuraClaims && !import.meta.env.DEV) {
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
  }, [authState.hasuraClaims, opName, headers, getToken]);

  return { headers, loading, error };
};
