import { Router } from 'express';
import RuleController from '../controllers/rule-controller.js';

const router = Router();

/**
 * Base path: /api/guilds
 */

router.get('/:guildId/rules', RuleController.getAllRules.bind(RuleController));
router.get('/:guildId/rules/:ruleId', RuleController.getRuleById.bind(RuleController));

export default router;
