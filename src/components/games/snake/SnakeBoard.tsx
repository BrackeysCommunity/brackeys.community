import { cn } from '../../../lib/utils';
import { Position } from './snakeTypes';

type GameBoardProps = {
  snake: Position[];
  food: Position;
  isGameOver: boolean;
  isPaused: boolean;
}

export const SnakeBoard = ({ snake, food, isGameOver, isPaused }: GameBoardProps) => {
  const gridSize = 20;
  const grid = Array(gridSize).fill(null).map(() => Array(gridSize).fill(null));

  const isSnake = (row: number, col: number) => {
    return snake.some(segment => segment.x === col && segment.y === row);
  };

  const isSnakeHead = (row: number, col: number) => {
    return snake.length > 0 && snake[0].x === col && snake[0].y === row;
  };

  const isFood = (row: number, col: number) => {
    return food.x === col && food.y === row;
  };

  return (
    <div
      className={cn(
        "grid grid-cols-20 gap-0 border-2 border-gray-700 bg-gray-800 rounded-lg overflow-hidden transition-opacity duration-300 w-full mx-auto max-w-md aspect-square",
        isGameOver || isPaused ? "opacity-50" : "opacity-100"
      )}
    >
      {grid.map((row, rowIndex) =>
        row.map((_, colIndex) => (
          <div
            key={`${rowIndex}-${colIndex}`}
            className={cn(
              isSnakeHead(rowIndex, colIndex) && 'bg-green-500',
              isSnake(rowIndex, colIndex) && !isSnakeHead(rowIndex, colIndex) && 'bg-green-400',
              isFood(rowIndex, colIndex) && 'bg-gradient-to-br from-brackeys-yellow via-brackeys-fuscia to-brackeys-purple',
              !isSnake(rowIndex, colIndex) && !isFood(rowIndex, colIndex) && 'bg-gray-800',
              'border border-gray-700 rounded-sm transition-colors duration-150'
            )}
          />
        ))
      )}
    </div>
  );
};