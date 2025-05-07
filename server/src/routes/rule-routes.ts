import { Router } from 'express';
import ruleController from '../controllers/rule-controller.js';

const router = Router();

router.get('/:guildId/rules', ruleController.getAllRules.bind(ruleController));
router.get('/:guildId/rules/:ruleId', ruleController.getRuleById.bind(ruleController));

export default router;
