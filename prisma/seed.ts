/**
 * FiruWalk seed — realistic Santa Cruz de la Sierra demo data.
 * Run: bunx prisma db push && bun prisma/seed.ts
 *
 * Conventions (see worklog.md):
 *  - Money = integer centavos.
 *  - Ledger: debit = +amount into account, credit = -amount out. Every txn sums 0.
 *  - Accounts: owner:{id}, walker:{id}, platform:held, platform:revenue,
 *    platform:cash, payout:{id}.
 *  - Bolivia = UTC-4 year-round. Helper boDate() builds local timestamps.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

// ------------------------------------------------------------------
// Deterministic PRNG + GPS track generator (shared style with the live
// service: wandering heading, ~1.35 m/s, point every 30 s).
// ------------------------------------------------------------------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const METERS_PER_DEG_LAT = 111320;

function stepPoint(
  lat: number,
  lng: number,
  headingDeg: number,
  meters: number
): [number, number] {
  const rad = (headingDeg * Math.PI) / 180;
  const dLat = (meters * Math.cos(rad)) / METERS_PER_DEG_LAT;
  const dLng =
    (meters * Math.sin(rad)) / (METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  return [lat + dLat, lng + dLng];
}

/** Generate a loop-ish walk polyline. Returns [points, totalMeters]. */
function generateTrack(
  startLat: number,
  startLng: number,
  durationMin: number,
  seed: number
): [[number, number][], number] {
  const rand = mulberry32(seed);
  const points: [number, number][] = [[startLat, startLng]];
  let [lat, lng] = [startLat, startLng];
  let heading = rand() * 360;
  let dist = 0;
  const stepMeters = 1.35 * 30; // 30-second sampling
  const steps = Math.max(2, Math.round(durationMin * 2));
  const homeHeadingBase = rand() * 360;
  for (let i = 0; i < steps; i++) {
    if (i > steps * 0.55) {
      // head home-ish
      const toHome = Math.atan2(startLng - lng, startLat - lat);
      const homeDeg = (toHome * 180) / Math.PI;
      heading = heading * 0.6 + homeDeg * 0.4 + (rand() - 0.5) * 30;
    } else {
      heading += (rand() - 0.5) * 70;
    }
    [lat, lng] = stepPoint(lat, lng, heading, stepMeters);
    dist += stepMeters;
    points.push([lat, lng]);
  }
  // snap end near start (as if returned to pickup)
  points.push([startLat + 0.0002, startLng + 0.0002]);
  dist += 40;
  return [points, Math.round(dist)];
}

// ------------------------------------------------------------------
// Bolivia local time helpers (UTC-4)
// ------------------------------------------------------------------
const BO_OFFSET_MS = 4 * 60 * 60 * 1000;

/** Current time shifted so getUTC* reflect Bolivia wall clock. */
function boNow(): Date {
  return new Date(Date.now() - BO_OFFSET_MS);
}

/** Build UTC Date from Bolivia local Y/M/D H:MM */
function boDate(
  yearOffsetDaysFromToday: number,
  hour: number,
  minute = 0
): Date {
  const base = boNow();
  const d = new Date(
    Date.UTC(
      base.getUTCFullYear(),
      base.getUTCMonth(),
      base.getUTCDate() + yearOffsetDaysFromToday,
      hour,
      minute,
      0
    )
  );
  return new Date(d.getTime() + BO_OFFSET_MS);
}

/** Bolivia-local day-of-week (0=Sun) of a UTC Date */
function boDayOfWeek(d: Date): number {
  return new Date(d.getTime() - BO_OFFSET_MS).getUTCDay();
}

/** Date `offsetDays` from today at Bolivia-local midnight, as YYYY-MM-DD */
function boIsoDate(offsetDays: number): string {
  const base = boNow();
  const d = new Date(
    Date.UTC(
      base.getUTCFullYear(),
      base.getUTCMonth(),
      base.getUTCDate() + offsetDays
    )
  );
  return d.toISOString().slice(0, 10);
}

/** Most recent past date (UTC Date) whose Bolivia-local weekday = `dow`, at hour:minute */
function lastWeekdayAt(dow: number, hour: number, minute: number): Date {
  for (let i = 0; i < 14; i++) {
    const d = boDate(-i, hour, minute);
    if (boDayOfWeek(d) === dow && d.getTime() < Date.now()) return d;
  }
  return boDate(-7, hour, minute);
}

/** Next future date whose Bolivia-local weekday = `dow`, at hour:minute */
function nextWeekdayAt(dow: number, hour: number, minute: number): Date {
  for (let i = 0; i < 14; i++) {
    const d = boDate(i, hour, minute);
    if (boDayOfWeek(d) === dow && d.getTime() > Date.now()) return d;
  }
  return boDate(7, hour, minute);
}

