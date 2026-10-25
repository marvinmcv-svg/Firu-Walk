"""T8-f · 03 — Owner golden path: live GPS, bookings, chat, dog CRUD, explore,
detail, notifications — and FINALLY a fresh booking for TODAY (90s accept
window handoff to the walker test, so the wizard runs last). The assigned
walker's name is stashed for the walker test.
"""
import datetime
import json
from pathlib import Path

from playwright.sync_api import expect

from conftest import BASE_URL, assert_no_errors, login, logout, next_saturday, switch_view

WALKER_FILE = Path(__file__).parent / ".walker.json"


def test_owner_golden_path(page, shot, errors):
    login(page, "Ana Rivera")
    expect(page.get_by_text("¡Hola, Ana!", exact=False)).to_be_visible()
    shot("01-home")

    # ---------- LIVE walk (socket GPS through the gateway) ----------
    page.get_by_role("button", name="Ver en vivo").first.click()
    page.wait_for_timeout(2_500)
    expect(page.locator(".leaflet-container").first).to_be_visible()
    expect(page.get_by_text("Paseo en vivo", exact=False).first).to_be_visible()
    expect(page.get_by_text("está paseando", exact=False).first).to_be_visible()
    # GPS sim ticks: wait for a non-zero distance or moving elapsed
    page.wait_for_timeout(6_000)
    shot("02-live-walk")
    switch_view(page, "Inicio")

    # ---------- Próximos paseos ----------
    expect(page.get_by_text("Próximos paseos", exact=False).first).to_be_visible()

    # ---------- Bookings: tabs + expand completed report ----------
    switch_view(page, "Reservas")
    expect(page.get_by_role("tab", name="Activas")).to_be_visible()
    shot("03-bookings-activas")

    # Chat dialog on an active booking
    chat_btn = page.get_by_role("button", name="Chat", exact=True).first
    chat_btn.click()
    dlg = page.get_by_role("dialog")
    expect(dlg).to_be_visible()
    page.wait_for_timeout(1_200)
    shot("04-chat-open")
    inp = dlg.get_by_placeholder("Escribe un mensaje…")
    inp.fill("¡Hola! ¿van bien?")
    inp.press("Enter")
    page.wait_for_timeout(900)
    expect(dlg).to_contain_text("¡Hola! ¿van bien?")
    shot("05-chat-sent")
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)

    # Historial tab renders
    page.get_by_role("tab", name="Historial").click()
    page.wait_for_timeout(900)
    shot("06-bookings-historial")
    page.get_by_role("tab", name="Activas").click()
    page.wait_for_timeout(600)

    # ---------- Dog profiles: user card + dog CRUD ----------
    switch_view(page, "Perfil")
    expect(page.get_by_text("Max", exact=False).first).to_be_visible()
    shot("07-profile")

    # create a demo dog (submit requires name + breed)
    page.get_by_role("button", name="Agregar peludo").click()
    dlg = page.get_by_role("dialog")
    expect(dlg).to_be_visible()
    dlg.locator("#dog-name").fill("Testy QA")
    dlg.locator("#dog-breed").fill("Mestizo")
    # photo picker: first walk photo
    dlg.locator("img").first.click()
    page.wait_for_timeout(400)
    # submit (create-mode label)
    dlg.get_by_role("button", name="Agregar peludo", exact=True).click()
    page.wait_for_timeout(1_200)
    shot("08-dog-created")
    expect(page.get_by_text("Testy QA", exact=False).first).to_be_visible()

    # delete it again (AlertDialog confirm) — newest dog card is last
    page.get_by_role("button", name="Eliminar", exact=True).last.click()
    confirm = page.get_by_role("alertdialog")
    expect(confirm).to_be_visible()
    shot("09-dog-delete-confirm")
    confirm.get_by_role("button", name="Eliminar", exact=True).click()
    page.wait_for_timeout(1_000)
    expect(page.get_by_text("Testy QA")).to_have_count(0)
    shot("10-dog-deleted")

    # ---------- Explore + walker detail ----------
    switch_view(page, "Explorar")
    expect(page.get_by_text("verificado", exact=False).first).to_be_visible()
    shot("11-explore")

    page.get_by_role("button", name="Ver perfil").first.click()
    page.wait_for_timeout(1_200)
    expect(page.get_by_text("Reseñas", exact=False).first).to_be_visible()
    expect(page.get_by_text("Bs", exact=False).first).to_be_visible()
    shot("12-walker-detail")
    page.get_by_role("button", name="Reservar con", exact=False).first.click()
    page.wait_for_timeout(900)
    # lands back in the booking wizard (preselected walker)
    expect(page.get_by_text("Reservar paseo", exact=False).first).to_be_visible()
    shot("13-wizard-preselected")
    # leave the wizard without booking
    switch_view(page, "Explorar")

    # ---------- Notifications popover ----------
    page.locator("[aria-label='Notificaciones']").click()
    page.wait_for_timeout(800)
    expect(page.get_by_text("Notificaciones", exact=False).first).to_be_visible()
    shot("14-notifications")
    page.keyboard.press("Escape")

    # ---------- THE BOOKING WIZARD (kept last: 90s accept window) ----------
    switch_view(page, "Inicio")
    page.get_by_role("button", name="Empezar").first.click()
    page.wait_for_timeout(1_000)

    # step 1 — Perro
    expect(page.get_by_text("Perro", exact=False).first).to_be_visible()
    dog_card = page.get_by_text("Max", exact=False).first
    dog_card.click()
    page.wait_for_timeout(400)
    shot("15-wizard-dog")
    page.get_by_role("button", name="Siguiente").click()

    # step 2 — Ritmo: one-off NEXT SATURDAY at the default 07:30 h. Saturday
    # 07:30 is Luis's window (deterministic match); the walk stays SCHEDULED
    # which also exercises the "too early to start" UX in the walker app.
    page.get_by_text("Una vez", exact=False).first.click()
    page.wait_for_timeout(400)
    sat = next_saturday()
    page.locator("input[type='date']").fill(sat)
    page.get_by_text("30 min", exact=False).first.click()
    page.wait_for_timeout(400)
    shot("16-wizard-ritmo")
    page.get_by_role("button", name="Siguiente").click()

    # step 3 — Paseador: match API auto-selects the candidate
    page.wait_for_timeout(2_000)
    expect(page.get_by_text("verificado", exact=False).first).to_be_visible()
    shot("18-wizard-match")
    page.get_by_role("button", name="Siguiente").click()

    # step 4 — Confirmar: summary + QR default + submit
    expect(page.get_by_text("Confirmar", exact=False).first).to_be_visible()
    expect(page.get_by_text("QR Simple", exact=False).first).to_be_visible()
    shot("19-wizard-confirm")
    page.get_by_role("button", name="Enviar solicitud").click()
    page.wait_for_timeout(1_500)

    # success + PaymentDialog auto-opens → simulate the QR payment
    expect(page.get_by_text("¡Solicitud enviada!", exact=False).first).to_be_visible()
    shot("20-booking-success")
    dlg = page.get_by_role("dialog")
    expect(dlg).to_be_visible()
    expect(dlg).to_contain_text("Confirmar pago")
    pay_btn = dlg.get_by_role("button", name="Simular pago")
    shot("21-payment-dialog")
    pay_btn.click()
    page.wait_for_timeout(1_500)
    # paid state: "Bs X retenidos" — the dialog stays open with just an X;
    # close it so the modal doesn't block navigation
    expect(page.get_by_text("retenidos", exact=False).first).to_be_visible()
    shot("22-payment-done")
    # close via the X — Escape gets consumed by the toast layer (Radix stacking)
    page.locator("[data-slot=dialog-close]").last.click()
    page.wait_for_timeout(600)
    expect(page.get_by_role("dialog")).to_have_count(0)

    # booking visible as REQUESTED with countdown
    switch_view(page, "Reservas")
    page.wait_for_timeout(1_200)
    shot("23-booking-requested")

    # stash the assigned walker for the walker test. Demo auth travels via the
    # X-User-Id header (zustand persists the session under firuwalk-session).
    walker_name = page.evaluate(
        """async () => {
          const s = JSON.parse(localStorage.getItem('firuwalk-session') || '{}');
          const uid = s?.state?.user?.id;
          if (!uid) return null;
          const res = await fetch('/api/bookings', {
            credentials: 'include',
            headers: { 'X-User-Id': uid },
          });
          const bs = await res.json();
          if (!Array.isArray(bs)) return null;
          const b = bs.find(x => x.status === 'REQUESTED');
          return b?.walker?.name ?? null;
        }"""
    )
    assert walker_name, "no REQUESTED booking found after wizard"
    WALKER_FILE.write_text(json.dumps({"walker": walker_name}))
    print(f"\n>>> booking assigned to: {walker_name}")

    assert_no_errors(errors, "owner golden path")
    # NOTE: walker test must accept within 90s of "Enviar solicitud".
