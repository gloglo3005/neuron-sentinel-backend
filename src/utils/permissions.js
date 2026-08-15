// Server-side capability matrix. Mirrors frontend/src/data/alerts.js `roles`
// exactly — the frontend only decides which buttons to *show*, this file is
// what actually decides whether an action is *allowed*. Never trust a role
// check that only happened in the browser.
//
// Role mapping (see conversation with the team):
//   CIVIL_PROTECTION  -> ANPC (Agence Nationale de Protection Civile) — coordinateur
//   AUTHORITY         -> Mairie de Lomé — agent municipal
//   EMERGENCY_SERVICE -> Sapeurs-Pompiers / GNSP — équipes terrain
//   ADMIN / CITIZEN   -> jamais autorisés à se connecter à ce dashboard (voir authController)
//
// CITIZEN a sa propre matrice, volontairement minimale : les citoyens
// n'ont jamais accès aux capacités dashboard ci-dessus (canConfirm,
// canDispatch, etc.), quel que soit ce qui est ajouté ici — voir
// requireCitizenAccess dans middleware/auth.js pour la séparation stricte
// des deux univers de rôles.

export const DASHBOARD_ROLES = ['CIVIL_PROTECTION', 'AUTHORITY', 'EMERGENCY_SERVICE'];
export const CITIZEN_ROLES = ['CITIZEN'];

const MATRIX = {
  CIVIL_PROTECTION: {
    canPropose: true, canConfirm: true, canReject: true, canRequestVerification: true,
    canDispatch: true, canClose: true, canFieldUpdate: false,
  },
  AUTHORITY: {
    canPropose: true, canConfirm: false, canReject: false, canRequestVerification: false,
    canDispatch: false, canClose: false, canFieldUpdate: false,
  },
  EMERGENCY_SERVICE: {
    canPropose: false, canConfirm: false, canReject: false, canRequestVerification: false,
    canDispatch: false, canClose: false, canFieldUpdate: true,
  },
  CITIZEN: {
    // Tout le reste (lecture météo/risque/alertes de sa zone) ne passe pas
    // par can() — ce sont de simples lectures filtrées par zone, pas des
    // actions à autoriser au cas par cas. Seul le signalement est une
    // action à part entière.
    canReport: true,
  },
};

export function can(user, capability) {
  if (!user.canWrite) return false; // read-only account (e.g. observateur ONG) — always blocked
  return Boolean(MATRIX[user.role]?.[capability]);
}
