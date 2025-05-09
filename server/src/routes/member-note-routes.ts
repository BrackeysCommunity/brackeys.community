import { Router } from 'express';
import MemberNoteController from '../controllers/member-note-controller.js';
import { authenticate, authorizeUserAccess, authorizeAdminAccess } from '../middleware/auth-middleware.js';

const router = Router();

/**
 * Base path: /api/guilds
 */

router.get('/:guildId/notes', authenticate, authorizeAdminAccess('Access denied: Only admins can access this route'), MemberNoteController.getMemberNotes.bind(MemberNoteController));
router.get('/:guildId/notes/:userId', authenticate, authorizeUserAccess, MemberNoteController.getNotesByUserId.bind(MemberNoteController));

export default router;
