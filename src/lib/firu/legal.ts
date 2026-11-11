// Legal documents (Phase 1, step 8): Terms, Privacy, Walker Agreement and
// Cancellation & Guarantee policy — Spanish first, English as a courtesy
// translation (Spanish prevails).
//
// The text is built from the live Config, so the numbers people agree to
// (free-cancellation window, late-cancel share, commission, payout cycle,
// FirulAI chat retention…) are always the ones the app enforces.
//
// Bump LEGAL_VERSION whenever the wording changes in substance: sign-ins
// and walker applications record the version that was accepted.

import type { AppConfig } from "./types";

export const LEGAL_VERSION = "2026-11-11";

export const LEGAL_SLUGS = ["terminos", "privacidad", "paseadores", "cancelaciones"] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];
export type LegalLang = "es" | "en";

export interface LegalSection {
  heading: string;
  paragraphs: string[];
}

export interface LegalDoc {
  slug: LegalSlug;
  title: string;
  summary: string;
  sections: LegalSection[];
}

export function isLegalSlug(s: string): s is LegalSlug {
  return (LEGAL_SLUGS as readonly string[]).includes(s);
}

/** Display date of LEGAL_VERSION ("11 de noviembre de 2026" / "November 11, 2026"). */
export function legalDate(lang: LegalLang): string {
  const [y, m, d] = LEGAL_VERSION.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(lang === "en" ? "en-US" : "es-BO", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export const LEGAL_TITLES: Record<LegalLang, Record<LegalSlug, string>> = {
  es: {
    terminos: "Términos y Condiciones",
    privacidad: "Política de Privacidad",
    paseadores: "Acuerdo de Paseadores",
    cancelaciones: "Cancelaciones y Garantía",
  },
  en: {
    terminos: "Terms & Conditions",
    privacidad: "Privacy Policy",
    paseadores: "Walker Agreement",
    cancelaciones: "Cancellation & Guarantee Policy",
  },
};

function bs(cents: number, lang: LegalLang): string {
  const n = cents / 100;
  return `Bs ${n.toLocaleString(lang === "en" ? "en-US" : "es-BO", {
    minimumFractionDigits: cents % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

interface Ctx {
  brand: string;
  company: string;
  companyLine: string;
  contactLine: string;
  city: string;
  wa: string;
  cfg: AppConfig;
}

function ctxOf(cfg: AppConfig, lang: LegalLang): Ctx {
  const brand = cfg.platform.name || "FiruWalk";
  const legal = cfg.legal ?? { companyName: "", nit: "", address: "", email: "" };
  const company = legal.companyName.trim() || brand;
  const bits = [company];
  if (legal.nit.trim()) bits.push(`NIT ${legal.nit.trim()}`);
  if (legal.address.trim()) bits.push(legal.address.trim());
  const contact = [`WhatsApp ${cfg.platform.supportWhatsApp}`];
  if (legal.email.trim()) contact.push(legal.email.trim());
  return {
    brand,
    company,
    companyLine: bits.join(" · "),
    contactLine: contact.join(lang === "en" ? " or " : " o "),
    city: cfg.platform.city,
    wa: cfg.platform.supportWhatsApp,
    cfg,
  };
}

/* ------------------------------------------------------------------ */
/* Spanish (governing text)                                            */
/* ------------------------------------------------------------------ */

function termsEs(c: Ctx): LegalDoc {
  const { cfg } = c;
  return {
    slug: "terminos",
    title: LEGAL_TITLES.es.terminos,
    summary: `Las reglas para usar ${c.brand}: quiénes somos, qué hace la plataforma, cómo se paga y qué esperamos de dueños y paseadores.`,
    sections: [
      {
        heading: "1. Quiénes somos",
        paragraphs: [
          `${c.brand} (${c.companyLine}) opera una plataforma que conecta a dueños de perros con paseadores independientes verificados en ${c.city}, Bolivia. Contacto: ${c.contactLine}.`,
          "Al crear una cuenta, ingresar con tu celular o reservar un paseo aceptas estos Términos, la Política de Privacidad y la Política de Cancelaciones y Garantía. Si no estás de acuerdo, no uses la plataforma.",
        ],
      },
      {
        heading: "2. Qué hace la plataforma",
        paragraphs: [
          `${c.brand} te permite registrar a tus perros, reservar paseos únicos o recurrentes, seguir el paseo en vivo por GPS, recibir un reporte con fotos y pagar en línea. Los paseos los realizan paseadores independientes que aprobamos tras un proceso de verificación (entrevista, documento de identidad, certificado de antecedentes y paseo de prueba).`,
          `Los paseadores no son empleados de ${c.brand}: prestan el servicio por su cuenta según el Acuerdo de Paseadores. ${c.brand} gestiona las reservas, los cobros, la calidad del servicio y la atención de reclamos.`,
        ],
      },
      {
        heading: "3. Tu cuenta",
        paragraphs: [
          "Ingresas con tu número de celular y un código que te enviamos por WhatsApp o SMS. Eres responsable de mantener el control de tu celular y de que tus datos (nombre, dirección, datos de tus perros) sean verdaderos y estén actualizados.",
          "Debes ser mayor de 18 años para crear una cuenta y reservar. Podemos suspender cuentas usadas para fraude, abuso, acoso, pagos faleres o para contratar paseadores fuera de la plataforma.",
        ],
      },
      {
        heading: "4. Tus perros",
        paragraphs: [
          "Declarás que eres el dueño o responsable del perro, que tiene sus vacunas al día (incluida la antirrábica, según la normativa municipal) y que nos informaste con honestidad su temperamento, conducta con personas y otros perros, condiciones de salud y cualquier restricción.",
          "Debes entregar al perro con collar o arnés en buen estado y placa de identificación. El paseador puede negarse a pasear a un perro que esté enfermo, herido, en celo sin aviso previo o que represente un riesgo; en ese caso aplica la Política de Cancelaciones.",
          `Por el calor de ${c.city}, evitamos los paseos en las horas de mayor temperatura y podemos acortar o reprogramar un paseo por clima extremo o lluvia fuerte.`,
        ],
      },
      {
        heading: "5. Precios y pagos",
        paragraphs: [
          `Los precios se muestran en bolivianos antes de confirmar la reserva (referencia actual: 30 min ${bs(cfg.pricing.price30Cents, "es")}, 45 min ${bs(cfg.pricing.price45Cents, "es")}, 60 min ${bs(cfg.pricing.price60Cents, "es")}). Puedes pagar con QR, transferencia o efectivo cuando esté habilitado. Los códigos QR vencen a los ${cfg.payments.qrExpiryMinutes} minutos.`,
          "Los pagos en línea se confirman solo cuando el banco o el proveedor de pagos nos notifica; hasta entonces la reserva queda pendiente. Retenemos el pago hasta que el paseo se completa y luego liquidamos al paseador.",
          `Las propinas van ${cfg.fees.tipPassThroughPct}% al paseador. Los planes mensuales incluyen una cantidad de paseos por periodo; ${cfg.plans.unusedWalkPolicy === "credit" ? "los paseos no usados al cierre del periodo se acreditan a tu saldo" : "los paseos no usados al cierre del periodo no se acumulan ni se reembolsan"}.`,
          "Si necesitas factura, pídela por WhatsApp indicando nombre/razón social y NIT o CI.",
        ],
      },
      {
        heading: "6. Reglas de convivencia",
        paragraphs: [
          `Para tu protección, toda la coordinación y los pagos deben hacerse dentro de ${c.brand}. Fuera de la plataforma no podemos aplicar la Garantía, el seguimiento GPS ni la resolución de reclamos. Ocultamos datos de contacto en el chat por este motivo.`,
          "Trata con respeto a los paseadores y al equipo. No se permite discriminación, acoso, amenazas ni pedidos de servicios ajenos al paseo.",
        ],
      },
      {
        heading: "7. Responsabilidad",
        paragraphs: [
          `${c.brand} verifica a los paseadores y supervisa los paseos, pero los perros son animales y pueden ocurrir incidentes aun con el debido cuidado. Ante una emergencia el paseador activa el protocolo SOS: prioriza la seguridad del perro, te avisa y, si hace falta, lo lleva a la veterinaria más cercana.`,
          `Si un incidente se produce por negligencia comprobada del paseador o de ${c.brand}, cubriremos los gastos veterinarios razonables y documentados derivados del paseo. No respondemos por condiciones de salud preexistentes no informadas, por conductas del perro que el dueño ocultó, ni por daños indirectos.`,
          "Nada en estos Términos limita los derechos que te reconoce la Ley N.º 453 General de los Derechos de las Usuarias y los Usuarios y de las Consumidoras y los Consumidores.",
        ],
      },
      {
        heading: "8. FirulAI",
        paragraphs: [
          `FirulAI es nuestro asistente automático: responde consultas sobre precios, zonas y reservas, y te deriva a una persona por WhatsApp cuando lo necesitas. Puede equivocarse; lo que vale es lo que confirma la app al reservar. FirulAI no da diagnósticos veterinarios: ante síntomas, consulta a tu veterinario.`,
        ],
      },
      {
        heading: "9. Reclamos, cambios y ley aplicable",
        paragraphs: [
          `Escríbenos a ${c.contactLine} para cualquier reclamo; respondemos dentro de las 48 horas hábiles y buscamos resolverlo dentro de los 10 días hábiles. También puedes acudir a la autoridad de defensa del consumidor.`,
          "Podemos actualizar estos documentos. Si el cambio es importante te avisaremos en la app y te pediremos aceptarlo de nuevo; la fecha de la versión vigente aparece al inicio de cada documento.",
          `Estos Términos se rigen por las leyes del Estado Plurinacional de Bolivia. Ante cualquier controversia, buscaremos primero una solución amistosa; si no es posible, serán competentes los tribunales de ${c.city}. Si hubiera diferencias entre la versión en español y una traducción, prevalece la versión en español.`,
        ],
      },
    ],
  };
}

function privacyEs(c: Ctx): LegalDoc {
  const { cfg } = c;
  return {
    slug: "privacidad",
    title: LEGAL_TITLES.es.privacidad,
    summary: "Qué datos recolectamos, para qué los usamos, con quién los compartimos y cómo ejercer tus derechos.",
    sections: [
      {
        heading: "1. Responsable",
        paragraphs: [
          `${c.companyLine} es responsable del tratamiento de tus datos personales. Para cualquier consulta o pedido sobre tus datos: ${c.contactLine}.`,
          "Tratamos tus datos conforme al derecho a la privacidad e intimidad y a la protección de datos que reconoce la Constitución Política del Estado (art. 21 y art. 130) y la normativa boliviana aplicable.",
        ],
      },
      {
        heading: "2. Qué datos recolectamos",
        paragraphs: [
          "Dueños: nombre, número de celular, zona, dirección y referencias para recoger al perro, ubicación aproximada del domicilio, datos de tus perros (nombre, raza, edad, salud, temperamento, fotos), reservas, pagos, mensajes con el paseador y reseñas.",
          "Paseadores: además de lo anterior, número de documento de identidad (cifrado; solo se muestran los últimos 4 dígitos), fotos del documento, certificado de antecedentes y otros documentos de verificación (guardados en almacenamiento privado, nunca públicos), datos de cuenta para pagos y ubicación GPS durante los paseos.",
          `Durante cada paseo registramos el recorrido GPS del paseador y las fotos del reporte. Si usas FirulAI, guardamos la conversación (sin tu dirección IP) por ${cfg.ai.retentionDays} días para mejorar el servicio y atender reclamos; luego se borra automáticamente.`,
          "Datos técnicos: tipo de dispositivo, registros de acceso y de seguridad, y la suscripción a notificaciones si las activas.",
        ],
      },
      {
        heading: "3. Para qué los usamos",
        paragraphs: [
          "Para prestar el servicio (reservas, asignación de paseadores, seguimiento en vivo, reportes, cobros y pagos a paseadores), verificar identidades, prevenir fraude, atender emergencias y reclamos, enviarte avieres sobre tus paseos y cumplir obligaciones legales y tributarias.",
          "Solo te enviaremos promociones si lo aceptas, y puedes dejar de recibirlas en cualquier momento.",
          "Las fotos de los paseos son para ti. No las publicamos en redes sociales sin tu autorización expresa.",
        ],
      },
      {
        heading: "4. Con quién los compartimos",
        paragraphs: [
          "Con el paseador asignado: el nombre del dueño, la dirección de recogida y los datos del perro necesarios para el paseo. Con el dueño: el nombre, foto, reseñas y la ubicación del paseador solo mientras el paseo está en curso.",
          "Con proveedores que nos ayudan a operar, bajo deber de confidencialidad: alojamiento y base de datos en la nube, almacenamiento de archivos, mensajería (WhatsApp/SMS), notificaciones, bancos y procesadores de pago, y el proveedor de inteligencia artificial que usa FirulAI. Algunos de estos servidores están fuera de Bolivia (por ejemplo en Brasil o Estados Unidos).",
          "Con autoridades, solo cuando la ley lo exija o para proteger la seguridad de una persona o un animal. No vendemos tus datos.",
        ],
      },
      {
        heading: "5. Cuánto tiempo los guardamos",
        paragraphs: [
          `Mientras tengas una cuenta activa y luego el tiempo que exijan las obligaciones tributarias y contables, o el necesario para atender reclamos. Las conversaciones con FirulAI se borran a los ${cfg.ai.retentionDays} días. Los documentos de paseadores rechazados o dados de baja se eliminan cuando ya no son necesarios para la verificación o para un reclamo.`,
        ],
      },
      {
        heading: "6. Tus derechos",
        paragraphs: [
          `Puedes pedir acceso a tus datos, corregirlos, eliminarlos o retirar un consentimiento (por ejemplo, el uso de fotos) escribiendo a ${c.contactLine}. Responderemos dentro de los 15 días hábiles. Algunos datos pueden conservarse si la ley lo exige.`,
        ],
      },
      {
        heading: "7. Seguridad",
        paragraphs: [
          "Usamos conexiones cifradas, sesiones seguras, cifrado de los números de documento, almacenamiento privado para documentos y fotos, y acceso restringido para el equipo. Ningún sistema es infalible: si detectamos un incidente que afecte tus datos, te avisaremos.",
        ],
      },
    ],
  };
}

function walkerEs(c: Ctx): LegalDoc {
  const { cfg } = c;
  const cycle = cfg.payouts.cycle === "weekly" ? "semanal" : cfg.payouts.cycle;
  return {
    slug: "paseadores",
    title: LEGAL_TITLES.es.paseadores,
    summary: `Las condiciones para prestar servicios de paseo a través de ${c.brand} como paseador independiente.`,
    sections: [
      {
        heading: "1. Relación independiente",
        paragraphs: [
          `Prestas servicios de paseo como proveedor independiente, por tu cuenta y riesgo. Este acuerdo no crea una relación laboral, de sociedad ni de agencia con ${c.brand} (${c.companyLine}). Eliges tu disponibilidad, tus zonas y qué solicitudes aceptar.`,
          "Eres responsable de tus obligaciones tributarias y de seguridad social según tu situación. Puedes prestar servicios a otras plataformas o clientes, pero no a clientes que conociste a través de la plataforma por fuera de ella.",
        ],
      },
      {
        heading: "2. Verificación",
        paragraphs: [
          "Para ser aprobado debes pasar una entrevista, presentar tu documento de identidad y un certificado de antecedentes vigente (REJAP), y completar un paseo de prueba. Autorizas a verificar esa información. Debes avisarnos si cambia tu situación (por ejemplo, un nuevo antecedente).",
          `Tus primeros ${cfg.policy.trialWalks} paseos son de prueba y recibirán un seguimiento más cercano.`,
        ],
      },
      {
        heading: "3. Estándares del servicio",
        paragraphs: [
          "Llegar puntual, usar la app durante todo el paseo con el GPS activo (iniciar y terminar en la dirección del dueño), usar siempre correa, no soltar al perro, no pasear más perros de los permitidos, llevar agua y bolsas, recoger los desechos y enviar el reporte con fotos al terminar.",
          "No pasear en horas de calor extremo; ante clima peligroso, avisar y reprogramar. Nunca dejar al perro solo, atado afuera de un comercio ni en un vehículo.",
          "Ante una emergencia, activar el SOS en la app: priorizar la seguridad del perro, avisar al dueño y al equipo, y acudir a la veterinaria más cercana si hace falta.",
          "Toda la coordinación y los cobros se hacen dentro de la plataforma. No pedir pagos directos ni compartir datos de contacto para trabajar por fuera.",
          "Manipular el GPS o reportar paseos no realizados es causa de baja inmediata y de la retención de los montos involucrados.",
        ],
      },
      {
        heading: "4. Pagos al paseador",
        paragraphs: [
          `Por cada paseo completado recibes el precio del paseo menos la comisión de la plataforma (${cfg.fees.commissionPct}%). Las propinas son ${cfg.fees.tipPassThroughPct}% para ti.`,
          `Los pagos se liquidan con frecuencia ${cycle} a la cuenta bancaria o QR que registres, a partir de un saldo mínimo de ${bs(cfg.payouts.minPayoutCents, "es")}. En paseos cobrados en efectivo, la comisión se descuenta de tu saldo; si la deuda supera ${bs(cfg.payouts.maxCashDebtCents, "es")}, no recibirás nuevas reservas hasta regularizarla.`,
          `Si el dueño cancela con menos de ${cfg.policy.cancellationFreeHours} horas de anticipación, recibes el ${cfg.policy.lateCancelWalkerSharePct}% del precio del paseo (neto de comisión).`,
        ],
      },
      {
        heading: "5. Cancelaciones y ausencias",
        paragraphs: [
          `Si cancelas un paseo aceptado o no te presentas, se registra una falta y el paseo se ofrece a un paseador de respaldo. El dueño recibe un crédito de compensación de ${bs(cfg.policy.noShowCreditCents, "es")}. Las faltas repetidas pueden llevar a la suspensión.`,
          `Si vas a llegar más de ${cfg.safety.lateStartMinutes} minutos tarde, avisa por la app: el sistema puede ofrecer el paseo a un respaldo.`,
        ],
      },
      {
        heading: "6. Responsabilidad y datos",
        paragraphs: [
          "Respondes por los daños causados por tu negligencia durante el paseo. Debes informar de inmediato cualquier incidente, mordida, pelea, escape o lesión.",
          "Los datos de los dueños (dirección, teléfono, información del perro) son confidenciales: úsalos solo para el paseo y no los compartas. Aceptas que registremos tu ubicación GPS durante los paseos y tus documentos según la Política de Privacidad.",
        ],
      },
      {
        heading: "7. Suspensión y baja",
        paragraphs: [
          `Puedes dejar de usar la plataforma cuando quieras; se te pagará el saldo pendiente en el siguiente ciclo. ${c.brand} puede suspender o dar de baja tu cuenta por incumplimiento de este acuerdo, reseñas consistentemente bajas, faltas reiteradas, información falsa o conductas que pongan en riesgo a perros o personas.`,
          "Este acuerdo se rige por las leyes de Bolivia y complementa los Términos y Condiciones.",
        ],
      },
    ],
  };
}

function cancellationEs(c: Ctx): LegalDoc {
  const { cfg } = c;
  const h = cfg.policy.cancellationFreeHours;
  return {
    slug: "cancelaciones",
    title: LEGAL_TITLES.es.cancelaciones,
    summary: "Cuándo puedes cancelar sin costo, qué pasa si cancela el paseador y qué cubre la Garantía.",
    sections: [
      {
        heading: "1. Si cancelas tú",
        paragraphs: [
          `Gratis hasta ${h} horas antes del paseo: te devolvemos el 100% de lo pagado.`,
          `Con menos de ${h} horas de anticipación (y con un paseador ya asignado): el paseador recibe el ${cfg.policy.lateCancelWalkerSharePct}% del precio del paseo como compensación por el tiempo reservado, y te devolvemos el resto.`,
          "Si el paseador no puede pasear al perro por motivos atribuibles al dueño (nadie entrega al perro, perro enfermo o agresivo no informado), se considera una cancelación tardía.",
          "Reprogramar una reserva confirmada desde la app no tiene costo.",
        ],
      },
      {
        heading: "2. Si cancela o falta el paseador",
        paragraphs: [
          `Buscamos de inmediato un paseador de respaldo de la zona, te avisamos y te acreditamos ${bs(cfg.policy.noShowCreditCents, "es")} de cortesía para tu próximo paseo.`,
          "Si no conseguimos respaldo, te devolvemos el 100% de lo pagado por ese paseo.",
        ],
      },
      {
        heading: "3. Garantía " + c.brand,
        paragraphs: [
          cfg.platform.guaranteeText,
          "Si el paseo no se realizó como corresponde (por ejemplo, fue mucho más corto de lo reservado según el GPS, o no llegó el reporte), repórtalo desde la app o por WhatsApp dentro de las 48 horas. Revisamos el recorrido y el reporte y, si corresponde, te devolvemos el paseo o te lo acreditamos.",
          `Por clima extremo o lluvia fuerte, ${c.brand} o el paseador pueden reprogramar el paseo sin costo para ninguna de las partes.`,
        ],
      },
      {
        heading: "4. Cómo se devuelve el dinero",
        paragraphs: [
          "Los reemboleres de pagos con QR o transferencia se devuelven por el mismo medio o como saldo en tu cuenta, según prefieras. El plazo depende del banco (normalmente hasta 5 días hábiles). Los créditos de cortesía no son canjeables por dinero.",
          `Los paseos de planes mensuales cancelados a tiempo vuelven al saldo de tu plan. ${cfg.plans.unusedWalkPolicy === "credit" ? "Los paseos no usados al cierre del periodo se acreditan a tu saldo." : "Los paseos no usados al cierre del periodo no se acumulan ni se reembolsan."}`,
        ],
      },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* English (courtesy translation)                                      */
/* ------------------------------------------------------------------ */

function termsEn(c: Ctx): LegalDoc {
  const { cfg } = c;
  return {
    slug: "terminos",
    title: LEGAL_TITLES.en.terminos,
    summary: `The rules for using ${c.brand}: who we are, what the platform does, how payment works and what we expect from owners and walkers.`,
    sections: [
      {
        heading: "1. Who we are",
        paragraphs: [
          `${c.brand} (${c.companyLine}) runs a platform that connects dog owners with vetted independent walkers in ${c.city}, Bolivia. Contact: ${c.contactLine}.`,
          "By creating an account, signing in with your phone or booking a walk you accept these Terms, the Privacy Policy and the Cancellation & Guarantee Policy. If you don't agree, please don't use the platform.",
        ],
      },
      {
        heading: "2. What the platform does",
        paragraphs: [
          `${c.brand} lets you register your dogs, book one-off or recurring walks, follow the walk live by GPS, receive a report with photos and pay online. Walks are done by independent walkers we approve after vetting (interview, ID document, criminal-record certificate and a trial walk).`,
          `Walkers are not ${c.brand} employees: they provide the service on their own account under the Walker Agreement. ${c.brand} manages bookings, payments, service quality and complaints.`,
        ],
      },
      {
        heading: "3. Your account",
        paragraphs: [
          "You sign in with your phone number and a code we send by WhatsApp or SMS. You are responsible for keeping control of your phone and for your details (name, address, dog details) being true and up to date.",
          "You must be 18 or older to create an account and book. We may suspend accounts used for fraud, abuse, harassment, fake payments or to hire walkers off the platform.",
        ],
      },
      {
        heading: "4. Your dogs",
        paragraphs: [
          "You confirm you are the dog's owner or keeper, that its vaccinations are up to date (including rabies, as municipal rules require) and that you honestly told us about its temperament, behaviour with people and other dogs, health conditions and any restrictions.",
          "Hand the dog over with a collar or harness in good condition and an ID tag. A walker may refuse to walk a dog that is ill, injured, in heat without prior notice, or a risk; the Cancellation Policy then applies.",
          `Because of the ${c.city} heat we avoid walks in the hottest hours and may shorten or reschedule a walk for extreme weather or heavy rain.`,
        ],
      },
      {
        heading: "5. Prices and payment",
        paragraphs: [
          `Prices are shown in bolivianos before you confirm (current reference: 30 min ${bs(cfg.pricing.price30Cents, "en")}, 45 min ${bs(cfg.pricing.price45Cents, "en")}, 60 min ${bs(cfg.pricing.price60Cents, "en")}). You can pay by QR, bank transfer or cash where enabled. QR codes expire after ${cfg.payments.qrExpiryMinutes} minutes.`,
          "Online payments are confirmed only when the bank or payment provider notifies us; until then the booking stays pending. We hold the payment until the walk is completed and then pay the walker.",
          `Tips go ${cfg.fees.tipPassThroughPct}% to the walker. Monthly plans include a number of walks per period; ${cfg.plans.unusedWalkPolicy === "credit" ? "walks left unused at the end of the period are credited to your balance" : "walks left unused at the end of the period don't roll over and aren't refunded"}.`,
          "If you need an invoice (factura), ask on WhatsApp with your name/company name and NIT or CI.",
        ],
      },
      {
        heading: "6. House rules",
        paragraphs: [
          `For your protection, all coordination and payments must happen inside ${c.brand}. Off the platform we can't apply the Guarantee, GPS tracking or complaint handling. That's why contact details are hidden in the chat.`,
          "Treat walkers and the team with respect. Discrimination, harassment, threats or requests for services other than the walk are not allowed.",
        ],
      },
      {
        heading: "7. Liability",
        paragraphs: [
          `${c.brand} vets walkers and supervises walks, but dogs are animals and incidents can happen even with due care. In an emergency the walker follows the SOS protocol: puts the dog's safety first, alerts you and, if needed, takes it to the nearest vet.`,
          `If an incident is caused by proven negligence of the walker or ${c.brand}, we will cover reasonable, documented vet costs arising from the walk. We are not liable for undisclosed pre-existing conditions, dog behaviour the owner concealed, or indirect damages.`,
          "Nothing in these Terms limits your rights under Bolivian Law No. 453 on the rights of users and consumers.",
        ],
      },
      {
        heading: "8. FirulAI",
        paragraphs: [
          "FirulAI is our automated assistant: it answers questions about prices, zones and bookings and hands you to a person on WhatsApp when needed. It can make mistakes; what counts is what the app confirms when you book. FirulAI does not give veterinary diagnoses: for symptoms, talk to your vet.",
        ],
      },
      {
        heading: "9. Complaints, changes and governing law",
        paragraphs: [
          `Write to ${c.contactLine} with any complaint; we reply within 48 business hours and aim to resolve it within 10 business days. You may also go to the consumer-protection authority.`,
          "We may update these documents. For important changes we'll tell you in the app and ask you to accept again; the date of the current version is shown at the top of each document.",
          `These Terms are governed by the laws of the Plurinational State of Bolivia. We'll first look for an amicable solution to any dispute; failing that, the courts of ${c.city} have jurisdiction. This English text is a courtesy translation: if it differs from the Spanish version, the Spanish version prevails.`,
        ],
      },
    ],
  };
}

