import {
  Gamepad2,
  Trophy,
  Brain,
  Building,
  Skull,
  WholeWord,
  Swords,
  Wrench,
  Star,
  Tag,
  Users
} from 'lucide-react';
import { ResourceCategory, ResourceItem, CategoryInfo, TagInfo, ResourceTag } from './types';

export const resources: ResourceItem[] = [
  // Games
  {
    id: 'perfect-day',
    title: 'The Perfect Day',
    description: 'Nothing must go wrong!',
    imageUrl: 'https://qntn.be/img/portfolio/NEqBrb.png',
    categories: ['simulation'],
    type: 'game',
    tags: ['community-made'],
    releaseDate: '2025-02-01',
    developer: 'Quinten',
    developerUrl: 'https://qntn.be/',
    resourceUrl: new URL('https://computer-q.itch.io/brackeys-13-nothing-can-go-wrong'),
  },
  {
    id: 'amalgablade',
    title: 'Amalgablade',
    description: 'A chill strategic autobattler.',
    imageUrl: 'https://qntn.be/img/portfolio/fJRVUX.png',
    categories: ['strategy'],
    type: 'game',
    tags: ['community-made'],
    releaseDate: '2025-01-01',
    developer: 'Quinten',
    developerUrl: 'https://qntn.be/',
    resourceUrl: new URL('https://computer-q.itch.io/pirate16-you-are-the-weapon'),
  },
  {
    id: 'guardians-chaos',
    title: 'Guardians of Chaos',
    description: 'Defend the wizards tower from monsters in an exciting retro-style tower-defense bullet-hell!',
    imageUrl: 'https://qntn.be/img/portfolio/ItCBjo.gif',
    categories: ['survival', 'strategy'],
    type: 'game',
    tags: ['community-made'],
    releaseDate: '2024-10-01',
    developer: 'Quinten',
    developerUrl: 'https://qntn.be/',
    resourceUrl: new URL('https://computer-q.itch.io/1-bit-jam-4-tower'),
  },
  {
    id: 'lighthouse-shepard',
    title: 'Lighthouse - The Storm Shepard',
    description: 'Lead your armies to victory through strategic planning and tactical battlefield decisions.',
    imageUrl: 'https://qntn.be/img/portfolio/b8F72I.gif',
    categories: ['strategy'],
    type: 'game',
    tags: ['community-made'],
    releaseDate: '2024-09-01',
    developer: 'Quinten',
    developerUrl: 'https://qntn.be/',
    resourceUrl: new URL('https://computer-q.itch.io/brackeys-12-calm-before-the-storm'),
  },
  {
    id: 'alchemist-shadowland',
    title: 'Alchemist of Shadowland',
    description: 'Mix potions and defeat enemies in this strategic alchemy game.',
    imageUrl: 'https://qntn.be/img/portfolio/lux7Lg.png',
    categories: ['strategy', 'puzzle'],
    type: 'game',
    tags: ['community-made'],
    releaseDate: '2024-08-01',
    developer: 'Quinten',
    developerUrl: 'https://qntn.be/',
    resourceUrl: new URL('https://computer-q.itch.io/shadows-alchemy'),
  },
  {
    id: 'snake',
    title: 'Brackeys Snake',
    description: 'A classic snake game.',
    categories: ['strategy'],
    type: 'game',
    tags: ['community-made'],
    releaseDate: '2025-05-01',
    developer: 'Joshua Shevach',
    developerUrl: 'https://www.joshe.app',
    resourceUrl: '/games/snake',
  },

  // Tools
  {
    id: 'unity',
    title: 'Unity',
    description: 'A powerful cross-platform game development engine',
    categories: ['game-development'],
    type: 'tool',
    tags: ['popular'],
    resourceUrl: new URL('https://unity.com'),
  },
  {
    id: 'blender',
    title: 'Blender',
    description: 'Free and open source 3D creation suite',
    categories: ['graphics-art'],
    type: 'tool',
    tags: ['popular', 'free', 'open-source'],
    resourceUrl: new URL('https://www.blender.org'),
  },
  {
    id: 'vscode',
    title: 'VS Code',
    description: 'Lightweight but powerful source code editor',
    categories: ['code-editors', 'development-tools'],
    type: 'tool',
    tags: ['popular', 'free', 'open-source'],
    resourceUrl: new URL('https://code.visualstudio.com'),
  },
  {
    id: 'godot',
    title: 'Godot',
    description: 'Free and open-source game engine',
    categories: ['game-development'],
    type: 'tool',
    tags: ['free', 'open-source', 'beginner-friendly'],
    resourceUrl: new URL('https://godotengine.org'),
  },
  {
    id: 'aseprite',
    title: 'Aseprite',
    description: 'Animated sprite editor & pixel art tool',
    categories: ['graphics-art'],
    type: 'tool',
    tags: [],
    resourceUrl: new URL('https://www.aseprite.org'),
  },
  {
    id: 'github',
    title: 'GitHub',
    description: 'Version control and collaboration platform',
    categories: ['development-tools'],
    type: 'tool',
    tags: ['popular'],
    resourceUrl: new URL('https://github.com'),
  },
  {
    id: 'trello',
    title: 'Trello',
    description: 'Project management tool',
    categories: ['project-management'],
    type: 'tool',
    tags: [],
    resourceUrl: new URL('https://trello.com'),
  },
  {
    id: 'linear',
    title: 'Linear',
    description: 'Project management tool',
    categories: ['project-management'],
    type: 'tool',
    tags: ['free'],
    resourceUrl: new URL('https://linear.com')
  },
  {
    id: 'visual-studio',
    title: 'Visual Studio',
    description: 'Integrated development environment from Microsoft',
    categories: ['code-editors'],
    type: 'tool',
    tags: ['free'],
    resourceUrl: new URL('https://visualstudio.microsoft.com'),
  },
  {
    id: 'pastemyst',
    title: 'Paste Myst',
    description: 'Paste text or files to share with others',
    categories: ['development-tools'],
    type: 'tool',
    tags: ['free', 'open-source'],
    resourceUrl: '/tools/paste-myst',
  },
];

