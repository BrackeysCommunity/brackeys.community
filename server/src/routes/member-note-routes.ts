import { Router } from 'express';
import memberNoteController from '../controllers/member-note-controller.js';

const router = Router();

/**
 * Base path: /api/guilds
 */

router.get('/:guildId/notes', memberNoteController.getMemberNotes.bind(memberNoteController));
router.get('/notes/:id', memberNoteController.getNotesByUserId.bind(memberNoteController));
router.get('/:guildId/users/:userId/notes/count', memberNoteController.getUserNoteCount.bind(memberNoteController));

export default router;
