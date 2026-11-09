"""Milestone 7 — walker vetting: a pending walker uploads an ID photo (compressed
in the browser, PUT to a signed URL) and saves their CI; the admin sees it in
the review dialog through a signed link, with approval still gated."""
import base64

from playwright.sync_api import expect

from conftest import assert_no_errors, login, logout, switch_view

# 2×2 PNG — decodable by createImageBitmap, so the compression path runs.
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg=="
)


def test_walker_uploads_and_admin_reviews(page, shot, errors):
    # ---------- pending walker: verification card ----------
    login(page, "Alejandra Durán")
    card = page.locator("section[aria-labelledby='vet-title']")
    expect(card).to_contain_text("Verifica tu identidad")
    shot("01-verification-card")

    page.locator("input[data-doc-kind='CI_FRONT']").set_input_files(
        {"name": "ci-frente.png", "mimeType": "image/png", "buffer": PNG}
    )
    expect(page.get_by_text("Documento recibido", exact=False).first).to_be_visible(timeout=15_000)
    expect(card.locator("li").first).to_contain_text("Recibido")

    card.locator("#vet-ci").fill("7654321 SC")
    card.get_by_role("button", name="Guardar").click()
    expect(card).to_contain_text("•••• 4321")
    shot("02-uploaded")

    # The document is not reachable without a signature.
    status = page.evaluate("async () => (await fetch('/api/storage/mock?key=walkers/x')).status")
    assert status == 403
    logout(page)

    # ---------- admin: review dialog with signed links ----------
    login(page, "Equipo FiruWalk")
    switch_view(page, "Solicitudes")
    alejandra = page.locator("div.rounded-2xl", has_text="Alejandra Durán").filter(
        has=page.get_by_role("button", name="Revisar verificación")
    ).first
    expect(alejandra).to_contain_text("•••• 4321")
    alejandra.get_by_role("button", name="Revisar verificación").click()
    dlg = page.get_by_role("dialog")
    expect(dlg).to_contain_text("CI — frente")
    expect(dlg).to_contain_text("•••• 4321")
    img = dlg.locator("img[alt='CI — frente']")
    expect(img).to_be_visible()
    assert "sig=" in (img.get_attribute("src") or "")
    # Still missing documents + checklist → approval disabled.
    expect(dlg.get_by_role("button", name="Aprobar")).to_be_disabled()
    shot("03-admin-review")
    page.keyboard.press("Escape")

    assert_no_errors(errors, "vetting flow")
