import { gql } from 'graphql-request';

const AltAccounts = gql`
  query AltAccounts {
    altAccount {
      userId
      altId
      staffMemberId
      registeredAt
    }
  }
`;

export const operations = {
  AltAccounts,
} as const;

export const preferredRoles: Record<keyof typeof operations, string> = {
  AltAccounts: 'user',
};
