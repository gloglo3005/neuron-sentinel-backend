import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Same 8 quartiers as frontend/src/data/zones.js
const ZONES = [
  {
    name: 'Bè',
    code: 'BE',
    lat: 6.1257,
    lng: 1.2282,
    pop: 12400,
    drain: 70,
    hist: 20,
    rain: 38,
    radius: 900,
  },
  {
    name: 'Kodjoviakopé',
    code: 'KDV',
    lat: 6.1274,
    lng: 1.2033,
    pop: 9100,
    drain: 35,
    hist: 75,
    rain: 88,
    radius: 750,
  },
  {
    name: 'Amoutivé',
    code: 'AMT',
    lat: 6.1354,
    lng: 1.2197,
    pop: 7300,
    drain: 50,
    hist: 40,
    rain: 60,
    radius: 700,
  },
  {
    name: 'Tokoin',
    code: 'TKN',
    lat: 6.1508,
    lng: 1.2191,
    pop: 15600,
    drain: 80,
    hist: 15,
    rain: 30,
    radius: 1100,
  },
  {
    name: 'Djidjolé',
    code: 'DJD',
    lat: 6.1612,
    lng: 1.2338,
    pop: 6200,
    drain: 48,
    hist: 44,
    rain: 57,
    radius: 700,
  },
  {
    name: 'Adidogomé',
    code: 'ADG',
    lat: 6.1782,
    lng: 1.1987,
    pop: 21000,
    drain: 85,
    hist: 10,
    rain: 25,
    radius: 1300,
  },
  {
    name: 'Agoè',
    code: 'AGO',
    lat: 6.1873,
    lng: 1.2158,
    pop: 18400,
    drain: 75,
    hist: 22,
    rain: 33,
    radius: 1200,
  },
  {
    name: 'Baguida',
    code: 'BGD',
    lat: 6.1452,
    lng: 1.3341,
    pop: 5800,
    drain: 35,
    hist: 65,
    rain: 61,
    radius: 800,
  },
  { name: 'Hédzranawoé', code: 'HED', lat: 6.185, lng: 1.2484, pop: 26000, drain: 55, hist: 48, rain: 52, radius: 1500 },
  { name: 'Nyékonakpoè', code: 'NYE', lat: 6.1302, lng: 1.2059, pop: 8200, drain: 65, hist: 25, rain: 35, radius: 1060 },
  { name: 'Akodesséwa', code: 'AKO', lat: 6.1536, lng: 1.2673, pop: 9800, drain: 40, hist: 55, rain: 58, radius: 1500 },
  { name: 'Doulassamé', code: 'DOU', lat: 6.1402, lng: 1.227, pop: 6700, drain: 55, hist: 35, rain: 45, radius: 805 },
  { name: 'Hanoukopé', code: 'HAN', lat: 6.1378, lng: 1.2186, pop: 7100, drain: 52, hist: 38, rain: 48, radius: 492 },
];

function riskLevelOf(probability) {
  return probability >= 80
    ? 'CRITICAL'
    : probability >= 55
      ? 'HIGH'
      : probability >= 30
        ? 'MODERATE'
        : 'LOW';
}

