import { Router } from 'express';
import InfractionController from '../controllers/infraction-controller.js';
import { authenticate, authorizeUserAccess, authorizeAdminAccess } from '../middleware/auth-middleware.js';

const router = Router();

/**
 * Base path: /api/guilds
 */

router.get('/:guildId/infractions', authenticate, authorizeAdminAccess('Access denied: Only admins can access this route'), InfractionController.getInfractions.bind(InfractionController));
router.get('/:guildId/infractions/:userId', authenticate, authorizeUserAccess, InfractionController.getInfractionsByUserId.bind(InfractionController));

export default router;
