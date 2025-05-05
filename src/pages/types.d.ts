type RecentActivityItem = {
  id: number;
  action: string;
  description: string;
  channel?: string;
  time: string;
}

type GameItem = {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  category: 'action' | 'puzzle' | 'adventure' | 'simulation' | 'strategy' | 'survival';
  releaseDate: string;
  developer: string;
  developerUrl: string;
  gameUrl: string;
};