async function main() {
  console.log(
    'Seed — comptes de démonstration (mots de passe pour usage LOCAL uniquement)'
  );

  // -----------------------------------------------------------------------
  // COMPTES UTILISATEURS
  // -----------------------------------------------------------------------

  const password = await bcrypt.hash('NeuronDemo#2026', 10);

  const anpc = await prisma.user.upsert({
    where: { phone: '+22890000001' },
    update: {},
    create: {
      name: 'Koffi Adjovi',
      phone: '+22890000001',
      email: 'anpc@neuronsentinel.tg',
      passwordHash: password,
      role: 'CIVIL_PROTECTION',
    },
  });

  const mairie = await prisma.user.upsert({
    where: { phone: '+22890000002' },
    update: {},
    create: {
      name: 'Ama Séna',
      phone: '+22890000002',
      email: 'mairie@neuronsentinel.tg',
      passwordHash: password,
      role: 'AUTHORITY',
    },
  });

  const pompiers = await prisma.user.upsert({
    where: { phone: '+22890000003' },
    update: {},
    create: {
      name: 'Cpt. Edem Kwassi',
      phone: '+22890000003',
      email: 'gnsp@neuronsentinel.tg',
      passwordHash: password,
      role: 'EMERGENCY_SERVICE',
    },
  });

  // Compte observateur en lecture seule
  await prisma.user.upsert({
    where: { phone: '+22890000004' },
    update: {},
    create: {
      name: 'J. Fernández',
      phone: '+22890000004',
      email: 'observateur@neuronsentinel.tg',
      passwordHash: password,
      role: 'AUTHORITY',
      canWrite: false,
    },
  });

  // -----------------------------------------------------------------------
  // ZONES
  // -----------------------------------------------------------------------

  const zoneRows = {};

  for (const z of ZONES) {
    zoneRows[z.name] = await prisma.zone.upsert({
      where: { name: z.name },
      update: {},
      create: {
        name: z.name,
        code: z.code,
        latitude: z.lat,
        longitude: z.lng,
        population: z.pop,
        drainScore: z.drain,
        historyScore: z.hist,
        rainScore: z.rain,
        radius: z.radius,
        riskLevel: riskLevelOf(z.rain * 0.6 + z.hist * 0.3),
      },
    });
  }

  // Affectation des pompiers à Baguida
  await prisma.user.update({
    where: { id: pompiers.id },
    data: {
      assignedZoneId: zoneRows['Baguida'].id,
    },
  });

  // -----------------------------------------------------------------------
  // DONNÉES ENVIRONNEMENTALES
  // -----------------------------------------------------------------------

  const now = Date.now();

  for (const z of ZONES) {
    const points = [
      z.rain * 0.4,
      z.rain * 0.6,
      z.rain * 0.8,
      z.rain,
    ];

    for (let i = 0; i < points.length; i++) {
      await prisma.environmentalData.create({
        data: {
          zoneId: zoneRows[z.name].id,
          source: 'MOCK',
          timestamp: new Date(
            now - (points.length - i) * 3600_000
          ),
          rainfall: Math.round(points[i]),
          temperature: 26 + Math.random() * 3,
          humidity: 60 + Math.random() * 25,
          windSpeed: 8 + Math.random() * 12,
        },
      });
    }
  }

  // -----------------------------------------------------------------------
  // PRÉDICTIONS + FACTEURS
  // -----------------------------------------------------------------------

  const HORIZON_SERIES = {
    'Bè': [22, 26, 30, 24, 16],
    'Kodjoviakopé': [81, 88, 92, 85, 60],
    'Amoutivé': [55, 60, 66, 58, 38],
    Tokoin: [18, 20, 22, 17, 12],
    'Djidjolé': [58, 64, 70, 62, 40],
    'Adidogomé': [15, 17, 19, 14, 10],
    'Agoè': [20, 23, 26, 20, 14],
    Baguida: [84, 90, 95, 88, 55],
    'Hédzranawoé': [32, 38, 44, 37, 24],
    'Nyékonakpoè': [22, 26, 30, 23, 15],
    'Akodesséwa': [40, 48, 55, 46, 30],
    'Doulassamé': [28, 32, 38, 32, 20],
    'Hanoukopé': [29, 34, 40, 33, 21],
  };

  const horizons = [0, 6, 12, 24, 48];
  const predictionByZone = {};

  for (const z of ZONES) {
    const series = HORIZON_SERIES[z.name];

    for (let i = 0; i < horizons.length; i++) {
      const probability = series[i];

      const confidence = Math.round(
        96 - i * 3 - Math.random() * 5
      );

      const pred = await prisma.prediction.create({
        data: {
          zoneId: zoneRows[z.name].id,
          horizon: horizons[i],
          probability,
          confidence,
          riskLevel: riskLevelOf(probability),
          modelVersion: 'MOCK_MODEL_V1',
          validUntil: new Date(
            now + horizons[i] * 3600_000
          ),

          factors: {
            create: [
              {
                factor: 'rainfall',
                value: z.rain,
                contribution: Math.round(z.rain * 0.6),
              },
              {
                factor: 'drainage',
                value: z.drain,
                contribution: Math.round(
                  (50 - z.drain) * 0.6
                ),
              },
              {
                factor: 'history',
                value: z.hist,
                contribution: Math.round(z.hist * 0.3),
              },
              {
                factor: 'base',
                value: 20,
                contribution: 20,
              },
            ],
          },
        },
      });

      // On conserve la prédiction à horizon 6h
      // pour les alertes générées par prédiction.
      if (horizons[i] === 6) {
        predictionByZone[z.name] = pred;
      }
    }
  }

  // -----------------------------------------------------------------------
  // FONCTION DE CRÉATION D'ALERTE
  // -----------------------------------------------------------------------

  async function makeAlert({
    title,
    type,
    severity,
    status,
    source,
    zones,
    createdBy,
    predictionId,
    events,
    extra = {},
  }) {
    const alert = await prisma.alert.create({
      data: {
        title,
        type,
        severity,
        status,
        source,
        predictionId: predictionId ?? null,
        createdById: createdBy.id,

        zones: {
          create: zones.map((zoneId) => ({
            zoneId,
          })),
        },

        ...extra,
      },
    });

    for (const e of events) {
      await prisma.alertEvent.create({
        data: {
          alertId: alert.id,
          userId: e.userId ?? null,
          action: e.action,
          details: e.details,
          timestamp: e.timestamp,
        },
      });
    }

    return alert;
  }

  const hoursAgo = (hours) =>
    new Date(now - hours * 3600_000);

  // -----------------------------------------------------------------------
  // ALERTE 1 — BAGUIDA
  // -----------------------------------------------------------------------

  await makeAlert({
    title: 'Forte pluie / risque d’inondation — Baguida',
    type: 'Forte pluie / risque d’inondation',
    severity: 'HIGH',
    status: 'ACTIVE',
    source: 'PREDICTION',
    zones: [zoneRows['Baguida'].id],
    createdBy: anpc,
    predictionId: predictionByZone['Baguida']?.id,

    extra: {
      validatedById: anpc.id,
      validatedAt: hoursAgo(1.8),
      dispatchedAt: hoursAgo(1.7),
    },

    events: [
      {
        action: 'CREATED',
        details: 'Prédiction générée',
        timestamp: hoursAgo(2.5),
      },
      {
        action: 'SUBMITTED',
        details: 'Alerte proposée',
        userId: null,
        timestamp: hoursAgo(2.3),
      },
      {
        action: 'CONFIRMED',
        details: 'Alerte confirmée',
        userId: anpc.id,
        timestamp: hoursAgo(1.8),
      },
      {
        action: 'DISPATCHED',
        details: 'Diffusée — 3 canal(aux)',
        userId: anpc.id,
        timestamp: hoursAgo(1.7),
      },
      {
        action: 'FIELD_ENGAGED',
        details: `Équipe engagée sur le terrain — ${pompiers.name}`,
        userId: pompiers.id,
        timestamp: hoursAgo(1.1),
      },
    ],
  });

  // -----------------------------------------------------------------------
  // ALERTE 2 — KODJOVIAKOPÉ / AMOUTIVÉ
  // -----------------------------------------------------------------------

  await makeAlert({
    title: 'Forte pluie — Kodjoviakopé / Amoutivé',
    type: 'Forte pluie / risque d’inondation',
    severity: 'HIGH',
    status: 'PROPOSED',
    source: 'MANUAL',
    zones: [
      zoneRows['Kodjoviakopé'].id,
      zoneRows['Amoutivé'].id,
    ],
    createdBy: mairie,

    events: [
      {
        action: 'SUBMITTED',
        details: 'Alerte proposée (2 quartiers)',
        userId: mairie.id,
        timestamp: hoursAgo(0.3),
      },
    ],
  });

  // -----------------------------------------------------------------------
  // ALERTE 3 — DJIDJOLÉ
  // -----------------------------------------------------------------------

  await makeAlert({
    title: 'Risque d’inondation modéré — Djidjolé',
    type: 'Risque d’inondation modéré',
    severity: 'MODERATE',
    status: 'RESOLVED',
    source: 'PREDICTION',
    zones: [zoneRows['Djidjolé'].id],
    createdBy: anpc,
    predictionId: predictionByZone['Djidjolé']?.id,

    extra: {
      validatedById: anpc.id,
      validatedAt: hoursAgo(3.4),
      dispatchedAt: hoursAgo(3.3),
      resolvedAt: hoursAgo(2.1),
    },

    events: [
      {
        action: 'CREATED',
        details: 'Prédiction générée',
        timestamp: hoursAgo(3.6),
      },
      {
        action: 'SUBMITTED',
        details: 'Alerte proposée',
        timestamp: hoursAgo(3.5),
      },
      {
        action: 'CONFIRMED',
        details: 'Alerte confirmée',
        userId: anpc.id,
        timestamp: hoursAgo(3.4),
      },
      {
        action: 'DISPATCHED',
        details: 'Diffusée — 1 canal',
        userId: anpc.id,
        timestamp: hoursAgo(3.3),
      },
      {
        action: 'FIELD_ENGAGED',
        details: `Équipe engagée sur le terrain — ${pompiers.name}`,
        userId: pompiers.id,
        timestamp: hoursAgo(2.9),
      },
      {
        action: 'RESOLVED',
        details: 'Situation stabilisée',
        userId: pompiers.id,
        timestamp: hoursAgo(2.1),
      },
    ],
  });

  // -----------------------------------------------------------------------
  // ALERTE 4 — TOKOIN
  // -----------------------------------------------------------------------

  await makeAlert({
    title: 'Vigilance pluviométrique — Tokoin',
    type: 'Vigilance pluviométrique',
    severity: 'LOW',
    status: 'CLOSED',
    source: 'MANUAL',
    zones: [zoneRows['Tokoin'].id],
    createdBy: mairie,

    extra: {
      rejectionReason:
        'Risque retombé sous le seuil de vigilance après réévaluation météo — aucune diffusion nécessaire.',
      closedAt: hoursAgo(4.6),
    },

    events: [
      {
        action: 'SUBMITTED',
        details: 'Alerte proposée',
        userId: mairie.id,
        timestamp: hoursAgo(4.8),
      },
      {
        action: 'REJECTED',
        details:
          'Alerte rejetée — motif : Risque retombé sous le seuil de vigilance après réévaluation météo.',
        userId: anpc.id,
        timestamp: hoursAgo(4.6),
      },
    ],
  });

  // -----------------------------------------------------------------------
  // FIN
  // -----------------------------------------------------------------------

  console.log('Seed terminé.');
  console.log('');
  console.log(
    'Comptes de démonstration (mot de passe: NeuronDemo#2026) :'
  );
  console.log(
    '  ANPC          (CIVIL_PROTECTION)  +22890000001'
  );
  console.log(
    '  Mairie        (AUTHORITY)         +22890000002'
  );
  console.log(
    '  GNSP          (EMERGENCY_SERVICE) +22890000003'
  );
  console.log(
    '  Observateur   (lecture seule)     +22890000004'
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });