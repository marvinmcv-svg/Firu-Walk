-- Data migration: the six Santa Cruz launch zones (same as prisma/seed.ts).
-- Idempotent: existing zones (matched by key) are left untouched, so admin
-- edits to names/coordinates/active flags are never overwritten.
INSERT INTO "Zone" ("id", "key", "name", "city", "centerLat", "centerLng", "active", "sortOrder") VALUES
  ('zone_equipetrol',     'equipetrol',     'Equipetrol',        'Santa Cruz de la Sierra', -17.7935, -63.201,  true, 0),
  ('zone_las_palmas',     'las-palmas',     'Las Palmas',        'Santa Cruz de la Sierra', -17.7662, -63.1963, true, 1),
  ('zone_hernando_siles', 'hernando-siles', 'Hernando Siles',    'Santa Cruz de la Sierra', -17.7767, -63.2047, true, 2),
  ('zone_norte',          'norte',          'Norte',             'Santa Cruz de la Sierra', -17.7575, -63.1794, true, 3),
  ('zone_cumbre',         'cumbre',         'Cumbre de Sierras', 'Santa Cruz de la Sierra', -17.8072, -63.1927, true, 4),
  ('zone_bicentenario',   'bicentenario',   'Bicentenario',      'Santa Cruz de la Sierra', -17.7468, -63.2116, true, 5)
ON CONFLICT ("key") DO NOTHING;
