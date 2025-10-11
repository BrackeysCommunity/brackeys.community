import { useEffect, useRef } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Pause,
  Play,
  RefreshCw,
} from 'lucide-react';
import { Direction } from './snakeTypes';

type GameControlsProps = {
  onDirectionChange: (direction: Direction) => void;
  onReset: () => void;
  onTogglePause: () => void;
  isPaused: boolean;
  isGameOver: boolean;
  currentDirection: Direction;
};

export const SnakeController = ({
  onDirectionChange,
  onReset,
  onTogglePause,
  isPaused,
  isGameOver,
  currentDirection,
}: GameControlsProps) => {
  const lastDirectionChange = useRef<number>(0);
  const directionDebounceTime = 100;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const now = Date.now();
      if (now - lastDirectionChange.current < directionDebounceTime) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'arrowup':
        case 'w':
          if (currentDirection !== Direction.DOWN) {
            onDirectionChange(Direction.UP);
            lastDirectionChange.current = now;
          }
          break;
        case 'arrowdown':
        case 's':
          if (currentDirection !== Direction.UP) {
            onDirectionChange(Direction.DOWN);
            lastDirectionChange.current = now;
          }
          break;
        case 'arrowleft':
        case 'a':
          if (currentDirection !== Direction.RIGHT) {
            onDirectionChange(Direction.LEFT);
            lastDirectionChange.current = now;
          }
          break;
        case 'arrowright':
        case 'd':
          if (currentDirection !== Direction.LEFT) {
            onDirectionChange(Direction.RIGHT);
            lastDirectionChange.current = now;
          }
          break;
        case ' ':
        case 'p':
        case 'escape':
          onTogglePause();
          break;
        case 'r':
          onReset();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    onDirectionChange,
    onReset,
    onTogglePause,
    currentDirection,
    directionDebounceTime,
  ]);

  const isDisabled = (direction: Direction): boolean => {
    if (direction === Direction.UP && currentDirection === Direction.DOWN)
      return true;
    if (direction === Direction.DOWN && currentDirection === Direction.UP)
      return true;
    if (direction === Direction.LEFT && currentDirection === Direction.RIGHT)
      return true;
    if (direction === Direction.RIGHT && currentDirection === Direction.LEFT)
      return true;
    return false;
  };

  const handleDirectionClick = (direction: Direction) => {
    const now = Date.now();
    if (
      now - lastDirectionChange.current < directionDebounceTime ||
      isDisabled(direction) ||
      isGameOver
    ) {
      return;
    }

    onDirectionChange(direction);
    lastDirectionChange.current = now;
  };

  return (
    <div className="mt-2 w-full">
      <div className="flex items-center justify-between">
        <div className="flex space-x-2">
          <button
            className="px-3 py-1 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 flex items-center"
            onClick={onTogglePause}
            disabled={isGameOver}
          >
            {isPaused ? (
              <Play size={16} className="mr-1" />
            ) : (
              <Pause size={16} className="mr-1" />
            )}
            {isPaused ? 'Play' : 'Pause'}
          </button>
          <button
            className="px-3 py-1 bg-red-600 text-white text-sm rounded-md hover:bg-red-700 flex items-center"
            onClick={onReset}
          >
            <RefreshCw size={16} className="mr-1" />
            Reset
          </button>
        </div>

        <div className="grid grid-cols-3 gap-1 max-w-[120px]">
          <div />
          <div>
            <button
              className={`w-full p-2 rounded-lg ${
                isDisabled(Direction.UP)
                  ? 'bg-gray-700 text-gray-500'
                  : 'bg-gray-700 hover:bg-gray-600 text-white'
              }`}
              onClick={() => handleDirectionClick(Direction.UP)}
              disabled={isDisabled(Direction.UP) || isGameOver}
              aria-label="Move Up"
            >
              <ArrowUp className="mx-auto" size={18} />
            </button>
          </div>
          <div />
          <div>
            <button
              className={`w-full p-2 rounded-lg ${
                isDisabled(Direction.LEFT)
                  ? 'bg-gray-700 text-gray-500'
                  : 'bg-gray-700 hover:bg-gray-600 text-white'
              }`}
              onClick={() => handleDirectionClick(Direction.LEFT)}
              disabled={isDisabled(Direction.LEFT) || isGameOver}
              aria-label="Move Left"
            >
              <ArrowLeft className="mx-auto" size={18} />
            </button>
          </div>
          <div>
            <button
              className={`w-full p-2 rounded-lg ${
                isDisabled(Direction.DOWN)
                  ? 'bg-gray-700 text-gray-500'
                  : 'bg-gray-700 hover:bg-gray-600 text-white'
              }`}
              onClick={() => handleDirectionClick(Direction.DOWN)}
              disabled={isDisabled(Direction.DOWN) || isGameOver}
              aria-label="Move Down"
            >
              <ArrowDown className="mx-auto" size={18} />
            </button>
          </div>
          <div>
            <button
              className={`w-full p-2 rounded-lg ${
                isDisabled(Direction.RIGHT)
                  ? 'bg-gray-700 text-gray-500'
                  : 'bg-gray-700 hover:bg-gray-600 text-white'
              }`}
              onClick={() => handleDirectionClick(Direction.RIGHT)}
              disabled={isDisabled(Direction.RIGHT) || isGameOver}
              aria-label="Move Right"
            >
              <ArrowRight className="mx-auto" size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
