import { Router } from 'express';
import {
  listAlerts, getAlert, getTimeline, createAlert,
  confirmAlert, requestVerification, rejectAlert, dispatchAlert,
  fieldEngage, resolveAlert, closeAlert,
} from '../controllers/alertsController.js';
import { requireCapability } from '../middleware/auth.js';
import { validate, createAlertSchema, rejectAlertSchema } from '../validators/alertValidators.js';

const router = Router();

router.get('/', listAlerts);
router.get('/:id', getAlert);
router.get('/:id/timeline', getTimeline);

router.post('/', requireCapability('canPropose'), validate(createAlertSchema), createAlert);
router.post('/:id/confirm', requireCapability('canConfirm'), confirmAlert);
router.post('/:id/request-verification', requireCapability('canRequestVerification'), requestVerification);
router.post('/:id/reject', requireCapability('canReject'), validate(rejectAlertSchema), rejectAlert);
router.post('/:id/dispatch', requireCapability('canDispatch'), dispatchAlert);
router.post('/:id/field-engage', requireCapability('canFieldUpdate'), fieldEngage);
router.post('/:id/resolve', requireCapability('canFieldUpdate'), resolveAlert);
router.post('/:id/close', requireCapability('canClose'), closeAlert);

export default router;