async function main() {
  console.log("🌱 Seeding FiruWalk…");

  // Wipe (idempotent re-seed)
  const tablenames = [
    "auditLog",
    "message",
    "notification",
    "dispute",
    "payout",
    "ledgerEntry",
    "payment",
    "review",
    "incidentLog",
    "reportCard",
    "walkTrackPoint",
    "walk",
    "booking",
    "dog",
    "availabilitySlot",
    "walkerProfile",
    "user",
    "zone",
    "config",
  ] as const;
  for (const t of tablenames) {
    await (db as any)[t].deleteMany();
  }

  // ----------------------------------------------------------------
  // Config — ALL business tunables live here (never hard-coded in UI).
  // Values marked ASSUMPTION need validation with the human (§14 prompt).
  // ----------------------------------------------------------------
  const configData: Record<string, unknown> = {
    platform: {
      name: "FiruWalk",
      city: "Santa Cruz de la Sierra",
      supportWhatsApp: "+59177165787", // real support line (user-provided)
      guaranteeText:
        "Garantía FiruWalk: si tu paseador cancela, encontramos un respaldo o te acreditamos el paseo. Cobertura y límites: por definir con asesor legal.",
    },
    fees: {
      commissionPct: 12, // ASSUMPTION: 10–15% walker-side take, 0% owner
      ownerFeePct: 0,
      tipPassThroughPct: 100,
    },
    pricing: {
      // ASSUMPTION: local price bands for SCCS, to be validated
      price30Cents: 1500,
      price45Cents: 2000,
      price60Cents: 2500,
    },
    policy: {
      cancellationFreeHours: 12, // free if cancelled earlier than 12h before
      lateCancelWalkerSharePct: 50,
      acceptTimeoutMinutes: 5, // real-world one-at-a-time accept window
      trialWalks: 5,
      noShowCreditCents: 1000,
    },
    demo: {
      otpCode: "123456", // demo OTP — no SMS provider in the sandbox
      acceptTimeoutSeconds: 90, // demo-fast fallback window
    },
    payouts: { cycle: "weekly", minPayoutCents: 2000 },
  };
  for (const [key, value] of Object.entries(configData)) {
    await db.config.create({ data: { key, valueJson: JSON.stringify(value) } });
  }

  // ----------------------------------------------------------------
  // Zones (ASSUMPTION: launch zones, §14 Q1 open for the human)
  // ----------------------------------------------------------------
  const zoneDefs = [
    ["equipetrol", "Equipetrol", -17.7935, -63.201],
    ["las-palmas", "Las Palmas", -17.7662, -63.1963],
    ["hernando-siles", "Hernando Siles", -17.7767, -63.2047],
    ["norte", "Norte", -17.7575, -63.1794],
    ["cumbre", "Cumbre de Sierras", -17.8072, -63.1927],
    ["bicentenario", "Bicentenario", -17.7468, -63.2116],
  ] as const;
  const zones: Record<string, string> = {};
  for (let i = 0; i < zoneDefs.length; i++) {
    const [key, name, lat, lng] = zoneDefs[i];
    const z = await db.zone.create({
      data: {
        key,
        name,
        centerLat: lat,
        centerLng: lng,
        sortOrder: i,
        active: true,
      },
    });
    zones[key] = z.id;
  }

  // ----------------------------------------------------------------
  // People
  // ----------------------------------------------------------------
  const admin = await db.user.create({
    data: {
      phone: "+59170000001",
      name: "Equipo FiruWalk",
      role: "ADMIN",
      avatarUrl: "/favicon.svg",
    },
  });

  const ownersDef = [
    // [phone, name, avatar, zoneKey, addressNote, lat, lng]
    ["+59170000101", "Ana Rivera", "/images/owners/owner-1.png", "equipetrol", "Av. Monseñor Rivera esq. 4to anillo, edificio Torre Verde, depto 302", -17.7931, -63.1998],
    ["+59170000102", "Carlos Méndez", "/images/owners/owner-2.png", "las-palmas", "Calle Ventura, casa azul frente a la plaza", -17.7669, -63.1952],
    ["+59170000103", "Sofía Paz", "/images/owners/owner-3.png", "hernando-siles", "Tercer anillo interno, portón blanco con reja verde", -17.7771, -63.2041],
    ["+59170000104", "Marco Tórrez", "/images/owners/owner-4.png", "norte", "Av. Banzer cerca del parque, edificio Mirador, piso 5", -17.7578, -63.1799],
  ] as const;
  const owners: Record<string, string> = {};
  for (const [phone, name, avatar, zoneKey, note, lat, lng] of ownersDef) {
    const u = await db.user.create({
      data: {
        phone,
        name,
        role: "OWNER",
        avatarUrl: avatar,
        zoneId: zones[zoneKey],
        addressNote: note,
        addressLat: lat,
        addressLng: lng,
      },
    });
    owners[phone] = u.id;
  }
  const ana = owners["+59170000101"];
  const carlos = owners["+59170000102"];
  const sofia = owners["+59170000103"];
  const marco = owners["+59170000104"];

  // Walkers (8 ACTIVE + 2 PENDING for the admin queue)
  // [phone, name, avatar, zoneKey, bio, exp, p30, p45, p60, rating, ratingCount, totalWalks, repeatOwners, respMin, trialDone, status]
  const walkersDef = [
    ["+59170000201", "Luis Quisbert", "/images/walkers/walker-1.png", "equipetrol", "Estudiante de Veterinaria (UAGRM). Paseo con paciencia, enseño a no jalar la correa y envío fotos en cada esquina del recorrido. Golden y grandes razas son mi especialidad.", 4, 1800, 2200, 2800, 4.9, 47, 156, 23, 4, true, "ACTIVE"],
    ["+59170000202", "Gabriela Rojas", "/images/walkers/walker-2.png", "las-palmas", "Amante de los perros desde niña. Paseos tranquilos y seguros, perfecto para cachorros y perritos senior. Siempre con agua y bolsas.", 3, 1500, 2000, 2500, 4.8, 35, 121, 18, 5, true, "ACTIVE"],
    ["+59170000203", "Diego Fernández", "/images/walkers/walker-3.png", "equipetrol", "Runner y paseador. Ofrezco paseos con ritmo para perros de alta energía. Responsable y puntual, viví 2 años en Australia cuidando perros.", 5, 1600, 2100, 2600, 4.7, 28, 98, 14, 6, true, "ACTIVE"],
    ["+59170000204", "Valeria Cruz", "/images/walkers/walker-4.png", "hernando-siles", "Cuido los nervios de cada perro: respeto sus tiempos, refuerzo positivo y cero jalones. Experiencia con perros reactivos con correa corta.", 3, 1500, 2000, 2500, 4.9, 41, 132, 20, 3, true, "ACTIVE"],
    ["+59170000205", "Marcelo Vaca", "/images/walkers/walker-5.png", "norte", "Paseador de barrio, honesto y cumplidor. Conozco cada parque de la zona Norte. Los perros me adoptan rápido.", 6, 1400, 1900, 2400, 4.6, 19, 74, 9, 7, true, "ACTIVE"],
    ["+59170000206", "Camila Sugasti", "/images/walkers/walker-6.png", "cumbre", "Voluntaria en refugio animal los fines de semana. Paseos con juegos y aprendizaje. Primeros auxilios caninos (curso 2025).", 1, 1500, 2000, 2500, 5.0, 12, 12, 4, 4, false, "ACTIVE"],
    ["+59170000207", "Rodrigo Antelo", "/images/walkers/walker-7.png", "bicentenario", "Papá de dos lobos husky. Paseos largos por el parque Bicentenario, con reportes detallados y muchas fotos.", 4, 1500, 2000, 2500, 4.8, 33, 110, 16, 5, true, "ACTIVE"],
    ["+59170000208", "Paola Suárez", "/images/walkers/walker-8.png", "las-palmas", "Maestra de primaria de día, paseadora de tarde. Experta en perros ansiosos cuando se quedan solos.", 2, 1500, 2000, 2500, 4.7, 24, 79, 11, 6, true, "ACTIVE"],
    ["+59170000209", "José Mamani", "/images/walkers/walker-9.png", "equipetrol", "Mecánico de día, quiero dedicarme a los perros. Crecí con 4 perros en mi casa en Warnes. Referencias de mis vecinos disponibles.", 2, 1500, 2000, 2500, 0, 0, 0, 0, 10, false, "PENDING"],
    ["+59170000210", "Alejandra Durán", "/images/walkers/walker-10.png", "norte", "Estudiante de Comunicación. Paseo perros de mi cuadra desde hace un año y quiero formalizarlo en FiruWalk.", 1, 1500, 2000, 2500, 0, 0, 0, 0, 12, false, "PENDING"],
  ] as const;

  const walkers: Record<string, { userId: string; walkerId: string; zoneKey: string; price: { p30: number; p45: number } }> = {};
  for (const [
    phone, name, avatar, zoneKey, bio, exp, p30, p45, p60, rating, ratingCount, totalWalks, repeatOwners, respMin, , status,
  ] of walkersDef) {
    const u = await db.user.create({
      data: {
        phone,
        name,
        role: "WALKER",
        avatarUrl: avatar,
        zoneId: zones[zoneKey],
      },
    });
    const w = await db.walkerProfile.create({
      data: {
        userId: u.id,
        zoneId: zones[zoneKey],
        status,
        bio,
        experienceYears: exp,
        price30Cents: p30,
        price45Cents: p45,
        price60Cents: p60,
        rating,
        ratingCount,
        totalWalks,
        repeatOwners,
        responseMinutes: respMin,
        trialDone: status === "ACTIVE" && totalWalks > 20,
        selfieUrl: avatar,
        idPhotoUrl: avatar,
        referencesText: status === "PENDING" ? "Vecinos de la zona pueden confirmar mi responsabilidad con animales." : null,
        idDocNumber: status === "PENDING" ? "EN ESPERA DE REVISIÓN" : "VERIFICADO",
        approvedAt: status === "ACTIVE" ? boDate(-60, 9) : null,
      },
    });
    walkers[phone] = { userId: u.id, walkerId: w.id, zoneKey, price: { p30, p45 } };
    // Availability: Mon–Sat mornings + weekday evenings (varied per walker)
    const avail: { dayOfWeek: number; startMinute: number; endMinute: number }[] = [];
    for (let d = 1; d <= 5; d++) avail.push({ dayOfWeek: d, startMinute: 390, endMinute: 690 });
    if (exp > 3) for (let d = 1; d <= 4; d++) avail.push({ dayOfWeek: d, startMinute: 960, endMinute: 1140 });
    if (respMin < 6) avail.push({ dayOfWeek: 6, startMinute: 420, endMinute: 660 });
    await db.availabilitySlot.createMany({
      data: avail.map((a) => ({ ...a, walkerId: w.id })),
    });
  }

  const luis = walkers["+59170000201"];
  const gabriela = walkers["+59170000202"];
  const diego = walkers["+59170000203"];
  const valeria = walkers["+59170000204"];
  const marcelo = walkers["+59170000205"];
  const camila = walkers["+59170000206"];
  const rodrigo = walkers["+59170000207"];
  const paola = walkers["+59170000208"];

  // ----------------------------------------------------------------
  // Dogs
  // ----------------------------------------------------------------
  const dogsDef = [
    // [ownerId, name, breed, size, age, temperament, tags, notes, vet, photo]
    [ana, "Max", "Golden Retriever", "L", 4, "ENERGETIC", ["friendly", "pulls-leash"], "Come croquetas sin gluten. Si jala, frena y espera.", "+59133224001", "/images/dogs/dog-1.png"],
    [carlos, "Luna", "Beagle", "M", 2, "ENERGETIC", ["friendly", "sniffer"], "Se escapa si huele comida. Correa corta en la calle.", "+59133224002", "/images/dogs/dog-2.png"],
    [sofia, "Rocky", "Pitbull mix", "L", 3, "ANXIOUS", ["reactive", "no-other-dogs"], "Reactivo con otros machos. Pasear lejos de parques llenos. Correa de seguridad.", "+59133224003", "/images/dogs/dog-3.png"],
    [sofia, "Nala", "Poodle toy", "S", 7, "CALM", ["friendly", "senior"], "Ya es abuelita: paso lento, evitar calor fuerte.", "+59133224003", "/images/dogs/dog-4.png"],
    [marco, "Toby", "French Bulldog", "M", 5, "CALM", ["friendly", "brachy"], "Se agita rápido: paseos cortos y agua siempre. NO correr.", "+59133224004", "/images/dogs/dog-5.png"],
    [ana, "Coco", "Dachshund", "S", 2, "ENERGETIC", ["friendly", "back-care"], "Problema lumbar: evitar saltos y escaleras largas.", "+59133224001", "/images/dogs/dog-6.png"],
    [carlos, "Zeus", "Border Collie", "M", 3, "ENERGETIC", ["herding", "smart"], "Necesita estímulo: traer pelota durante el paseo.", "+59133224002", "/images/dogs/dog-7.png"],
  ] as const;
  const dogs: Record<string, string> = {};
  for (const [ownerId, name, breed, size, age, temperament, tags, notes, vet, photo] of dogsDef) {
    const d = await db.dog.create({
      data: {
        ownerId,
        name,
        breed,
        size,
        ageYears: age,
        temperament,
        notes,
        vetPhone: vet,
        photoUrl: photo,
        tagsJson: JSON.stringify(tags),
      },
    });
    dogs[name] = d.id;
  }

  // ----------------------------------------------------------------
  // Ledger helper
  // ----------------------------------------------------------------
  let txnCounter = 0;
  async function ledger(
    entries: { account: string; debit?: number; credit?: number; memo: string }[],
    refType: string,
    refId: string,
    when: Date
  ) {
    txnCounter++;
    const txnId = `seed-txn-${txnCounter}`;
    for (const e of entries) {
      await db.ledgerEntry.create({
        data: {
          txnId,
          account: e.account,
          debitCents: e.debit ?? 0,
          creditCents: e.credit ?? 0,
          memo: e.memo,
          refType,
          refId,
          createdAt: when,
        },
      });
    }
  }

  const commissionPct = 12;
  const fee = (gross: number) => Math.round((gross * commissionPct) / 100);

  // ----------------------------------------------------------------
  // B1 — Ana/Max recurring Mon-Wed-Fri 07:30 with Luis (QR, released)
  // ----------------------------------------------------------------
  const b1 = await db.booking.create({
    data: {
      ownerId: ana,
      dogId: dogs["Max"],
      walkerId: luis.userId,
      zoneId: zones["equipetrol"],
      type: "RECURRING",
      status: "CONFIRMED",
      scheduleJson: JSON.stringify([
        { day: 1, minute: 450 },
        { day: 3, minute: 450 },
        { day: 5, minute: 450 },
      ]),
      durationMin: 30,
      pricePerWalkCents: luis.price.p30,
      candidatesJson: JSON.stringify([luis.userId, diego.userId]),
      requestedAt: boDate(-25, 8),
      expiresAt: boDate(-25, 8, 6),
      acceptedAt: boDate(-25, 8, 5),
      notes: "Tocar el timbre 302. Max saca la cabeza por la ventana, es amistoso.",
    },
  });

  // 3 completed walks (last Mon/Wed/Fri) + 1 in-progress today + next scheduled
  const b1Dates = [
    lastWeekdayAt(1, 7, 30), // Monday
    lastWeekdayAt(3, 7, 30), // Wednesday
    lastWeekdayAt(5, 7, 30), // Friday
  ];
  let seq = 0;
  for (const [i, start] of b1Dates.entries()) {
    const walkNum = i + 1;
    const [track, distM] = generateTrack(-17.7931, -63.1998, 30, 100 + walkNum);
    const w = await db.walk.create({
      data: {
        bookingId: b1.id,
        walkerId: luis.userId,
        ownerId: ana,
        dogId: dogs["Max"],
        zoneId: zones["equipetrol"],
        status: "COMPLETED",
        scheduledStart: start,
        durationMin: 30,
        startedAt: start,
        endedAt: new Date(start.getTime() + 31 * 60000),
        startLat: track[0][0],
        startLng: track[0][1],
        endLat: track[track.length - 1][0],
        endLng: track[track.length - 1][1],
        distanceMeters: distM,
        trackJson: JSON.stringify(track),
      },
    });
    seq++;
    await db.walkTrackPoint.createMany({
      data: track.map((p, idx) => ({
        walkId: w.id,
        seq: idx,
        lat: p[0],
        lng: p[1],
        recordedAt: new Date(start.getTime() + idx * 30000),
      })),
    });
    await db.reportCard.create({
      data: {
        walkId: w.id,
        note:
          walkNum === 1
            ? "Max impecable hoy: saludó a dos perritos amigos y practicó caminar suelto en la avenencia. Muy bien con 'junto'."
            : walkNum === 2
              ? "Ruta por el parque del 4to anillo. Hizo pis 2 veces y caca 1 vez. Tomó agua en el kiosco. Tirones: casi ninguno 🎉"
              : "Paseo tranquilo antes del calor. Max un poco ansioso al pasar la obra de la esquina, retomó calma con premios.",
        pee: true,
        poo: walkNum !== 1,
        water: true,
        photosJson: JSON.stringify([`/images/walks/walk-${walkNum === 2 ? 2 : 1}.png`]),
        createdAt: new Date(start.getTime() + 32 * 60000),
      },
    });
    // Payment per walk: QR hold at start, release on completion
    const pay = await db.payment.create({
      data: {
        bookingId: b1.id,
        ownerId: ana,
        walkerId: luis.userId,
        method: "QR",
        amountCents: luis.price.p30,
        status: "RELEASED",
        qrRef: `QR-FW-${w.id.slice(-6).toUpperCase()}`,
        confirmedAt: start,
        createdAt: start,
      },
    });
    await ledger(
      [
        { account: `owner:${ana}`, debit: luis.price.p30, memo: `Pago QR Simple — paseo de Max (${walkNum}/3)` },
        { account: "platform:held", credit: luis.price.p30, memo: `Retención por paseo (${walkNum}/3)` },
      ],
      "payment",
      pay.id,
      start
    );
    const net = luis.price.p30 - fee(luis.price.p30);
    await ledger(
      [
        { account: "platform:held", debit: luis.price.p30, memo: `Liberación — paseo completado (${walkNum}/3)` },
        { account: `walker:${luis.userId}`, credit: net, memo: `Ingreso neto paseo de Max (comisión 12%)` },
        { account: "platform:revenue", credit: fee(luis.price.p30), memo: `Comisión 12% — paseo (${walkNum}/3)` },
      ],
      "walk",
      w.id,
      new Date(start.getTime() + 31 * 60000)
    );
  }

  // In-progress walk RIGHT NOW (live GPS demo when owner/walker log in)
  const nowBo = boNow();
  const todayWalkStart = new Date(Date.now() - 6 * 60000);
  const liveWalk = await db.walk.create({
    data: {
      bookingId: b1.id,
      walkerId: luis.userId,
      ownerId: ana,
      dogId: dogs["Max"],
      zoneId: zones["equipetrol"],
      status: "IN_PROGRESS",
      scheduledStart: todayWalkStart,
      durationMin: 30,
      startedAt: todayWalkStart,
      startLat: -17.7931,
      startLng: -63.1998,
    },
  });

  // Next scheduled occurrence
  const nextMon = nextWeekdayAt(1, 7, 30);
  const nextWed = nextWeekdayAt(3, 7, 30);
  const nextB1 = nextMon < nextWed ? nextMon : nextWed;
  await db.walk.create({
    data: {
      bookingId: b1.id,
      walkerId: luis.userId,
      ownerId: ana,
      dogId: dogs["Max"],
      zoneId: zones["equipetrol"],
      status: "SCHEDULED",
      scheduledStart: nextB1,
      durationMin: 30,
    },
  });

  // Review for B1
  await db.review.create({
    data: {
      bookingId: b1.id,
      walkId: null,
      ownerId: ana,
      walkerId: luis.userId,
      rating: 5,
      comment:
        "Luis es un amor con Max. Los reportes con foto y el mapa del paseo me dejaron tranquila en el trabajo. 100% recomendado.",
      createdAt: boDate(-3, 20),
    },
  });

  // B1 payment method record (upcoming walks pay per-walk; method preference stored as QR)
  await db.payment.create({
    data: {
      bookingId: b1.id,
      ownerId: ana,
      walkerId: luis.userId,
      method: "QR",
      amountCents: luis.price.p30,
      status: "HELD",
      qrRef: `QR-FW-${liveWalk.id.slice(-6).toUpperCase()}`,
      confirmedAt: todayWalkStart,
      createdAt: todayWalkStart,
    },
  });
  await ledger(
    [
      { account: `owner:${ana}`, debit: luis.price.p30, memo: "Pago QR Simple — paseo de hoy de Max" },
      { account: "platform:held", credit: luis.price.p30, memo: "Retención — paseo en curso" },
    ],
    "payment",
    liveWalk.id,
    todayWalkStart
  );

  // ----------------------------------------------------------------
  // B5 — Ana one-off completed ~12 days ago with Luis (rebook hook)
  // ----------------------------------------------------------------
  const b5start = boDate(-12, 17, 30);
  const b5 = await db.booking.create({
    data: {
      ownerId: ana,
      dogId: dogs["Coco"],
      walkerId: luis.userId,
      zoneId: zones["equipetrol"],
      type: "ONE_OFF",
      status: "COMPLETED",
      scheduleJson: JSON.stringify([{ date: boIsoDate(-12), minute: 1050 }]),
      durationMin: 30,
      pricePerWalkCents: luis.price.p30,
      candidatesJson: JSON.stringify([luis.userId]),
      requestedAt: boDate(-13, 10),
      acceptedAt: boDate(-13, 10, 8),
      completedAt: new Date(b5start.getTime() + 31 * 60000),
      notes: "Coco no puede saltar; paseo corto y suave por la banqueta.",
    },
  });
  {
    const [track, distM] = generateTrack(-17.7931, -63.1998, 30, 505);
    const w = await db.walk.create({
      data: {
        bookingId: b5.id,
        walkerId: luis.userId,
        ownerId: ana,
        dogId: dogs["Coco"],
        zoneId: zones["equipetrol"],
        status: "COMPLETED",
        scheduledStart: b5start,
        durationMin: 30,
        startedAt: b5start,
        endedAt: new Date(b5start.getTime() + 30 * 60000),
        distanceMeters: distM,
        trackJson: JSON.stringify(track),
        startLat: track[0][0],
        startLng: track[0][1],
        endLat: track[track.length - 1][0],
        endLng: track[track.length - 1][1],
      },
    });
    await db.reportCard.create({
      data: {
        walkId: w.id,
        note: "Coco paseó despacito, sin saltos. Le encantó la sombra de los mangoes de la Av. Busch.",
        pee: true,
        poo: false,
        water: true,
        photosJson: JSON.stringify(["/images/walks/walk-1.png"]),
      },
    });
    const pay = await db.payment.create({
      data: {
        bookingId: b5.id, ownerId: ana, walkerId: luis.userId, method: "QR",
        amountCents: luis.price.p30, status: "RELEASED", qrRef: `QR-FW-${w.id.slice(-6).toUpperCase()}`,
        confirmedAt: b5start, createdAt: b5start,
      },
    });
    await ledger([{ account: `owner:${ana}`, debit: luis.price.p30, memo: "Pago QR — paseo puntual de Coco" }, { account: "platform:held", credit: luis.price.p30, memo: "Retención" }], "payment", pay.id, b5start);
    await ledger([
      { account: "platform:held", debit: luis.price.p30, memo: "Liberación — paseo completado" },
      { account: `walker:${luis.userId}`, credit: luis.price.p30 - fee(luis.price.p30), memo: "Ingreso neto paseo de Coco" },
      { account: "platform:revenue", credit: fee(luis.price.p30), memo: "Comisión 12%" },
    ], "walk", w.id, new Date(b5start.getTime() + 30 * 60000));
    await db.review.create({
      data: {
        bookingId: b5.id, walkId: w.id, ownerId: ana, walkerId: luis.userId, rating: 5,
        comment: "Puntuales y con paciencia para Coco. Volvemos a reservar.",
        createdAt: new Date(b5start.getTime() + 2 * 3600000),
      },
    });
  }

  // ----------------------------------------------------------------
  // B2 — Carlos/Luna one-off upcoming Sunday 17:00, CASH
  // ----------------------------------------------------------------
  const sunday = (() => {
    for (let i = 1; i < 8; i++) {
      const d = boDate(i, 17, 0);
      if (boDayOfWeek(d) === 0) return d;
    }
    return boDate(7, 17, 0);
  })();
  const b2 = await db.booking.create({
    data: {
      ownerId: carlos,
      dogId: dogs["Luna"],
      walkerId: gabriela.userId,
      zoneId: zones["las-palmas"],
      type: "ONE_OFF",
      status: "CONFIRMED",
      scheduleJson: JSON.stringify([{ date: boIsoDate(Math.round((sunday.getTime() - Date.now()) / 86400000)), minute: 1020 }]),
      durationMin: 30,
      pricePerWalkCents: gabriela.price.p30,
      candidatesJson: JSON.stringify([gabriela.userId, paola.userId]),
      requestedAt: boDate(-1, 15),
      acceptedAt: boDate(-1, 15, 4),
      notes: "Luna se emociona con las palomas; llevar premio de pollo.",
    },
  });
  await db.walk.create({
    data: {
      bookingId: b2.id, walkerId: gabriela.userId, ownerId: carlos, dogId: dogs["Luna"],
      zoneId: zones["las-palmas"], status: "SCHEDULED", scheduledStart: sunday, durationMin: 30,
    },
  });
  await db.payment.create({
    data: {
      bookingId: b2.id, ownerId: carlos, walkerId: gabriela.userId, method: "CASH",
      amountCents: gabriela.price.p30, status: "PENDING", createdAt: boDate(-1, 15),
    },
  });

  // ----------------------------------------------------------------
  // B3 — Sofía/Rocky recurring Tue+Thu 18:30 REQUESTED (walker pending accept)
  // ----------------------------------------------------------------
  const b3 = await db.booking.create({
    data: {
      ownerId: sofia,
      dogId: dogs["Rocky"],
      walkerId: valeria.userId,
      zoneId: zones["hernando-siles"],
      type: "RECURRING",
      status: "REQUESTED",
      scheduleJson: JSON.stringify([
        { day: 2, minute: 1110 },
        { day: 4, minute: 1110 },
      ]),
      durationMin: 45,
      pricePerWalkCents: valeria.price.p45,
      candidatesJson: JSON.stringify([valeria.userId, paola.userId, camila.userId]),
      requestedAt: new Date(Date.now() - 10 * 60000),
      expiresAt: new Date(Date.now() + 80 * 1000),
      notes: "Rocky reacciona a otros perros machos: cruzar la calle si se acerca uno. Correa corta siempre.",
    },
  });
  const tueNext = nextWeekdayAt(2, 18, 30);
  const thuNext = nextWeekdayAt(4, 18, 30);
  for (const d of [tueNext, thuNext]) {
    await db.walk.create({
      data: {
        bookingId: b3.id, walkerId: valeria.userId, ownerId: sofia, dogId: dogs["Rocky"],
        zoneId: zones["hernando-siles"], status: "SCHEDULED", scheduledStart: d, durationMin: 45,
      },
    });
  }
  await db.payment.create({
    data: {
      bookingId: b3.id, ownerId: sofia, walkerId: valeria.userId, method: "QR",
      amountCents: valeria.price.p45, status: "PENDING", createdAt: new Date(Date.now() - 10 * 60000),
    },
  });

  // ----------------------------------------------------------------
  // B4 — Marco/Toby one-off completed yesterday 17:45 (QR + tip)
  // ----------------------------------------------------------------
  const b4start = boDate(-1, 17, 45);
  const b4 = await db.booking.create({
    data: {
      ownerId: marco,
      dogId: dogs["Toby"],
      walkerId: marcelo.userId,
      zoneId: zones["norte"],
      type: "ONE_OFF",
      status: "COMPLETED",
      scheduleJson: JSON.stringify([{ date: boIsoDate(-1), minute: 1065 }]),
      durationMin: 45,
      pricePerWalkCents: marcelo.price.p45,
      candidatesJson: JSON.stringify([marcelo.userId]),
      requestedAt: boDate(-2, 9),
      acceptedAt: boDate(-2, 9, 6),
      completedAt: new Date(b4start.getTime() + 44 * 60000),
      notes: "Paseo corto para Toby, sin correr y con agua.",
    },
  });
  {
    const [track, distM] = generateTrack(-17.7578, -63.1799, 45, 404);
    const w = await db.walk.create({
      data: {
        bookingId: b4.id, walkerId: marcelo.userId, ownerId: marco, dogId: dogs["Toby"],
        zoneId: zones["norte"], status: "COMPLETED", scheduledStart: b4start, durationMin: 45,
        startedAt: b4start, endedAt: new Date(b4start.getTime() + 44 * 60000),
        distanceMeters: distM, trackJson: JSON.stringify(track),
        startLat: track[0][0], startLng: track[0][1],
        endLat: track[track.length - 1][0], endLng: track[track.length - 1][1],
      },
    });
    await db.reportCard.create({
      data: {
        walkId: w.id,
        note: "Toby caminó relajado por la Av. Banzer y el parque. Hidratado dos veces, sin agitarse. Cero tirones 💪",
        pee: true, poo: true, water: true,
        photosJson: JSON.stringify(["/images/walks/walk-3.png", "/images/walks/walk-1.png"]),
      },
    });
    const pay = await db.payment.create({
      data: {
        bookingId: b4.id, ownerId: marco, walkerId: marcelo.userId, method: "QR",
        amountCents: marcelo.price.p45, status: "RELEASED", qrRef: `QR-FW-${w.id.slice(-6).toUpperCase()}`,
        confirmedAt: b4start, createdAt: b4start,
      },
    });
    await ledger([{ account: `owner:${marco}`, debit: marcelo.price.p45, memo: "Pago QR — paseo de 45' de Toby" }, { account: "platform:held", credit: marcelo.price.p45, memo: "Retención" }], "payment", pay.id, b4start);
    await ledger([
      { account: "platform:held", debit: marcelo.price.p45, memo: "Liberación — paseo completado" },
      { account: `walker:${marcelo.userId}`, credit: marcelo.price.p45 - fee(marcelo.price.p45), memo: "Ingreso neto paseo de Toby" },
      { account: "platform:revenue", credit: fee(marcelo.price.p45), memo: "Comisión 12%" },
    ], "walk", w.id, new Date(b4start.getTime() + 44 * 60000));
    const rev = await db.review.create({
      data: {
        bookingId: b4.id, walkId: w.id, ownerId: marco, walkerId: marcelo.userId, rating: 4,
        comment: "Todo bien, llegó 5 minutos tarde pero el paseo fue sólido. Toby volvió feliz.",
        tipCents: 500,
        createdAt: new Date(b4start.getTime() + 3 * 3600000),
      },
    });
    await ledger([
      { account: `owner:${marco}`, debit: 500, memo: "Propina para Marcelo (100% al paseador)" },
      { account: `walker:${marcelo.userId}`, credit: 500, memo: "Propina recibida — paseo de Toby" },
    ], "tip", rev.id, new Date(b4start.getTime() + 3 * 3600000));
  }

  // ----------------------------------------------------------------
  // B7 — Marco/Toby past completed CASH walk (fee accrues to wallet)
  // ----------------------------------------------------------------
  const b7start = boDate(-6, 7, 0);
  const b7 = await db.booking.create({
    data: {
      ownerId: marco,
      dogId: dogs["Toby"],
      walkerId: marcelo.userId,
      zoneId: zones["norte"],
      type: "ONE_OFF",
      status: "COMPLETED",
      scheduleJson: JSON.stringify([{ date: boIsoDate(-6), minute: 420 }]),
      durationMin: 30,
      pricePerWalkCents: marcelo.price.p30,
      candidatesJson: JSON.stringify([marcelo.userId]),
      requestedAt: boDate(-7, 20),
      acceptedAt: boDate(-7, 20, 5),
      completedAt: new Date(b7start.getTime() + 29 * 60000),
    },
  });
  {
    const [track, distM] = generateTrack(-17.7578, -63.1799, 30, 707);
    const w = await db.walk.create({
      data: {
        bookingId: b7.id, walkerId: marcelo.userId, ownerId: marco, dogId: dogs["Toby"],
        zoneId: zones["norte"], status: "COMPLETED", scheduledStart: b7start, durationMin: 30,
        startedAt: b7start, endedAt: new Date(b7start.getTime() + 29 * 60000),
        distanceMeters: distM, trackJson: JSON.stringify(track),
        startLat: track[0][0], startLng: track[0][1],
        endLat: track[track.length - 1][0], endLng: track[track.length - 1][1],
      },
    });
    await db.reportCard.create({
      data: { walkId: w.id, note: "Vuelta rápida antes del calor. Toby bien.", pee: true, poo: false, water: false, photosJson: "[]" },
    });
    await db.payment.create({
      data: {
        bookingId: b7.id, ownerId: marco, walkerId: marcelo.userId, method: "CASH",
        amountCents: marcelo.price.p30, status: "CASH_SETTLED", createdAt: boDate(-7, 20),
        confirmedAt: new Date(b7start.getTime() + 29 * 60000),
      },
    });
    await ledger([
      { account: `walker:${marcelo.userId}`, debit: fee(marcelo.price.p30), memo: "Comisión 12% — paseo pagado en efectivo (se descuenta del saldo)" },
      { account: "platform:revenue", credit: fee(marcelo.price.p30), memo: "Comisión 12% — paseo en efectivo" },
    ], "walk", w.id, new Date(b7start.getTime() + 29 * 60000));
  }

  // ----------------------------------------------------------------
  // B8 — Carlos/Zeus recurring Mon+Wed 06:45 with Paola, 2 completed walks
  // ----------------------------------------------------------------
  const b8 = await db.booking.create({
    data: {
      ownerId: carlos,
      dogId: dogs["Zeus"],
      walkerId: paola.userId,
      zoneId: zones["las-palmas"],
      type: "RECURRING",
      status: "CONFIRMED",
      scheduleJson: JSON.stringify([
        { day: 1, minute: 405 },
        { day: 3, minute: 405 },
      ]),
      durationMin: 30,
      pricePerWalkCents: paola.price.p30,
      candidatesJson: JSON.stringify([paola.userId, gabriela.userId]),
      requestedAt: boDate(-9, 12),
      acceptedAt: boDate(-9, 12, 7),
      notes: "Zeus necesita pelota: llevar una.",
    },
  });
  for (const [i, d] of [lastWeekdayAt(1, 6, 45), lastWeekdayAt(3, 6, 45)].entries()) {
    const [track, distM] = generateTrack(-17.7669, -63.1952, 30, 808 + i);
    const w = await db.walk.create({
      data: {
        bookingId: b8.id, walkerId: paola.userId, ownerId: carlos, dogId: dogs["Zeus"],
        zoneId: zones["las-palmas"], status: "COMPLETED", scheduledStart: d, durationMin: 30,
        startedAt: d, endedAt: new Date(d.getTime() + 30 * 60000),
        distanceMeters: distM, trackJson: JSON.stringify(track),
        startLat: track[0][0], startLng: track[0][1],
        endLat: track[track.length - 1][0], endLng: track[track.length - 1][1],
      },
    });
    await db.reportCard.create({
      data: {
        walkId: w.id, note: i === 0 ? "Zeus quemó energía con 20 minutos de pelota. Volvió feliz y sediento." : "Paseo con juegos de 'traer'. Muy obediente hoy.",
        pee: true, poo: i === 1, water: true, photosJson: JSON.stringify(["/images/walks/walk-2.png"]),
      },
    });
    const pay = await db.payment.create({
      data: {
        bookingId: b8.id, ownerId: carlos, walkerId: paola.userId, method: "QR",
        amountCents: paola.price.p30, status: "RELEASED", qrRef: `QR-FW-${w.id.slice(-6).toUpperCase()}`,
        confirmedAt: d, createdAt: d,
      },
    });
    await ledger([{ account: `owner:${carlos}`, debit: paola.price.p30, memo: `Pago QR — paseo de Zeus (${i + 1}/2)` }, { account: "platform:held", credit: paola.price.p30, memo: "Retención" }], "payment", pay.id, d);
    await ledger([
      { account: "platform:held", debit: paola.price.p30, memo: "Liberación — paseo completado" },
      { account: `walker:${paola.userId}`, credit: paola.price.p30 - fee(paola.price.p30), memo: "Ingreso neto paseo de Zeus" },
      { account: "platform:revenue", credit: fee(paola.price.p30), memo: "Comisión 12%" },
    ], "walk", w.id, new Date(d.getTime() + 30 * 60000));
  }
  await db.review.create({
    data: {
      bookingId: b8.id, ownerId: carlos, walkerId: paola.userId, rating: 5,
      comment: "Paola entiende a Zeus. La pelota de la rutina lo tiene loco de contento.",
      createdAt: boDate(-2, 19),
    },
  });

  // ----------------------------------------------------------------
  // B6 — Sofía/Nala one-off completed 3 days ago, DISPUTED (quality/late)
  // ----------------------------------------------------------------
  const b6start = boDate(-3, 16, 0);
  const b6 = await db.booking.create({
    data: {
      ownerId: sofia,
      dogId: dogs["Nala"],
      walkerId: rodrigo.userId,
      zoneId: zones["bicentenario"],
      type: "ONE_OFF",
      status: "COMPLETED",
      scheduleJson: JSON.stringify([{ date: boIsoDate(-3), minute: 960 }]),
      durationMin: 30,
      pricePerWalkCents: rodrigo.price.p30,
      candidatesJson: JSON.stringify([rodrigo.userId]),
      requestedAt: boDate(-4, 11),
      acceptedAt: boDate(-4, 11, 5),
      completedAt: new Date(b6start.getTime() + 38 * 60000),
      notes: "Nala es senior: paso suave, evitar el sol fuerte.",
    },
  });
  {
    const [track, distM] = generateTrack(-17.7468, -63.2116, 30, 606);
    const w = await db.walk.create({
      data: {
        bookingId: b6.id, walkerId: rodrigo.userId, ownerId: sofia, dogId: dogs["Nala"],
        zoneId: zones["bicentenario"], status: "COMPLETED", scheduledStart: b6start, durationMin: 30,
        startedAt: new Date(b6start.getTime() + 22 * 60000), endedAt: new Date(b6start.getTime() + 38 * 60000),
        distanceMeters: distM, trackJson: JSON.stringify(track),
        startLat: track[0][0], startLng: track[0][1],
        endLat: track[track.length - 1][0], endLng: track[track.length - 1][1],
      },
    });
    await db.reportCard.create({
      data: { walkId: w.id, note: "Disculpen la demora. Nala caminó tranquila por la sombra del Bicentenario.", pee: true, poo: false, water: true, photosJson: "[]" },
    });
    const pay = await db.payment.create({
      data: {
        bookingId: b6.id, ownerId: sofia, walkerId: rodrigo.userId, method: "QR",
        amountCents: rodrigo.price.p30, status: "RELEASED", qrRef: `QR-FW-${w.id.slice(-6).toUpperCase()}`,
        confirmedAt: b6start, createdAt: b6start,
      },
    });
    await ledger([{ account: `owner:${sofia}`, debit: rodrigo.price.p30, memo: "Pago QR — paseo de Nala" }, { account: "platform:held", credit: rodrigo.price.p30, memo: "Retención" }], "payment", pay.id, b6start);
    await ledger([
      { account: "platform:held", debit: rodrigo.price.p30, memo: "Liberación — paseo completado" },
      { account: `walker:${rodrigo.userId}`, credit: rodrigo.price.p30 - fee(rodrigo.price.p30), memo: "Ingreso neto paseo de Nala" },
      { account: "platform:revenue", credit: fee(rodrigo.price.p30), memo: "Comisión 12%" },
    ], "walk", w.id, new Date(b6start.getTime() + 38 * 60000));
    // 2★ review + OPEN dispute (admin queue demo)
    await db.review.create({
      data: {
        bookingId: b6.id, walkId: w.id, ownerId: sofia, walkerId: rodrigo.userId, rating: 2,
        comment: "Llegó 22 minutos tarde y sin fotos. Nala estuvo bien, pero la demora me hizo perder una reunión.",
        createdAt: boDate(-3, 21),
      },
    });
    await db.dispute.create({
      data: {
        bookingId: b6.id, walkId: w.id, openedById: sofia, againstUserId: rodrigo.userId,
        reason: "LATE", status: "OPEN",
        description: "El paseador llegó 22 minutos tarde al punto de encuentro y el reporte no incluyó fotos. Solicito reembolso parcial del 50% por incumplimiento del horario acordado.",
        createdAt: boDate(-3, 21, 15),
      },
    });
  }

  // ----------------------------------------------------------------
  // Payouts — Luis: PAID weekly payout Bs 40; Gabriela: REQUESTED Bs 15
  // ----------------------------------------------------------------
  const payoutLuis = await db.payout.create({
    data: {
      walkerId: luis.userId, amountCents: 4000, method: "QR", status: "PAID",
      destRef: "QR Simple BNB — Luis Q.", periodStart: boDate(-14, 0), periodEnd: boDate(-7, 0),
      requestedAt: boDate(-7, 9), paidAt: boDate(-6, 10, 30),
    },
  });
  await ledger([{ account: `walker:${luis.userId}`, debit: 4000, memo: "Solicitud de pago semanal" }, { account: `payout:${payoutLuis.id}`, credit: 4000, memo: "En proceso de pago" }], "payout", payoutLuis.id, boDate(-7, 9));
  await ledger([{ account: `payout:${payoutLuis.id}`, debit: 4000, memo: "Pago enviado por QR Simple" }, { account: "platform:cash", credit: 4000, memo: "Salida semanal — Luis Q." }], "payout", payoutLuis.id, boDate(-6, 10, 30));

  const payoutGab = await db.payout.create({
    data: {
      walkerId: gabriela.userId, amountCents: 1500, method: "QR", status: "REQUESTED",
      destRef: "QR Simple BNB — Gabriela R.", requestedAt: new Date(Date.now() - 2 * 3600000),
    },
  });
  await ledger([{ account: `walker:${gabriela.userId}`, debit: 1500, memo: "Solicitud de pago semanal" }, { account: `payout:${payoutGab.id}`, credit: 1500, memo: "En proceso de pago" }], "payout", payoutGab.id, new Date(Date.now() - 2 * 3600000));

  // ----------------------------------------------------------------
  // Chat messages (persisted; live relay via socket service)
  // ----------------------------------------------------------------
  const msgs: [string, string, string, string, Date][] = [
    [b1.id, ana, "Ana Rivera", "¡Hola Luis! Ya subí las notas de Max en su perfil. Te espero en el portón 302 a las 7:30 🙂", boDate(-25, 8, 2)],
    [b1.id, luis.userId, "Luis Quisbert", "¡Hola Ana! Perfecto, conozco el edificio. Max y yo vamos a llevarnos bien, ya verás 🐕", boDate(-25, 8, 4)],
    [b1.id, luis.userId, "Luis Quisbert", "Paseo terminado ✅ Te dejé el mapa del recorrido y las fotos en el reporte.", b1Dates[2]],
    [b1.id, ana, "Ana Rivera", "¡Gracias Luis! El mapa me encanta, salgo tranquila al trabajo 😊", b1Dates[2] as unknown as Date],
    [b2.id, carlos, "Carlos Méndez", "Hola Gabriela, el domingo a las 17:00 te parece? Luna ya tiene su premio de pollo listo jaja", boDate(-1, 15, 2)],
    [b2.id, gabriela.userId, "Gabriela Rojas", "¡Perfecto Carlos! Nos vemos en la plaza. Llevo agua y bolsas 👌", boDate(-1, 15, 6)],
    [b3.id, sofia, "Sofía Paz", "Hola Valeria, envié la solicitud para Rocky (mar/jue 18:30). Leí tu perfil y me diste mucha confianza con el tema de la reactividad 🙏", new Date(Date.now() - 9 * 60000)],
    [b4.id, marcelo.userId, "Marcelo Vaca", "Listo don Marco, Toby y yo salimos 17:45 en punto. Voy con su agua 🐶", boDate(-2, 9, 8)],
  ];
  for (const [threadId, senderId, senderName, body, at] of msgs) {
    await db.message.create({
      data: { threadId, senderId, senderName, body, createdAt: at instanceof Date ? at : new Date(at) },
    });
  }

  // ----------------------------------------------------------------
  // Notifications
  // ----------------------------------------------------------------
  const notifs: [string, string, string, string, string, Date, boolean][] = [
    [ana, "WALK", "Paseo en curso 🐾", "Luis está paseando a Max ahora mismo. Sigue el recorrido en vivo.", "walk-live", todayWalkStart, false],
    [ana, "WALK", "Reporte listo", "El reporte del paseo del viernes de Max ya está disponible con fotos y mapa.", "bookings", b1Dates[2], false],
    [ana, "PAYMENT", "Pago confirmado", "Tu pago QR de Bs 18,00 por el paseo de hoy fue recibido.", "bookings", todayWalkStart, true],
    [luis.userId, "WALK", "Paseo de hoy", "Max te espera hoy a las 07:30 en Torre Verde, dpto 302.", "walk-active", boDate(0, 7), false],
    [luis.userId, "PAYMENT", "Pago semanal enviado 💸", "Te enviamos Bs 40,00 por QR Simple. ¡Buen trabajo!", "earnings", boDate(-6, 10, 30), true],
    [luis.userId, "REVIEW", "Nueva reseña 5★", "Ana te dejó una reseña: «Luis es un amor con Max…»", "profile", boDate(-3, 20), true],
    [valeria.userId, "BOOKING", "Nueva solicitud de reserva ⏳", "Sofía solicitó paseos recurrentes para Rocky (mar/jue 18:30, 45 min). Tienes 90 segundos para aceptar.", "home", new Date(Date.now() - 10 * 60000), false],
    [gabriela.userId, "PAYOUT", "Pago en proceso", "Tu solicitud de Bs 15,00 está en la cola de pagos semanales.", "earnings", new Date(Date.now() - 2 * 3600000), false],
    [marco, "BOOKING", "Reseña publicada", "Tu reseña del paseo de Toby fue publicada. ¡Gracias!", "bookings", boDate(-1, 21), true],
    [sofia, "DISPUTE", "Disputa registrada", "Recibimos tu reporte sobre el paseo de Nala. Nuestro equipo lo revisará en menos de 24h.", "bookings", boDate(-3, 21, 15), false],
    [carlos, "BOOKING", "Reserva confirmada ✅", "Gabriela confirmó el paseo de Luna el domingo a las 17:00 (pago en efectivo).", "bookings", boDate(-1, 15, 5), false],
    [admin.id, "APPLICATION", "2 solicitudes pendientes", "José Mamani y Alejandra Durán aplicaron como paseadores. Revisa sus documentos.", "applications", boDate(-1, 16), false],
    [admin.id, "DISPUTE", "Disputa abierta", "Sofía Paz abrió una disputa por demora en el paseo de Nala (reembolso parcial solicitado).", "disputes", boDate(-3, 21, 15), false],
    [admin.id, "PAYOUT", "Pago solicitado", "Gabriela Rojas solicitó retirar Bs 15,00 de su billetera.", "users", new Date(Date.now() - 2 * 3600000), false],
  ];
  for (const [userId, type, title, body, link, at, read] of notifs) {
    await db.notification.create({
      data: { userId, type, title, body, link, createdAt: at, read },
    });
  }

  // ----------------------------------------------------------------
  // Incident + audit logs
  // ----------------------------------------------------------------
  const b1walk1 = await db.walk.findFirst({ where: { bookingId: b1.id, status: "COMPLETED" }, orderBy: { scheduledStart: "asc" } });
  if (b1walk1) {
    await db.incidentLog.create({
      data: {
        walkId: b1walk1.id, reportedBy: luis.userId, type: "OTHER", status: "RESOLVED",
        note: "Un perro suelto se acercó en la esquina; manejé la situación con calma y continue por otra calle. Se reporta por protocolo.",
        createdAt: b1Dates[0],
      },
    });
  }
  const audit: [string, string, string, string | null, Date][] = [
    [admin.id, "WALKER_APPROVED", "walkerProfile", luis.walkerId, boDate(-60, 9, 5)],
    [admin.id, "WALKER_APPROVED", "walkerProfile", gabriela.walkerId, boDate(-55, 10)],
    [admin.id, "WALKER_APPROVED", "walkerProfile", rodrigo.walkerId, boDate(-40, 11)],
    [admin.id, "WALKER_APPROVED", "walkerProfile", paola.walkerId, boDate(-30, 15)],
    [admin.id, "CONFIG_UPDATED", "config", "pricing", boDate(-20, 8)],
    [admin.id, "PAYOUT_PAID", "payout", payoutLuis.id, boDate(-6, 10, 30)],
  ];
  for (const [actorId, action, entity, entityId, at] of audit) {
    await db.auditLog.create({
      data: { actorId, action, entity, entityId, createdAt: at, detail: null },
    });
  }

  // ----------------------------------------------------------------
  console.log("✅ Seed complete:");
  const counts = {
    users: await db.user.count(),
    walkers: await db.walkerProfile.count(),
    dogs: await db.dog.count(),
    bookings: await db.booking.count(),
    walks: await db.walk.count(),
    completedWalks: await db.walk.count({ where: { status: "COMPLETED" } }),
    reports: await db.reportCard.count(),
    reviews: await db.review.count(),
    payments: await db.payment.count(),
    ledger: await db.ledgerEntry.count(),
    payouts: await db.payout.count(),
    disputes: await db.dispute.count(),
    messages: await db.message.count(),
    notifications: await db.notification.count(),
    liveWalkId: liveWalk.id,
  };
  console.log(JSON.stringify(counts, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
