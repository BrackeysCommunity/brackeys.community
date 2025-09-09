export type CollaborationType = {
  id: number;
  name: string;
  description?: string | null;
};

export type HiringStatus = {
  id: number;
  name: string;
  description?: string | null;
};

export type CollaborationStatus = {
  id: number;
  name: string;
  description?: string | null;
};

export type CollaborationProfile = {
  id: string;
  userId: number;
  displayName?: string | null;
  bio?: string | null;
  skills?: string | null;
  portfolio?: string | null;
  contactPreferences?: string | null;
  isPublic: number;
  lastActiveAt?: string | null;
};

export type CollaborationFieldValue = {
  id: string;
  value: string;
  collaborationFieldDefinition?: {
    id: string;
    fieldName: string;
    displayName: string;
    fieldType?: string | null;
  } | null;
};

export type CollaborationPost = {
  id: string;
  profileId: string;
  collaborationTypeId: number;
  hiringStatusId: number;
  statusId: number;
  postedAt?: string | null;
  expiresAt?: string | null;
  viewCount: number;
  responseCount: number;
  isHighlighted: number;
  tags?: string | null;
  collaborationProfile?: CollaborationProfile | null;
  collaborationType?: CollaborationType | null;
  hiringStatus?: HiringStatus | null;
  collaborationStatus?: CollaborationStatus | null;
  collaborationFieldValues?: CollaborationFieldValue[] | null;
  collaborationBookmarks?: { profileId: string }[] | null;
};

export type CollaborationFilters = {
  typeId: number | 'all';
  hiringStatusId: number | 'all';
  statusId: number | 'all';
  searchQuery: string;
  sortBy: 'recent' | 'popular' | 'responses';
};
