import { Router } from 'express';
import authRoutes from './authRoutes.js';
import citizenRoutes from './citizenRoutes.js';
import zonesRoutes from './zonesRoutes.js';
import environmentalRoutes from './environmentalRoutes.js';
import predictionsRoutes from './predictionsRoutes.js';
import alertsRoutes from './alertsRoutes.js';
import incidentsRoutes from './incidentsRoutes.js';
import interventionsRoutes from './interventionsRoutes.js';
import reportsRoutes from './reportsRoutes.js';
import dashboardRoutes from './dashboardRoutes.js';
import { requireAuth, requireDashboardAccess } from '../middleware/auth.js';

const router = Router();

// /api/auth/login is the one unauthenticated route in the whole API — it
// carries its own gate (loginLimiter, role check) inside authRoutes.js.
router.use('/auth', authRoutes);

// /api/citizen/* has its own internal auth split (public register/login,
// then requireAuth + requireCitizenAccess for the rest — see
// citizenRoutes.js), same pattern as /auth above. It must be mounted
// before the dashboard-only gate below, or CITIZEN accounts would get
// rejected by requireDashboardAccess before ever reaching their own routes.
router.use('/citizen', citizenRoutes);

// Everything else requires a valid session AND one of the three dashboard
// roles (CIVIL_PROTECTION / AUTHORITY / EMERGENCY_SERVICE) — see spec
// section on hardened access: ADMIN and CITIZEN never reach these routes.
router.use(requireAuth, requireDashboardAccess);

router.use('/zones', zonesRoutes);
router.use('/environmental-data', environmentalRoutes);
router.use('/predictions', predictionsRoutes);
router.use('/alerts', alertsRoutes);
router.use('/incidents', incidentsRoutes);
router.use('/interventions', interventionsRoutes);
router.use('/reports', reportsRoutes);
router.use('/dashboard', dashboardRoutes);

export default router;
