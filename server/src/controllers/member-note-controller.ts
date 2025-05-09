import { Request, Response } from 'express';
import memberNoteService from '../services/member-note-service.js';
import { z } from 'zod';
import { MemberNoteType } from '../models/hammer.js';
import { serializeBigInt } from '../utils/serializer.js';

class MemberNoteController {
  public async getMemberNotes(req: Request, res: Response): Promise<void> {
    try {
      const querySchema = z.object({
        guildId: z.string().regex(/^\d+$/).transform(val => BigInt(val)),
        userId: z.string().regex(/^\d+$/).transform(val => BigInt(val)).optional(),
        type: z.string().regex(/^\d+$/).transform(val => Number(val) as MemberNoteType).optional(),
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

      const notes = await memberNoteService.getMemberNotes(params);

      res.status(200).json({
        success: true,
        data: notes.map(serializeBigInt)
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

      console.error('Error fetching member notes:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch member notes'
      });
    }
  }

  public async getNotesByUserId(req: Request, res: Response): Promise<void> {
    try {
      const idSchema = z.string().regex(/^\d+$/).transform(val => BigInt(val));
      const id = idSchema.parse(req.params.id);

      const notes = await memberNoteService.getByUserId(id);

      if (!notes) {
        res.status(404).json({
          success: false,
          error: 'Member note not found'
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: notes.map(serializeBigInt)
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: 'Invalid user ID format'
        });
        return;
      }

      console.error('Error fetching member notes:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch member notes'
      });
    }
  }

  public async getUserNoteCount(req: Request, res: Response): Promise<void> {
    try {
      const paramsSchema = z.object({
        guildId: z.string().regex(/^\d+$/).transform(val => BigInt(val)),
        userId: z.string().regex(/^\d+$/).transform(val => BigInt(val))
      });

      const querySchema = z.object({
        type: z.string().regex(/^\d+$/).transform(val => Number(val) as MemberNoteType).optional()
      });

      const { guildId, userId } = paramsSchema.parse(req.params);
      const { type } = querySchema.parse(req.query);

      const count = await memberNoteService.countUserNotes(guildId, userId, type);

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

      console.error('Error counting user notes:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to count user notes'
      });
    }
  }
}

export default new MemberNoteController();
