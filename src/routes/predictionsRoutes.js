import { Router } from 'express';
import { listPredictions, getPrediction, generatePrediction } from '../controllers/predictionsController.js';

const router = Router();

router.get('/', listPredictions);
router.get('/:id', getPrediction);
// Generating a prediction is a compute action, not a pure read — still
// available to any dashboard role since it has no operational effect by
// itself (it does NOT create an alert, see alertsController).
router.post('/generate', generatePrediction);

export default router;
