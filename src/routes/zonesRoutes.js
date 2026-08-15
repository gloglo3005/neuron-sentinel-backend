import { Router } from 'express';
import { listZones, getZone, getZonePredictions, syncZoneGeometry } from '../controllers/zonesController.js';

const router = Router();

router.get('/', listZones);
router.post('/sync-geometry', syncZoneGeometry);
router.get('/:id', getZone);
router.get('/:id/predictions', getZonePredictions);

export default router;