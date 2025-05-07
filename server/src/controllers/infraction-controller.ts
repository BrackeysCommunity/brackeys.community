import { Request, Response } from 'express';
import infractionService from '../services/infraction-service.js';
import { z } from 'zod';
import { InfractionType } from '../models/types.js';

class InfractionController {
  public async getInfractions(req: Request, res: Response): Promise<void> {
    try {
      const querySchema = z.object({
        guildId: z.string().regex(/^\d+$/).transform(val => BigInt(val)),
        userId: z.string().regex(/^\d+$/).transform(val => BigInt(val)).optional(),
        type: z.string().regex(/^\d+$/).transform(val => Number(val) as InfractionType).optional(),
        limit: z.string().regex(/^\d+$/).transform(val => Number(val)).optional(),
        offset: z.string().regex(/^\d+$/).transform(val => Number(val)).optional()
      });

      const params = querySchema.parse({
        guildId: req.params.guildId,
        userId: req.query.userId,
        type: req.query.type,
        limit: req.query.limit,
        offset: req.query.offset
      });

      const infractions = await infractionService.getInfractions(params);

      res.status(200).json({
        success: true,
        data: infractions.map(infraction => ({
          ...infraction,
          id: infraction.id.toString(),
          guildId: infraction.guildId.toString(),
          staffMemberId: infraction.staffMemberId.toString(),
          userId: infraction.userId.toString()
        }))
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: 'Invalid request parameters',
          details: error.errors
        });
        return;
      }

      console.error('Error fetching infractions:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch infractions'
      });
    }
  }

  public async getInfractionById(req: Request, res: Response): Promise<void> {
    try {
      const idSchema = z.string().regex(/^\d+$/).transform(val => BigInt(val));
      const id = idSchema.parse(req.params.id);

      const infraction = await infractionService.getById(id);

      if (!infraction) {
        res.status(404).json({
          success: false,
          error: 'Infraction not found'
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: {
          ...infraction,
          id: infraction.id.toString(),
          guildId: infraction.guildId.toString(),
          staffMemberId: infraction.staffMemberId.toString(),
          userId: infraction.userId.toString()
        }
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: 'Invalid infraction ID format'
        });
        return;
      }

      console.error('Error fetching infraction:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch infraction'
      });
    }
  }

  public async getUserInfractionCount(req: Request, res: Response): Promise<void> {
    try {
      const paramsSchema = z.object({
        guildId: z.string().regex(/^\d+$/).transform(val => BigInt(val)),
        userId: z.string().regex(/^\d+$/).transform(val => BigInt(val))
      });

      const querySchema = z.object({
        type: z.string().regex(/^\d+$/).transform(val => Number(val) as InfractionType).optional()
      });

      const { guildId, userId } = paramsSchema.parse(req.params);
      const { type } = querySchema.parse(req.query);

      const count = await infractionService.countUserInfractions(guildId, userId, type);

      res.status(200).json({
        success: true,
        data: { count }
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: 'Invalid request parameters'
        });
        return;
      }

      console.error('Error counting user infractions:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to count user infractions'
      });
    }
  }
}

export default new InfractionController();