function privacyEn(c: Ctx): LegalDoc {
  const { cfg } = c;
  return {
    slug: "privacidad",
    title: LEGAL_TITLES.en.privacidad,
    summary: "What data we collect, what we use it for, who we share it with and how to exercise your rights.",
    sections: [
      {
        heading: "1. Controller",
        paragraphs: [
          `${c.companyLine} is responsible for your personal data. For any question or request about your data: ${c.contactLine}.`,
          "We handle your data in line with the rights to privacy and data protection recognised by the Bolivian Constitution (art. 21 and art. 130) and applicable Bolivian law.",
        ],
      },
      {
        heading: "2. What we collect",
        paragraphs: [
          "Owners: name, phone number, zone, pickup address and directions, approximate home location, your dogs' details (name, breed, age, health, temperament, photos), bookings, payments, messages with the walker and reviews.",
          "Walkers: in addition, ID number (encrypted; only the last 4 digits are ever shown), ID photos, criminal-record certificate and other vetting documents (kept in private storage, never public), payout account details and GPS location during walks.",
          `During each walk we record the walker's GPS route and the report photos. If you use FirulAI we keep the conversation (without your IP address) for ${cfg.ai.retentionDays} days to improve the service and handle complaints; then it is deleted automatically.`,
          "Technical data: device type, access and security logs, and your notification subscription if you turn it on.",
        ],
      },
      {
        heading: "3. What we use it for",
        paragraphs: [
          "To provide the service (bookings, walker matching, live tracking, reports, charging and paying walkers), verify identities, prevent fraud, handle emergencies and complaints, send you updates about your walks and meet legal and tax obligations.",
          "We only send promotions if you agree, and you can opt out at any time.",
          "Walk photos are for you. We don't post them on social media without your express permission.",
        ],
      },
      {
        heading: "4. Who we share it with",
        paragraphs: [
          "With the assigned walker: the owner's name, pickup address and the dog details needed for the walk. With the owner: the walker's name, photo, reviews and location only while the walk is in progress.",
          "With providers that help us operate, under confidentiality: cloud hosting and database, file storage, messaging (WhatsApp/SMS), notifications, banks and payment processors, and the AI provider behind FirulAI. Some of these servers are outside Bolivia (for example in Brazil or the United States).",
          "With authorities only when the law requires it or to protect the safety of a person or an animal. We don't sell your data.",
        ],
      },
      {
        heading: "5. How long we keep it",
        paragraphs: [
          `While your account is active, then for as long as tax and accounting obligations require, or as needed to handle complaints. FirulAI chats are deleted after ${cfg.ai.retentionDays} days. Documents of rejected or departed walkers are deleted once no longer needed for vetting or a complaint.`,
        ],
      },
      {
        heading: "6. Your rights",
        paragraphs: [
          `You can ask to access, correct or delete your data, or withdraw a consent (for example, photo use), by writing to ${c.contactLine}. We'll reply within 15 business days. Some data may be kept where the law requires it.`,
        ],
      },
      {
        heading: "7. Security",
        paragraphs: [
          "We use encrypted connections, secure sessions, encryption of ID numbers, private storage for documents and photos, and restricted team access. No system is infallible: if we detect an incident affecting your data, we'll let you know.",
        ],
      },
    ],
  };
}

