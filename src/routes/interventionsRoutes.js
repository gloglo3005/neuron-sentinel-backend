import { Router } from 'express';
import { listInterventions, createIntervention, updateInterventionStatus } from '../controllers/interventionsController.js';
import { requireCapability } from '../middleware/auth.js';

const router = Router();

router.get('/', listInterventions);
router.post('/', requireCapability('canDispatch'), createIntervention);
router.post('/:id/status', requireCapability('canFieldUpdate'), updateInterventionStatus);

export default router;
