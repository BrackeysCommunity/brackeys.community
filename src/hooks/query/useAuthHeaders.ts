import { useAuth as useClerkAuth } from '@clerk/tanstack-react-start';
import { AxiosHeaders, type AxiosRequestHeaders } from 'axios';
import { useEffect, useState } from 'react';
import { X_HASURA_ROLE } from '../../lib/constants';
import { type operations, preferredRoles } from '../../lib/gql/operations';
import { useHasuraClaims } from '../../store';

/**
 * Builds headers with authentication and Hasura role headers
 * @param opName - The operation name to build headers for
 * @returns The headers with authentication and role information
 */
export const useAuthHeaders = (opName?: keyof typeof operations) => {
  const hasuraClaims = useHasuraClaims();
  const { getToken } = useClerkAuth();
  const [headers, setHeaders] = useState<AxiosRequestHeaders>(
    new AxiosHeaders(),
  );
  const [error, setError] = useState<unknown>();
  const loading = !headers.Authorization;

  useEffect(() => {
    const buildHeaders = async () => {
      try {
        const token = await getToken({ template: 'hasura' });
        headers.set('Content-Type', 'application/json');

        if (token) headers.Authorization = `Bearer ${token}`;

        if (opName && hasuraClaims && !import.meta.env.DEV) {
          const preferredRole = preferredRoles[opName];
          if (
            preferredRole &&
            hasuraClaims.allowedRoles.includes(preferredRole)
          ) {
            headers.set(X_HASURA_ROLE, preferredRole);
          }
        }

        setHeaders(headers);
      } catch (error) {
        setError(error);
      }
    };

    buildHeaders();
  }, [hasuraClaims, opName, headers, getToken]);

  return { headers, loading, error };
};
