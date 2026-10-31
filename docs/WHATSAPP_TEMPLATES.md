# WhatsApp templates (Milestone 6)

FiruWalk sends these **business-initiated** messages through the WhatsApp Cloud
API. WhatsApp only delivers them if each template is **approved** in WhatsApp
Manager. Create every template below in **two languages** (`es` and `en`) with
**category: Utility** and the exact name shown. The `{{n}}` parameters are
filled in by `src/lib/server/notifications/templates.ts` (keep both in sync).

The login-code template (`firuwalk_login`, category Authentication) is separate:
see the README.

| Template | Sent to | When |
|---|---|---|
| `firuwalk_booking_request` | walker | an owner asks them for a booking (and each time the request moves to the next walker) |
| `firuwalk_booking_confirmed` | owner | the walker accepts |
| `firuwalk_walker_on_the_way` | owner | the walker taps "I'm on my way" (once per walk, within 60 min of the start) |
| `firuwalk_walk_started` | owner | the walk starts (link to the live map) |
| `firuwalk_walk_finished` | owner | the walk ends (link to the report) |
| `firuwalk_payment_received` | owner | the bank confirms a walk or plan payment |
| `firuwalk_payout_sent` | walker | an admin marks their payout as paid |
| `firuwalk_plan_expiring` | owner | `plans.expiryReminderDays` before a plan ends, if walks are left |

Links point to `APP_URL/?walk=<id>`; set `APP_URL` to the public site.

---

## firuwalk_booking_request

Parameters: `{{1}}` owner's first name · `{{2}}` dog · `{{3}}` zone · `{{4}}` schedule · `{{5}}` minutes

- **es:** `🐾 Nueva solicitud: {{1}} quiere paseos para {{2}} en {{3}} ({{4}}, {{5}} min). Abre FiruWalk para aceptarla antes de que pase al siguiente paseador.`
- **en:** `🐾 New request: {{1}} wants walks for {{2}} in {{3}} ({{4}}, {{5}} min). Open FiruWalk to accept it before it moves to the next walker.`

## firuwalk_booking_confirmed

Parameters: `{{1}}` walker's first name · `{{2}}` dog · `{{3}}` schedule

- **es:** `✅ ¡Reserva confirmada! {{1}} pasea a {{2}} ({{3}}). Coordina los detalles por el chat de FiruWalk.`
- **en:** `✅ Booking confirmed! {{1}} will walk {{2}} ({{3}}). Arrange the details in the FiruWalk chat.`

## firuwalk_walker_on_the_way

Parameters: `{{1}}` walker's first name · `{{2}}` dog

- **es:** `🚶 {{1}} va en camino a buscar a {{2}}. ¡Ten lista la correa!`
- **en:** `🚶 {{1}} is on the way to pick up {{2}}. Get the leash ready!`

## firuwalk_walk_started

Parameters: `{{1}}` walker's first name · `{{2}}` dog · `{{3}}` link

- **es:** `🐾 {{1}} inició el paseo de {{2}}. Síguelo en vivo: {{3}}`
- **en:** `🐾 {{1}} started {{2}}'s walk. Follow it live: {{3}}`

## firuwalk_walk_finished

Parameters: `{{1}}` walker's first name · `{{2}}` dog · `{{3}}` link

- **es:** `🎉 {{2}} volvió de su paseo con {{1}}. Mira el reporte con fotos y recorrido: {{3}}`
- **en:** `🎉 {{2}} is back from the walk with {{1}}. See the report with photos and route: {{3}}`

## firuwalk_payment_received

Parameters: `{{1}}` amount ("Bs 15,00") · `{{2}}` what it pays ("paseo de Max" / plan name)

- **es:** `🔒 Recibimos tu pago de {{1}} por {{2}}. FiruWalk lo retiene y lo libera al paseador cuando el paseo se completa.`
- **en:** `🔒 We received your {{1}} payment for {{2}}. FiruWalk holds it and releases it to the walker when the walk is completed.`

## firuwalk_payout_sent

Parameters: `{{1}}` amount · `{{2}}` bank reference

- **es:** `💸 Te enviamos {{1}} (ref. {{2}}). ¡Gracias por pasear con FiruWalk!`
- **en:** `💸 We sent you {{1}} (ref. {{2}}). Thanks for walking with FiruWalk!`

## firuwalk_plan_expiring

Parameters: `{{1}}` plan name · `{{2}}` end date · `{{3}}` walks left

- **es:** `📅 Tu {{1}} vence el {{2}} y te quedan {{3}} paseos. Úsalos o renueva tu plan en FiruWalk.`
- **en:** `📅 Your {{1}} ends on {{2}} and you have {{3}} walks left. Use them or renew your plan in FiruWalk.`