function walkerEn(c: Ctx): LegalDoc {
  const { cfg } = c;
  return {
    slug: "paseadores",
    title: LEGAL_TITLES.en.paseadores,
    summary: `The terms for providing walking services through ${c.brand} as an independent walker.`,
    sections: [
      {
        heading: "1. Independent relationship",
        paragraphs: [
          `You provide walking services as an independent provider, on your own account and risk. This agreement creates no employment, partnership or agency relationship with ${c.brand} (${c.companyLine}). You choose your availability, your zones and which requests to accept.`,
          "You are responsible for your own tax and social-security obligations. You may work for other platforms or clients, but not for clients you met through the platform outside of it.",
        ],
      },
      {
        heading: "2. Vetting",
        paragraphs: [
          "To be approved you must pass an interview, provide your ID document and a current criminal-record certificate (REJAP), and complete a trial walk. You authorise us to verify this information and must tell us if your situation changes (for example, a new record).",
          `Your first ${cfg.policy.trialWalks} walks are trial walks and are followed more closely.`,
        ],
      },
      {
        heading: "3. Service standards",
        paragraphs: [
          "Be on time; use the app for the whole walk with GPS on (start and finish at the owner's address); always use a leash and never let the dog off it; don't walk more dogs than allowed; carry water and bags; pick up waste; send the photo report when you finish.",
          "Don't walk in extreme heat; in dangerous weather, notify and reschedule. Never leave the dog alone, tied outside a shop or in a vehicle.",
          "In an emergency, press SOS in the app: put the dog's safety first, alert the owner and the team, and go to the nearest vet if needed.",
          "All coordination and payment happens inside the platform. Don't ask for direct payments or share contact details to work off-platform.",
          "Tampering with GPS or reporting walks that didn't happen means immediate removal and withholding of the amounts involved.",
        ],
      },
      {
        heading: "4. Walker pay",
        paragraphs: [
          `For each completed walk you receive the walk price minus the platform commission (${cfg.fees.commissionPct}%). Tips are ${cfg.fees.tipPassThroughPct}% yours.`,
          `Payouts run ${cfg.payouts.cycle} to the bank account or QR you register, from a minimum balance of ${bs(cfg.payouts.minPayoutCents, "en")}. For cash walks the commission is taken from your balance; if what you owe exceeds ${bs(cfg.payouts.maxCashDebtCents, "en")}, you get no new bookings until it's settled.`,
          `If the owner cancels less than ${cfg.policy.cancellationFreeHours} hours ahead, you receive ${cfg.policy.lateCancelWalkerSharePct}% of the walk price (net of commission).`,
        ],
      },
      {
        heading: "5. Cancellations and no-shows",
        paragraphs: [
          `If you cancel an accepted walk or don't show up, a strike is recorded and the walk is offered to a backup walker. The owner gets a ${bs(cfg.policy.noShowCreditCents, "en")} compensation credit. Repeated strikes can lead to suspension.`,
          `If you'll be more than ${cfg.safety.lateStartMinutes} minutes late, tell us in the app: the system may offer the walk to a backup.`,
        ],
      },
      {
        heading: "6. Liability and data",
        paragraphs: [
          "You are liable for damage caused by your negligence during the walk and must report any incident, bite, fight, escape or injury immediately.",
          "Owners' data (address, phone, dog information) is confidential: use it only for the walk and don't share it. You accept that we record your GPS location during walks and keep your documents as described in the Privacy Policy.",
        ],
      },
      {
        heading: "7. Suspension and leaving",
        paragraphs: [
          `You can stop using the platform at any time; your remaining balance is paid in the next cycle. ${c.brand} may suspend or remove your account for breaching this agreement, consistently low reviews, repeated strikes, false information or conduct that puts dogs or people at risk.`,
          "This agreement is governed by Bolivian law and supplements the Terms & Conditions. The Spanish version prevails.",
        ],
      },
    ],
  };
}

