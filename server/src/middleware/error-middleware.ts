import { Request, Response, NextFunction } from 'express';

export class ApiError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'ApiError';
  }
};

export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    error: `Not found - ${req.originalUrl}`
  });
};

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  console.error(err);

  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      success: false,
      error: err.message
    });
    return;
  }

  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
};
