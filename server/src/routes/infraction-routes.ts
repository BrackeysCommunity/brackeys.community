import { Router } from 'express';
import infractionController from '../controllers/infraction-controller.js';

const router = Router();

/**
 * Routes for infractions
 * Base path: /api/guilds
 */

router.get('/:guildId/infractions', infractionController.getInfractions.bind(infractionController));
router.get('/infractions/:id', infractionController.getInfractionById.bind(infractionController));
router.get('/:guildId/users/:userId/infractions/count', infractionController.getUserInfractionCount.bind(infractionController));

export default router;
