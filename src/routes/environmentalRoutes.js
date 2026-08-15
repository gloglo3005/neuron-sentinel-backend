import { Router } from 'express';
import { listEnvironmentalData, syncEnvironmentalData } from '../controllers/environmentalController.js';

const router = Router();
router.get('/', listEnvironmentalData);
router.post('/sync', syncEnvironmentalData);
export default router;