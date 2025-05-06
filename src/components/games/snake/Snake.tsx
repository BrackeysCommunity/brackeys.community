import { SnakeBoard } from './SnakeBoard';
import { SnakeController } from './SnakeController';
import { SnakeStatus } from './SnakeStatus';
import { useSnakeGameLoop } from './useSnakeGameLoop';

export const Snake = () => {
  const {
    snake,
    food,
    score,
    direction,
    isGameOver,
    isPaused,
    highScore,
    setDirection,
    resetGame,
    togglePause
  } = useSnakeGameLoop();

  return (
    <div className="relative max-w-md mx-auto w-full">
      <SnakeStatus
        score={score}
        highScore={highScore}
      />

      <div className="relative">
        <SnakeBoard
          snake={snake}
          food={food}
          isGameOver={isGameOver}
          isPaused={isPaused}
        />

        {isGameOver && (
          <div className="absolute inset-0 flex items-center justify-center bg-opacity-60 rounded-lg">
            <div className="bg-red-500 text-white p-4 rounded-md font-semibold text-center animate-pulse">
              <h2 className="text-xl mb-2">Game Over!</h2>
              <p>Press Reset to play again</p>
            </div>
          </div>
        )}

        {isPaused && !isGameOver && (
          <div className="absolute inset-0 flex items-center justify-center bg-opacity-50 rounded-lg">
            <div className="bg-yellow-500 text-white p-4 rounded-md font-semibold text-center">
              <h2 className="text-xl mb-2">Game Paused</h2>
              <p>Press Play to continue</p>
            </div>
          </div>
        )}
      </div>

      <SnakeController
        onDirectionChange={setDirection}
        onReset={resetGame}
        onTogglePause={togglePause}
        isPaused={isPaused}
        isGameOver={isGameOver}
        currentDirection={direction}
      />
    </div>
  );
};