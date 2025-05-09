import { Request, Response } from 'express';
import RuleService from '../services/rule-service.js';
import { z } from 'zod';

const getAllRules = async (req: Request, res: Response): Promise<void> => {
  try {
    const guildIdSchema = z.string().regex(/^\d+$/).transform(val => BigInt(val));
    const guildId = guildIdSchema.parse(req.params.guildId);

    const rules = await RuleService.getAllByGuildId(guildId);

    res.status(200).json({
      success: true,
      data: rules.map(rule => ({
        ...rule,
        id: rule.id.toString(),
        guildId: rule.guildId.toString()
      }))
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        success: false,
        error: 'Invalid guild ID format'
      });
      return;
    }

    console.error('Error fetching rules:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch rules'
    });
  }
};

const getRuleById = async (req: Request, res: Response): Promise<void> => {
  try {
    const paramsSchema = z.object({
      guildId: z.string().regex(/^\d+$/).transform(val => BigInt(val)),
      ruleId: z.string().regex(/^\d+$/).transform(val => BigInt(val))
    });

    const { guildId, ruleId } = paramsSchema.parse(req.params);
    const rule = await RuleService.getById(ruleId, guildId);

    if (!rule) {
      res.status(404).json({
        success: false,
        error: 'Rule not found'
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        ...rule,
        id: rule.id.toString(),
        guildId: rule.guildId.toString()
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        success: false,
        error: 'Invalid request parameters'
      });
      return;
    }

    console.error('Error fetching rule:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch rule'
    });
  }
};

export default {
  getAllRules,
  getRuleById
};

