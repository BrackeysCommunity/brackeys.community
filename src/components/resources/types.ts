import { ComponentType } from 'react';

export type GameGenre = 'action' | 'puzzle' | 'adventure' | 'simulation' | 'strategy' | 'survival';

export type ToolCategory = 'game-development' | 'graphics-art' | 'code-editors' | 'development-tools' | 'project-management';

export type ResourceCategory = GameGenre | ToolCategory;

export type ResourceType = 'game' | 'tool';

export type ResourceTag = 'community-made' | 'popular' | 'free' | 'open-source' | 'beginner-friendly';

export type ResourceItem = {
  id: string;
  title: string;
  description: string;
  imageUrl?: string;
  categories: ResourceCategory[];
  primaryGenre?: GameGenre;
  primaryCategory?: ToolCategory;
  type: ResourceType;
  tags: ResourceTag[];
  releaseDate?: string;
  developer?: string;
  developerUrl?: string;
  resourceUrl: URL | string;
};

export type CategoryInfo = {
  label: string;
  icon: ComponentType<{ className?: string }>;
  color: string;
  type: ResourceType;
};

export type TagInfo = {
  label: string;
  icon: ComponentType<{ className?: string }>;
  color: string;
};

export type ResourceFilterProps = {
  activeType: ResourceType | 'all';
  setActiveType: (type: ResourceType | 'all') => void;
  activeCategory: ResourceCategory | 'all';
  setActiveCategory: (category: ResourceCategory | 'all') => void;
  activeTag: ResourceTag | 'all';
  setActiveTag: (tag: ResourceTag | 'all') => void;
  typeCounts: Record<string, number>;
  categoryCounts: Record<string, number>;
  tagCounts: Record<string, number>;
};
