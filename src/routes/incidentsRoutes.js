import { Router } from 'express';
import { listIncidents, createIncident, verifyIncident } from '../controllers/incidentsController.js';
import { requireCapability } from '../middleware/auth.js';

const router = Router();

router.get('/', listIncidents);
// Citizen reports now go through POST /api/citizen/reports instead (see
// citizenController.createReport), which sets reportedById and applies
// citizen-facing DTOs. This route stays as-is for dashboard-side manual
// entry (e.g. an authority logging a report phoned in) — it's mounted
// behind requireDashboardAccess like the rest of this router, so it was
// never actually reachable by citizens in the first place.
router.post('/', createIncident);
router.post('/:id/verify', requireCapability('canConfirm'), verifyIncident);

export default router;
