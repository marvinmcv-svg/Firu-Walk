"""T8-f · 01 — Landing page: everything a visitor sees, desktop + mobile + dark."""
from playwright.sync_api import expect

from conftest import BASE_URL, assert_no_errors


def test_landing_desktop_everything(page, shot, errors):
    page.goto(BASE_URL, wait_until="networkidle")
    page.wait_for_timeout(1_500)

    # --- header: logo + nav anchors + CTAs
    expect(page.locator("header img[alt='FiruWalk']").filter(visible=True).first).to_be_visible()
    for link in ["Cómo funciona", "Confianza", "Zonas", "Preguntas"]:
        expect(page.locator("header").get_by_role("link", name=link)).to_be_visible()
    expect(page.get_by_role("button", name="Soy paseador")).to_be_visible()
    expect(page.get_by_role("button", name="Ingresar")).to_be_visible()
    shot("header-hero")

    # --- hero
    hero = page.locator("section").first
    expect(page.get_by_role("heading", level=1)).to_contain_text("Vuelve feliz y cansado.")
    expect(page.get_by_role("heading", level=1)).to_contain_text("Tú lo ves todo en vivo.")
    expect(page.get_by_text("Empresa familiar · Santa Cruz", exact=False)).to_be_visible()
    expect(page.get_by_role("button", name="Armar su primer paseo").first).to_be_visible()
    expect(page.get_by_role("button", name="Ver cómo funciona")).to_be_visible()
    # walker recruitment lives in its own band, out of the owner path
    expect(page.get_by_role("button", name="Quiero pasear y ganar")).to_be_attached()
    for badge in ["Paseadores verificados", "4,8", "QR Simple"]:
        expect(page.get_by_text(badge, exact=False).first).to_be_visible()
    expect(page.locator("img[alt*='paseo con FiruWalk']")).to_be_visible()
    expect(page.locator("img[alt*='corazón']")).to_be_visible()
    expect(page.get_by_text("Paseo en curso", exact=False).first).to_be_visible()

    # --- sections exist
    expect(page.locator("#como-funciona")).to_be_visible()
    expect(page.locator("#manada")).to_be_visible()
    expect(page.locator("#confianza")).to_be_visible()
    expect(page.locator("#zonas")).to_be_visible()
    for sid in ["#por-que", "#reporte", "#reservar", "#preguntas"]:
        expect(page.locator(sid)).to_be_attached()
    shot("sections", full=True)

    # --- cómo funciona: 3 steps
    for step in ["1. Reserva", "2. Síguelo en vivo", "3. Recibe el reporte"]:
        expect(page.locator("#como-funciona").get_by_text(step, exact=False)).to_be_visible()

    # --- la manada: 3 polaroids + CTA tile
    expect(page.locator("#manada img[alt*='fila']")).to_be_visible()
    expect(page.locator("#manada img[alt*='juegos']")).to_be_visible()
    expect(page.locator("#manada img[alt*='tronco']")).to_be_visible()  # leashes photo (unique)
    expect(page.get_by_text("¿Tu peludo falta en esta foto?")).to_be_visible()

    # --- confianza: stat cards + guarantee list
    for stat in ["100%", "GPS", "Bs 15", "24/7"]:
        expect(page.locator("#confianza").get_by_text(stat, exact=False).first).to_be_visible()

    # --- anchor scroll works
    page.locator("header").get_by_role("link", name="Confianza").click()
    page.wait_for_timeout(900)
    assert page.evaluate("window.scrollY") > 100, "anchor link did not scroll"

    # --- sales funnel: form → live WhatsApp preview → wa.me deep link
    page.get_by_role("button", name="Armar su primer paseo").first.click()
    page.wait_for_timeout(900)
    funnel = page.locator("#reservar")
    wa_cta = funnel.get_by_role("link", name="Continuar en WhatsApp")
    expect(wa_cta).to_be_visible()
    wa_cta.click()  # empty form → nudge instead of leaving the page
    expect(funnel.get_by_role("alert")).to_contain_text("tu perro")
    funnel.locator("#fn-name").fill("Carla")
    funnel.locator("#fn-dog").fill("Rocky")
    expect(funnel.get_by_role("heading", level=2)).to_contain_text("Rocky")
    funnel.get_by_role("radio", name="Mediano").click()
    funnel.get_by_role("radio", name="3 veces / semana").click()
    expect(funnel.get_by_text("Rocky (Mediano)")).to_be_visible()
    href = wa_cta.get_attribute("href") or ""
    assert href.startswith("https://wa.me/59177165787?text="), href
    assert "Rocky" in href and "Carla" in href, href
    expect(funnel.get_by_text("al mes", exact=False)).to_be_visible()
    shot("funnel")

    # --- faq: first answer open, prices from config
    expect(page.locator("#preguntas").get_by_text("Bs 15", exact=False).first).to_be_visible()

    # --- zonas chips
    chips = page.locator("#zonas .rounded-full")
    expect(chips.first).to_be_visible()
    assert chips.count() >= 5, f"expected >=5 zone chips, got {chips.count()}"

    # --- footer
    expect(page.locator("footer img[alt='FiruWalk']").filter(visible=True).first).to_be_visible()
    expect(page.locator("footer").get_by_text("Empresa familiar", exact=False)).to_be_visible()
    expect(page.locator("footer a[href*='wa.me']")).to_be_visible()
    shot("footer")

    # --- PWA installability
    manifest = page.locator("link[rel='manifest']")
    expect(manifest).to_have_attribute("href", "/manifest.webmanifest")
    expect(page.locator("link[rel='apple-touch-icon']")).to_have_attribute(
        "href", "/images/brand/apple-touch-icon.png"
    )
    resp = page.request.get(f"{BASE_URL}/manifest.webmanifest")
    assert resp.status == 200 and "FiruWalk" in resp.json()["name"]
    icons = resp.json()["icons"]
    assert any(i["sizes"] == "512x512" for i in icons)

    # --- login dialog opens, lists demo accounts, closes
    page.get_by_role("button", name="Ingresar").click()
    dlg = page.get_by_role("dialog")
    expect(dlg).to_contain_text("Entra a FiruWalk")
    expect(dlg).to_contain_text("Ana Rivera")
    expect(dlg).to_contain_text("Luis Quisbert")
    expect(dlg).to_contain_text("Equipo FiruWalk")
    expect(dlg).to_contain_text("123456")
    shot("login-dialog")
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)
    expect(page.get_by_role("dialog")).to_have_count(0)

    # --- apply (soy paseador) dialog: form fields render
    page.get_by_role("button", name="Soy paseador").click()
    dlg = page.get_by_role("dialog")
    expect(dlg).to_contain_text("paseador")
    inputs = dlg.locator("input, textarea")
    assert inputs.count() >= 4, f"apply form has {inputs.count()} fields"
    shot("apply-dialog")
    page.keyboard.press("Escape")

    # --- dark mode via persisted theme (landing header shows dark logo)
    page.evaluate("localStorage.setItem('theme','dark')")
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(800)
    assert "dark" in (page.locator("html").get_attribute("class") or "")
    expect(page.locator("header img[alt='FiruWalk']").filter(visible=True).first).to_be_visible()
    shot("landing-dark")
    page.evaluate("localStorage.setItem('theme','light')")
    page.reload(wait_until="networkidle")

    assert_no_errors(errors, "landing desktop")


