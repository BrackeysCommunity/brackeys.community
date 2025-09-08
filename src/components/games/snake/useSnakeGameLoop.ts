import { useState, useEffect, useRef, useCallback } from 'react';
import { Direction, Position } from './snakeTypes';
import { generateFood, checkCollision, getLocalStorage, setLocalStorage } from './snakeUtils';

const GRID_SIZE = 20;
const INITIAL_SNAKE_POSITION = [
  { x: 10, y: 10 },
  { x: 9, y: 10 },
  { x: 8, y: 10 },
];
const INITIAL_FOOD_POSITION = { x: 15, y: 10 };
const INITIAL_DIRECTION = Direction.RIGHT;
const GAME_SPEED = 150; // milliseconds

export const useSnakeGameLoop = () => {
  const [snake, setSnake] = useState<Position[]>(INITIAL_SNAKE_POSITION);
  const [food, setFood] = useState<Position>(INITIAL_FOOD_POSITION);
  const [direction, setDirection] = useState<Direction>(INITIAL_DIRECTION);
  const [isGameOver, setIsGameOver] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [score, setScore] = useState<number>(0);
  const [highScore, setHighScore] = useState<number>(getLocalStorage('snakeHighScore', 0));
  const directionRef = useRef(direction);
  const gameTimer = useRef<number | null>(null);

  useEffect(() => {
    directionRef.current = direction;
  }, [direction]);

  useEffect(() => {
    setFood(generateFood(snake, GRID_SIZE));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const gameLoop = useCallback(() => {
    if (isGameOver || isPaused) return;

    setSnake(prevSnake => {
      // callculate new head position
      const head = { ...prevSnake[0] };

      switch (directionRef.current) {
        case Direction.UP:
          head.y -= 1;
          break;
        case Direction.DOWN:
          head.y += 1;
          break;
        case Direction.LEFT:
          head.x -= 1;
          break;
        case Direction.RIGHT:
          head.x += 1;
          break;
      }

      // check for collisions
      if (checkCollision(head, prevSnake, GRID_SIZE)) {
        setIsGameOver(true);

        // update high score if needed
        if (score > highScore) {
          setHighScore(score);
          setLocalStorage('snakeHighScore', score);
        }

        return prevSnake;
      }

      // xreate new snake body
      const newSnake = [head, ...prevSnake];

      // check if snake ate food
      if (head.x === food.x && head.y === food.y) {
        // generate new food
        setFood(generateFood(newSnake, GRID_SIZE));

        // increase score
        setScore(prevScore => prevScore + 10);
      } else {
        // remove tail if no food was eaten
        newSnake.pop();
      }

      return newSnake;
    });
  }, [food, isGameOver, isPaused, score, highScore]);

  useEffect(() => {
    gameTimer.current = window.setInterval(gameLoop, GAME_SPEED);

    return () => {
      if (gameTimer.current) {
        clearInterval(gameTimer.current);
      }
    };
  }, [gameLoop]);

  const resetGame = useCallback(() => {
    setSnake(INITIAL_SNAKE_POSITION);
    setFood(generateFood(INITIAL_SNAKE_POSITION, GRID_SIZE));
    setDirection(INITIAL_DIRECTION);
    directionRef.current = INITIAL_DIRECTION;
    setIsGameOver(false);
    setIsPaused(false);
    setScore(0);
  }, []);

  const togglePause = useCallback(() => {
    if (!isGameOver) {
      setIsPaused(prev => !prev);
    }
  }, [isGameOver]);

  const handleDirectionChange = useCallback(
    (newDirection: Direction) => {
      if (
        isPaused ||
        isGameOver ||
        (newDirection === Direction.UP && directionRef.current === Direction.DOWN) ||
        (newDirection === Direction.DOWN && directionRef.current === Direction.UP) ||
        (newDirection === Direction.LEFT && directionRef.current === Direction.RIGHT) ||
        (newDirection === Direction.RIGHT && directionRef.current === Direction.LEFT)
      )
        return;

      setDirection(newDirection);
    },
    [isPaused, isGameOver]
  );

  return {
    snake,
    food,
    direction,
    isGameOver,
    isPaused,
    score,
    highScore,
    setDirection: handleDirectionChange,
    resetGame,
    togglePause,
  };
};