function cancellationEn(c: Ctx): LegalDoc {
  const { cfg } = c;
  const h = cfg.policy.cancellationFreeHours;
  return {
    slug: "cancelaciones",
    title: LEGAL_TITLES.en.cancelaciones,
    summary: "When you can cancel for free, what happens if the walker cancels and what the Guarantee covers.",
    sections: [
      {
        heading: "1. If you cancel",
        paragraphs: [
          `Free up to ${h} hours before the walk: we refund 100% of what you paid.`,
          `Less than ${h} hours ahead (with a walker already assigned): the walker receives ${cfg.policy.lateCancelWalkerSharePct}% of the walk price for the time they reserved, and we refund the rest.`,
          "If the walker can't walk the dog for reasons on the owner's side (nobody hands the dog over, an undisclosed sick or aggressive dog), it counts as a late cancellation.",
          "Rescheduling a confirmed booking in the app is free.",
        ],
      },
      {
        heading: "2. If the walker cancels or doesn't show",
        paragraphs: [
          `We immediately look for a backup walker in your zone, let you know, and add a ${bs(cfg.policy.noShowCreditCents, "en")} courtesy credit for your next walk.`,
          "If we can't find a backup, we refund 100% of what you paid for that walk.",
        ],
      },
      {
        heading: `3. The ${c.brand} Guarantee`,
        paragraphs: [
          "If your walker cancels, we find a backup or credit you the walk.",
          "If the walk wasn't done properly (for example, the GPS shows it was much shorter than booked, or no report arrived), report it in the app or on WhatsApp within 48 hours. We review the route and the report and, where appropriate, refund or credit the walk.",
          `For extreme weather or heavy rain, ${c.brand} or the walker may reschedule the walk at no cost to either side.`,
        ],
      },
      {
        heading: "4. How refunds work",
        paragraphs: [
          "QR or transfer payments are refunded the same way or as balance in your account, as you prefer. Timing depends on the bank (usually up to 5 business days). Courtesy credits can't be exchanged for cash.",
          `Monthly-plan walks cancelled in time go back to your plan balance. ${cfg.plans.unusedWalkPolicy === "credit" ? "Walks left unused at the end of the period are credited to your balance." : "Walks left unused at the end of the period don't roll over and aren't refunded."}`,
        ],
      },
    ],
  };
}

const BUILDERS: Record<LegalLang, Record<LegalSlug, (c: Ctx) => LegalDoc>> = {
  es: { terminos: termsEs, privacidad: privacyEs, paseadores: walkerEs, cancelaciones: cancellationEs },
  en: { terminos: termsEn, privacidad: privacyEn, paseadores: walkerEn, cancelaciones: cancellationEn },
};

export function legalDoc(slug: LegalSlug, cfg: AppConfig, lang: LegalLang): LegalDoc {
  return BUILDERS[lang][slug](ctxOf(cfg, lang));
}
