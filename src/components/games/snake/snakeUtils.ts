import { Position } from "./snakeTypes";

export const generateFood = (snake: Position[], gridSize: number): Position => {
  let newFood: Position;

  do {
    newFood = {
      x: Math.floor(Math.random() * gridSize),
      y: Math.floor(Math.random() * gridSize),
    };
  } while (snake.some(segment => segment.x === newFood.x && segment.y === newFood.y));

  return newFood;
};

export const checkCollision = (
  position: Position,
  snake: Position[],
  gridSize: number
): boolean => {
  if (
    position.x < 0 ||
    position.y < 0 ||
    position.x >= gridSize ||
    position.y >= gridSize
  ) {
    return true;
  }

  for (let i = 1; i < snake.length; i++) {
    if (position.x === snake[i].x && position.y === snake[i].y) {
      return true;
    }
  }

  return false;
};

export const getLocalStorage = <T>(key: string, fallback: T): T => {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : fallback;
  } catch (error) {
    console.error('Error getting from localStorage:', error);
    return fallback;
  }
};

export const setLocalStorage = <T>(key: string, value: T): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error('Error setting localStorage:', error);
  }
};