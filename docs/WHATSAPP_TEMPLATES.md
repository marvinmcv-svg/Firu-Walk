# WhatsApp templates (Milestones 6 & 8)

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
| `firuwalk_walk_reminder` | walker | `safety.reminderMinutesBefore` before each walk (worker) |
| `firuwalk_walk_sos` | owner | the walker presses SOS during the walk |
| `firuwalk_walk_late` | owner | the walk has not started `safety.lateStartMinutes` after its time (worker) |
| `firuwalk_backup_offer` | backup walker | a late walk is offered to the next walker of the candidate chain |
| `firuwalk_walk_reassigned` | owner | a backup walker takes the walk |
| `firuwalk_backup_none` | owner | no backup walker took the walk |
| `firuwalk_ops_alert` | ops phones | SOS, late start, no backup found (Spanish only) |

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

## firuwalk_walk_reminder

Sent to the **walker** `safety.reminderMinutesBefore` minutes before a walk.
Parameters: `{{1}}` dog · `{{2}}` start time ("17:30") · `{{3}}` zone

- **es:** `⏰ Recordatorio: el paseo de {{1}} empieza a las {{2}} en {{3}}. Toca "Voy en camino" en FiruWalk cuando salgas.`
- **en:** `⏰ Reminder: {{1}}'s walk starts at {{2}} in {{3}}. Tap "On my way" in FiruWalk when you leave.`

## firuwalk_walk_sos

Sent to the **owner** when the walker presses SOS.
Parameters: `{{1}}` walker's first name · `{{2}}` dog · `{{3}}` live link

- **es:** `🚨 {{1}} activó el SOS durante el paseo de {{2}}. Nuestro equipo ya está atendiendo y te contactará. Ubicación en vivo: {{3}}`
- **en:** `🚨 {{1}} pressed SOS during {{2}}'s walk. Our team is already on it and will contact you. Live location: {{3}}`

## firuwalk_walk_late

Sent to the **owner** when a walk has not started `safety.lateStartMinutes` after its time.
Parameters: `{{1}}` dog · `{{2}}` walker's first name · `{{3}}` minutes late

- **es:** `⏱️ El paseo de {{1}} aún no empezó: {{2}} lleva {{3}} min de retraso. Ya lo estamos contactando y buscamos un paseador de respaldo.`
- **en:** `⏱️ {{1}}'s walk hasn't started: {{2}} is {{3}} min late. We're contacting them and looking for a backup walker.`

## firuwalk_backup_offer

Sent to a **backup walker** from the booking's candidate chain.
Parameters: `{{1}}` dog · `{{2}}` zone · `{{3}}` time · `{{4}}` minutes to accept

- **es:** `🆘 Paseo de respaldo urgente: {{1}} en {{2}} a las {{3}}. Tómalo en FiruWalk en los próximos {{4}} minutos.`
- **en:** `🆘 Urgent backup walk: {{1}} in {{2}} at {{3}}. Take it in FiruWalk within the next {{4}} minutes.`

## firuwalk_walk_reassigned

Sent to the **owner** when a backup walker takes the walk.
Parameters: `{{1}}` new walker's first name · `{{2}}` dog

- **es:** `✅ {{1}}, paseador verificado de FiruWalk, hará hoy el paseo de {{2}}. Misma garantía y seguimiento en vivo.`
- **en:** `✅ {{1}}, a verified FiruWalk walker, is taking {{2}}'s walk today. Same guarantee, same live tracking.`

## firuwalk_backup_none

Sent to the **owner** when the backup chain is exhausted.
Parameters: `{{1}}` dog

- **es:** `😔 Ningún paseador de respaldo estaba libre para el paseo de {{1}}. Nuestro equipo te contactará para reprogramar o acreditarte el paseo.`
- **en:** `😔 No backup walker was free for {{1}}'s walk. Our team will contact you to reschedule or credit the walk.`

## firuwalk_ops_alert

Sent to the **ops phones** in Admin → Configuración → *Seguridad* (`safety.opsWhatsApp`) — not to users, Spanish only.
WhatsApp Cloud API cannot post into WhatsApp groups: list each ops phone (or one shared ops phone that forwards to the group).
Parameters: `{{1}}` alert ("SOS", "Retraso", …) · `{{2}}` summary · `{{3}}` map link of the position

- **es:** `🚨 FiruWalk ops — {{1}}: {{2}}. Ubicación: {{3}}`
- **en:** `🚨 FiruWalk ops — {{1}}: {{2}}. Location: {{3}}`
