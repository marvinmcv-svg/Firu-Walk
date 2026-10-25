"""T8-f · 04 — Walker golden path + owner review.

The cockpit prioritizes an IN_PROGRESS walk (the seeded live walk), so the
realistic daily flow is: accept the fresh Saturday request → cockpit opens in
the LIVE phase (resume) → finish + report that walk → the new booking stays
SCHEDULED (correct "too early to start" UX) → earnings/agenda/profile.
Then Marco Tórrez reviews his seeded COMPLETED booking with a 5★ + tip.
"""
import json
import re
from pathlib import Path

from playwright.sync_api import expect

from conftest import BASE_URL, assert_no_errors, login, logout, switch_view

WALKER_FILE = Path(__file__).parent / ".walker.json"


def _fill_report(page, shot, note):
    for toggle in ["Pis", "Caca", "Agua"]:
        page.get_by_role("button", name=toggle, exact=True).click()
        page.wait_for_timeout(250)
    page.locator("textarea").first.fill(note)
    page.get_by_role("button", name="Agregar foto del paseo").click()
    dlg = page.get_by_role("dialog")
    expect(dlg).to_contain_text("Fotos del paseo")
    dlg.locator("img").first.click()
    page.wait_for_timeout(600)
    if page.get_by_role("dialog").count():
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
    shot("report-filled")


def _finish_walk(page, shot, label):
    page.get_by_role("button", name="Finalizar paseo").click()
    confirm = page.get_by_role("alertdialog")
    expect(confirm).to_contain_text("¿Finalizar el paseo?")
    shot(f"{label}-finish-confirm")
    confirm.get_by_role("button", name="Finalizar", exact=True).click()
    page.wait_for_timeout(2_000)
    shot(f"{label}-settlement")
    expect(page.get_by_text("Comisión FiruWalk", exact=False).first).to_be_visible()
    expect(page.get_by_text("Ingreso neto", exact=False).first).to_be_visible()


def test_walker_accepts_and_completes(page, shot, errors):
    walker = json.loads(WALKER_FILE.read_text())["walker"] if WALKER_FILE.exists() else "Luis Quisbert"
    login(page, walker)
    shot("01-walker-home")

    # ---------- pending request with live countdown ----------
    expect(page.get_by_text("Aceptar ✅", exact=False).first).to_be_visible()
    expect(page.get_by_text("Ana", exact=False).first).to_be_visible()
    shot("02-pending-request")

    # accept → the request clears and the walker stays on Home with the
    # in-progress walk card ("Continuar paseo") — the cockpit is entered from there.
    page.get_by_role("button", name="Aceptar ✅").first.click()
    page.wait_for_timeout(2_000)
    expect(page.get_by_role("button", name="Continuar paseo").first).to_be_visible()
    shot("03-accepted-resume-card")
    page.get_by_role("button", name="Continuar paseo").first.click()
    page.wait_for_timeout(2_500)
    expect(page.get_by_text("Recorrido en vivo", exact=False).first).to_be_visible()
    expect(page.locator(".leaflet-container").first).to_be_visible()
    shot("04-live-resume")

    # ---------- finish the walk in progress (report → settle) ----------
    _fill_report(page, shot, "Cerré el paseo con buen ritmo y foto final.")
    _finish_walk(page, shot, "walk")

    # ---------- home again: upcoming days now include the accepted Saturday walk ----------
    switch_view(page, "Inicio")
    page.wait_for_timeout(1_200)
    shot("04-home-after-walk")
    expect(page.get_by_text("Próximos días", exact=False).first).to_be_visible()
    # the section renders grouped day rows with a per-day count chip
    expect(page.get_by_text(re.compile(r"\d+ paseos?"), exact=False).first).to_be_visible()
    shot("05-upcoming-walks")

    # ---------- earnings reflect the completed walk ----------
    switch_view(page, "Ganancias")
    page.wait_for_timeout(1_500)
    expect(page.get_by_text("Retirar dinero", exact=False).first).to_be_visible()
    shot("06-earnings")

    page.get_by_role("button", name="Retirar dinero").first.click()
    dlg = page.get_by_role("dialog")
    expect(dlg).to_contain_text("Retirar dinero")
    expect(dlg).to_contain_text("Mínimo")
    shot("07-withdraw")
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)

    # ---------- agenda: weekly grid with the Saturday reservation ----------
    switch_view(page, "Agenda")
    page.wait_for_timeout(1_000)
    expect(page.get_by_text("Lun", exact=False).first).to_be_visible()
    shot("08-agenda")

    # ---------- profile ----------
    switch_view(page, "Perfil")
    page.wait_for_timeout(1_000)
    expect(page.get_by_text("Reseñas", exact=False).first).to_be_visible()
    shot("09-walker-profile")

    assert_no_errors(errors, "walker golden path")


def test_owner_reviews_completed_booking(page, shot, errors):
    """Marco Tórrez has a seeded COMPLETED booking with no review — close it
    with a 5★ + Bs 2 tip (reviews route + ledger + rating aggregate)."""
    login(page, "Marco Tórrez")
    switch_view(page, "Reservas")
    page.get_by_role("tab", name="Historial").click()
    page.wait_for_timeout(1_200)
    shot("01-historial")

    review_btn = page.get_by_role("button", name="Dejar reseña").first
    expect(review_btn).to_be_visible()
    review_btn.click()
    dlg = page.get_by_role("dialog")
    expect(dlg).to_be_visible()
    shot("02-review-dialog")

    # default rating is already 5★ — add comment + Bs 2 tip
    dlg.locator("textarea").first.fill("Paseo impecable, Toby volvió feliz y cansado 🐾")
    dlg.get_by_text("Bs 2", exact=False).first.click()
    page.wait_for_timeout(300)
    shot("03-review-filled")

    dlg.get_by_role("button", name="Publicar reseña").click()
    page.wait_for_timeout(1_500)
    shot("04-review-posted")
    # review card now shows the rating + comment
    expect(page.get_by_text("Paseo impecable", exact=False).first).to_be_visible()

    assert_no_errors(errors, "owner review")