export const categoryInfo: Record<ResourceCategory, CategoryInfo> = {
  action: {
    label: 'Action',
    icon: Swords,
    color: 'text-red-500',
    type: 'game'
  },
  puzzle: {
    label: 'Puzzle',
    icon: Brain,
    color: 'text-blue-500',
    type: 'game'
  },
  adventure: {
    label: 'Adventure',
    icon: WholeWord,
    color: 'text-brackeys-purple-600',
    type: 'game'
  },
  simulation: {
    label: 'Simulation',
    icon: Building,
    color: 'text-green-500',
    type: 'game'
  },
  strategy: {
    label: 'Strategy',
    icon: Trophy,
    color: 'text-yellow-500',
    type: 'game'
  },
  survival: {
    label: 'Survival',
    icon: Skull,
    color: 'text-brackeys-fuscia',
    type: 'game'
  },

  'game-development': {
    label: 'Game Development',
    icon: Gamepad2,
    color: 'text-teal-500',
    type: 'tool'
  },
  'graphics-art': {
    label: 'Graphics & Art',
    icon: WholeWord,
    color: 'text-pink-500',
    type: 'tool'
  },
  'code-editors': {
    label: 'Code Editors',
    icon: Wrench,
    color: 'text-indigo-500',
    type: 'tool'
  },
  'development-tools': {
    label: 'Development Tools',
    icon: Wrench,
    color: 'text-orange-500',
    type: 'tool'
  },
  'project-management': {
    label: 'Project Management',
    icon: Building,
    color: 'text-cyan-500',
    type: 'tool'
  }
};

export const tagInfo: Record<ResourceTag, TagInfo> = {
  'community-made': {
    label: 'Community Made',
    icon: Users,
    color: 'text-brackeys-fuscia bg-brackeys-purple-500/20'
  },
  'popular': {
    label: 'Popular',
    icon: Star,
    color: 'text-yellow-400 bg-yellow-500/20'
  },
  'free': {
    label: 'Free',
    icon: Tag,
    color: 'text-green-400 bg-green-500/20'
  },
  'open-source': {
    label: 'Open Source',
    icon: Tag,
    color: 'text-blue-400 bg-blue-500/20'
  },
  'beginner-friendly': {
    label: 'Beginner Friendly',
    icon: Tag,
    color: 'text-teal-400 bg-teal-500/20'
  }
};
