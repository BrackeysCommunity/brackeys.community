import { graphql } from './gen';

const AltAccounts = graphql(`
  query AltAccounts {
    altAccount {
      userId
      altId
      staffMemberId
      registeredAt
    }
  }
`);

export const Collabs = graphql(`
  query Collabs {
    collaborationProfile {
      id
      displayName
      bio
    }
  }
`);

// Collaboration Lookup Queries
export const CollaborationTypes = graphql(`
  query CollaborationTypes {
    collaborationType {
      id
      name
      description
    }
  }
`);

export const HiringStatuses = graphql(`
  query HiringStatuses {
    hiringStatus {
      id
      name
      description
    }
  }
`);

export const CollaborationStatuses = graphql(`
  query CollaborationStatuses {
    collaborationStatus {
      id
      name
      description
    }
  }
`);

// Profile Queries
export const MyCollaborationProfile = graphql(`
  query MyCollaborationProfile($userId: Int64!) {
    collaborationProfile(where: { userId: { _eq: $userId } }) {
      id
      userId
      guildId
      displayName
      bio
      skills
      portfolio
      contactPreferences
      isPublic
      createdAt
      updatedAt
      lastActiveAt
      collaborationPosts {
        id
        statusId
        responseCount
        viewCount
      }
      collaborationResponses {
        id
        collaborationPostId
        isRead
      }
      collaborationBookmarks {
        id
        collaborationPostId
      }
    }
  }
`);

export const CollaborationProfileById = graphql(`
  query CollaborationProfileById($id: String1!) {
    collaborationProfileById(id: $id) {
      id
      userId
      displayName
      bio
      skills
      portfolio
      contactPreferences
      isPublic
      lastActiveAt
      collaborationPosts(where: { statusId: { _eq: 2 } }, order_by: { postedAt: Desc }) {
        id
        collaborationTypeId
        hiringStatusId
        statusId
        postedAt
        expiresAt
        viewCount
        responseCount
        tags
        collaborationType {
          name
        }
        hiringStatus {
          name
        }
        collaborationFieldValues {
          id
          value
          collaborationFieldDefinition {
            id
            fieldName
            displayName
          }
        }
      }
    }
  }
`);

// Post Queries
export const CollaborationPosts = graphql(`
  query CollaborationPosts(
    $where: CollaborationPostBoolExp
    $limit: Int
    $offset: Int
    $order_by: [CollaborationPostOrderByExp!]
  ) {
    collaborationPost(where: $where, limit: $limit, offset: $offset, order_by: $order_by) {
      id
      profileId
      guildId
      collaborationTypeId
      hiringStatusId
      statusId
      createdAt
      postedAt
      expiresAt
      viewCount
      responseCount
      isHighlighted
      tags
      collaborationProfile {
        id
        displayName
        userId
      }
      collaborationType {
        id
        name
      }
      hiringStatus {
        id
        name
      }
      collaborationStatus {
        id
        name
      }
      collaborationFieldValues {
        id
        value
        collaborationFieldDefinition {
          id
          fieldName
          displayName
          fieldType
        }
      }
      collaborationBookmarks {
        profileId
      }
    }
    collaborationPostAggregate(filter_input: { where: $where }) {
      _count
    }
  }
`);

export const CollaborationPostDetail = graphql(`
  query CollaborationPostDetail($id: String1!) {
    collaborationPostById(id: $id) {
      id
      profileId
      guildId
      collaborationTypeId
      hiringStatusId
      statusId
      createdAt
      postedAt
      expiresAt
      viewCount
      responseCount
      isHighlighted
      tags
      collaborationProfile {
        id
        displayName
        bio
        skills
        portfolio
        contactPreferences
        userId
        lastActiveAt
      }
      collaborationType {
        id
        name
        description
      }
      hiringStatus {
        id
        name
        description
      }
      collaborationStatus {
        id
        name
        description
      }
      collaborationFieldValues {
        id
        value
        collaborationFieldDefinition {
          id
          fieldName
          displayName
          fieldType
          helpText
        }
      }
      collaborationResponses(where: { isHidden: { _eq: 0 } }, order_by: { createdAt: Desc }) {
        id
        profileId
        message
        contactInfo
        isPublic
        createdAt
        isRead
        collaborationProfile {
          id
          displayName
          userId
        }
      }
    }
  }
`);

