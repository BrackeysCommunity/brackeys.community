import { Router } from 'express';
import * as infractionController from '../controllers/infraction-controller.js';

const router = Router();

/**
 * Base path: /api/guilds
 */

router.get('/:guildId/infractions', infractionController.getInfractions.bind(infractionController));
router.get('/infractions/:id', infractionController.getInfractionsByUserId.bind(infractionController));
router.get('/:guildId/users/:userId/infractions/count', infractionController.getUserInfractionCount.bind(infractionController));

export default router;
