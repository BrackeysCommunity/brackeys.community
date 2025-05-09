import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export type JwtPayload = {
  sub: string;
  iat: number;
  exp: number;
};

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: bigint;
      };
    }
  }
}

const staffIds = process.env.STAFF_MEMBER?.split(',')?.map(v => BigInt(v));

export const authenticate = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      res.status(401).json({
        success: false,
        error: 'Authorization header is missing'
      });
      return;
    }

    if (!authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        error: 'Invalid authorization format, must be Bearer token'
      });
      return;
    }

    const token = authHeader.substring(7);

    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      console.error('JWT_SECRET is not in env');
      res.status(500).json({
        success: false,
        error: 'Authentication config error'
      });
      return;
    }

    const decoded = jwt.verify(token, jwtSecret) as JwtPayload;

    req.auth = {
      userId: BigInt(decoded.sub)
    };

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({
        success: false,
        error: 'Invalid token'
      });
      return;
    }

    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({
        success: false,
        error: 'Token expired'
      });
      return;
    }

    console.error('Authentication error:', error);
    res.status(500).json({
      success: false,
      error: 'Authentication failed'
    });
  }
};

export const authorizeAdminAccess = (adminError: string) => (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    const authUserId = req.auth?.userId;

    if (!authUserId || !staffIds?.includes(authUserId)) {
      res.status(403).json({
        success: false,
        error: adminError
      });
      return;
    }

    next();
  } catch (error) {
    console.error('Authorization error:', error);
    res.status(500).json({
      success: false,
      error: 'Authorization failed'
    });
  }
};

export const authorizeUserAccess = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    const authUserId = req.auth?.userId;

    if (!authUserId) {
      res.status(401).json({
        success: false,
        error: 'Not authenticated'
      });
      return;
    }

    let requestedUserId: bigint | undefined;

    if (req.params.userId) {
      requestedUserId = BigInt(req.params.userId);
    } else if (req.query.userId) {
      requestedUserId = BigInt(req.query.userId as string);
    }

    if (requestedUserId !== undefined && authUserId !== requestedUserId) {
      authorizeAdminAccess('Access denied: You can only access your own data')(req, res, next);
      return;
    } else {
      next();
    }
  } catch (error) {
    console.error('Authorization error:', error);
    res.status(500).json({
      success: false,
      error: 'Authorization failed'
    });
  }
};