// Field Definition Query
export const CollaborationFieldDefinitions = graphql(`
  query CollaborationFieldDefinitions($typeId: Int32!, $hiringStatusId: Int32!) {
    collaborationFieldDefinition(
      where: { collaborationTypeId: { _eq: $typeId }, hiringStatusId: { _eq: $hiringStatusId } }
      order_by: { fieldOrder: Asc }
    ) {
      id
      fieldName
      displayName
      fieldType
      isRequired
      fieldOrder
      maxLength
      validationRegex
      helpText
      options
    }
  }
`);

// Response Queries
export const MyCollaborationResponses = graphql(`
  query MyCollaborationResponses($profileId: String1!) {
    collaborationResponse(
      where: { profileId: { _eq: $profileId } }
      order_by: { createdAt: Desc }
    ) {
      id
      collaborationPostId
      message
      contactInfo
      isPublic
      isHidden
      createdAt
      isRead
      readAt
      collaborationPost {
        id
        statusId
        collaborationProfile {
          displayName
        }
        collaborationType {
          name
        }
        hiringStatus {
          name
        }
      }
    }
  }
`);

export const PostResponses = graphql(`
  query PostResponses($postId: String1!, $profileId: String1!) {
    collaborationResponse(
      where: {
        collaborationPostId: { _eq: $postId }
        _or: [{ collaborationPost: { profileId: { _eq: $profileId } } }, { isPublic: { _eq: 1 } }]
        isHidden: { _eq: 0 }
      }
      order_by: { createdAt: Desc }
    ) {
      id
      profileId
      message
      contactInfo
      isPublic
      createdAt
      isRead
      readAt
      collaborationProfile {
        id
        displayName
        bio
        skills
        userId
      }
    }
  }
`);

// Bookmark Queries
export const MyBookmarks = graphql(`
  query MyBookmarks($profileId: String1!) {
    collaborationBookmark(
      where: { profileId: { _eq: $profileId } }
      order_by: { createdAt: Desc }
    ) {
      id
      collaborationPostId
      createdAt
      collaborationPost {
        id
        statusId
        postedAt
        expiresAt
        viewCount
        responseCount
        tags
        collaborationProfile {
          displayName
        }
        collaborationType {
          name
        }
        hiringStatus {
          name
        }
        collaborationFieldValues {
          value
          collaborationFieldDefinition {
            fieldName
            displayName
          }
        }
      }
    }
  }
`);

// Note: Mutations are not available in this Hasura DDN instance
// Write operations will need to be handled through a separate API

export const operations = {
  Collabs,
  AltAccounts,
  // Collaboration operations
  CollaborationTypes,
  HiringStatuses,
  CollaborationStatuses,
  MyCollaborationProfile,
  CollaborationProfileById,
  CollaborationPosts,
  CollaborationPostDetail,
  CollaborationFieldDefinitions,
  MyCollaborationResponses,
  PostResponses,
  MyBookmarks,
} as const;

export const preferredRoles: Record<keyof typeof operations, string> = {
  Collabs: 'user',
  AltAccounts: 'user',
  // Collaboration operations
  CollaborationTypes: 'user',
  HiringStatuses: 'user',
  CollaborationStatuses: 'user',
  MyCollaborationProfile: 'user',
  CollaborationProfileById: 'user',
  CollaborationPosts: 'user',
  CollaborationPostDetail: 'user',
  CollaborationFieldDefinitions: 'user',
  MyCollaborationResponses: 'user',
  PostResponses: 'user',
  MyBookmarks: 'user',
};