def test_landing_mobile_no_overflow(mobile_page, mshot, errors):
    mobile_page.goto(BASE_URL, wait_until="networkidle")
    mobile_page.wait_for_timeout(1_200)

    # No horizontal scroll anywhere
    sw = mobile_page.evaluate("document.documentElement.scrollWidth")
    assert sw <= 392, f"horizontal overflow: scrollWidth={sw}"

    # Manada gallery is 2-col on mobile
    gallery_cols = mobile_page.evaluate(
        "getComputedStyle(document.querySelector('#manada > div > div.mt-8, #manada div[class*=grid-cols-2]')).gridTemplateColumns.split(' ').length"
    )
    assert gallery_cols <= 2, f"mobile gallery columns: {gallery_cols}"

    mshot("landing-mobile-top")
    mobile_page.screenshot(
        path=str(mshot.dir / "landing-mobile-full.png"), full_page=True
    )

    # Hero CTA takes the visitor straight to the funnel
    mobile_page.get_by_role("button", name="Armar su primer paseo").first.click()
    mobile_page.wait_for_timeout(1_200)
    expect(mobile_page.locator("#fn-name")).to_be_in_viewport()

    # Sign-in opens on touch too
    mobile_page.evaluate("window.scrollTo({top: 0, behavior: 'instant'})")
    mobile_page.get_by_role("button", name="Ingresar").click()
    expect(mobile_page.get_by_role("dialog")).to_contain_text("Entra a FiruWalk")
    mshot("login-mobile")
    mobile_page.keyboard.press("Escape")

    # Footer flush with the bottom of the viewport when scrolled to end
    mobile_page.evaluate("window.scrollTo({top: document.body.scrollHeight, behavior: 'instant'})")
    mobile_page.wait_for_timeout(500)
    footer_bottom = mobile_page.evaluate(
        "document.querySelector('footer').getBoundingClientRect().bottom"
    )
    assert 843 <= footer_bottom <= 845, f"footer not flush: {footer_bottom}"

    assert_no_errors(errors, "landing mobile")
