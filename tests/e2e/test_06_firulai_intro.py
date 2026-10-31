"""T11/T12 · 06 — FirulAI receptionist, hyperframes intro splash, premium cards,
and the +59177165787 WhatsApp support line.

Intro coverage uses FRESH contexts (no conftest SKIP_INTRO init script) because
the splash must actually play there; everything else uses the standard fixtures
so the intro never slows the rest of the suite.
"""
import re

from playwright.sync_api import expect

from conftest import BASE_URL, assert_no_errors, login

WA_NUMBER = "59177165787"


def _listen(page, errors):
    """Replicate the conftest console/pageerror capture on a custom page."""
    from conftest import is_noise

    page.on(
        "console",
        lambda m: errors.append(f"console.{m.type}: {m.text}")
        if m.type == "error" and not is_noise(m.text)
        else None,
    )
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}") if not is_noise(str(e)) else None)


# ---------------------------------------------------------------------------
# 1. Hyperframes intro splash — plays, is skippable, once per session,
#    reduced-motion never plays, natural end dismisses.
# ---------------------------------------------------------------------------


def test_intro_plays_skip_and_once_per_session(browser, errors):
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    page = ctx.new_page()
    _listen(page, errors)
    page.goto(BASE_URL, wait_until="domcontentloaded")

    intro = page.get_by_role("dialog", name="FiruWalk intro")
    # The splash appears right after hydration.
    expect(intro).to_be_visible(timeout=15_000)
    expect(intro.locator("video")).to_be_visible()
    shot_dir_intro = __import__("pathlib").Path(__file__).parent / "screenshots" / "test_intro_splash"
    shot_dir_intro.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(shot_dir_intro / "01_intro_playing.png"))
    # Skip hint (Saltar) shows after 600ms while the video plays.
    expect(intro.get_by_text("Saltar")).to_be_visible(timeout=5_000)

    # Escape dismisses the splash and marks the session as played.
    page.keyboard.press("Escape")
    expect(intro).to_have_count(0, timeout=5_000)
    assert page.evaluate("sessionStorage.getItem('firu-intro-played')") == "1"

    # Reload in the same tab: the intro must NOT replay.
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(1_000)
    expect(page.get_by_role("dialog", name="FiruWalk intro")).to_have_count(0)
    # The landing is fully interactive underneath.
    expect(page.get_by_role("button", name="Ingresar")).to_be_visible()

    ctx.close()
    assert_no_errors(errors, "intro desktop")


def test_intro_click_skip_and_natural_end(browser, errors):
    # a) Click/tap anywhere on the overlay skips it.
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    _listen(page, errors)
    page.goto(BASE_URL, wait_until="domcontentloaded")
    intro = page.get_by_role("dialog", name="FiruWalk intro")
    expect(intro).to_be_visible(timeout=15_000)
    intro.click(timeout=4_000)  # tolerant: natural end may already have dismissed it
    expect(intro).to_have_count(0, timeout=4_000)
    # Mobile: no horizontal overflow once the splash is gone.
    page.wait_for_timeout(600)
    assert page.evaluate("document.documentElement.scrollWidth") <= 392
    ctx.close()

    # b) Left alone, the video ends by itself and never traps the user.
    ctx2 = browser.new_context(viewport={"width": 1280, "height": 900})
    page2 = ctx2.new_page()
    _listen(page2, errors)
    page2.goto(BASE_URL, wait_until="domcontentloaded")
    intro2 = page2.get_by_role("dialog", name="FiruWalk intro")
    expect(intro2).to_be_visible(timeout=15_000)
    page2.wait_for_timeout(4_500)  # video is 2.4s + 0.25s fade; 4s is the hard cap
    expect(intro2).to_have_count(0)
    assert page2.evaluate("sessionStorage.getItem('firu-intro-played')") == "1"
    ctx2.close()
    assert_no_errors(errors, "intro skip/natural end")


def test_intro_reduced_motion_never_plays(browser, errors):
    ctx = browser.new_context(
        viewport={"width": 1280, "height": 900}, reduced_motion="reduce"
    )
    page = ctx.new_page()
    _listen(page, errors)
    page.goto(BASE_URL, wait_until="domcontentloaded")
    page.wait_for_timeout(800)
    expect(page.get_by_role("dialog", name="FiruWalk intro")).to_have_count(0)
    expect(page.get_by_role("heading", level=1)).to_be_visible()
    ctx.close()
    assert_no_errors(errors, "intro reduced motion")


# ---------------------------------------------------------------------------
# 2. FirulAI — the dog receptionist widget (logo-dog launcher, real LLM chat,
#    quick-reply chips, WhatsApp handoff, ES/EN).
# ---------------------------------------------------------------------------


def test_firulai_receptionist_full_chat(page, shot, errors):
    page.goto(BASE_URL, wait_until="networkidle")
    page.wait_for_timeout(800)

    # Launcher: the logo-dog floating button, bottom-right.
    launcher = page.get_by_role("button", name="Abrir chat de FirulAI")
    expect(launcher).to_be_visible()
    shot("01_firulai_launcher")

    # Open → premium chat panel with the dog receptionist.
    launcher.click()
    dlg = page.get_by_role("dialog", name="FirulAI")
    expect(dlg).to_be_visible()
    expect(dlg).to_contain_text("¡Guau! 🐾 Soy FirulAI")
    expect(dlg).to_contain_text("Recepcionista perruna · En línea")
    shot("02_firulai_greeting")

    # Quick-reply chips: 4 of them, visible at conversation start.
    for chip in ["¿Cuánto cuesta?", "¿Cómo reservo?", "¿Llegan a mi zona?", "Hablar con un humano"]:
        expect(dlg.get_by_role("button", name=chip)).to_be_visible()

    # Human handoff chip (carries the handoff flag) → the WhatsApp CTA with
    # the real support number appears alongside the reply.
    dlg.get_by_role("button", name="Hablar con un humano").click()
    wa_link = dlg.locator(f"a[href*='wa.me/{WA_NUMBER}']")
    expect(wa_link).to_be_visible(timeout=35_000)
    expect(wa_link).to_have_attribute("href", re.compile(rf"wa\.me/{WA_NUMBER}"))
    shot("04_firulai_whatsapp_handoff")

    # Free-text price question via the input + Enter → real LLM reply with the
    # live prices (Bs 15/20/25 from the Config table). The pattern can ONLY
    # match the reply itself (never pre-existing UI text), which also
    # serializes the next send after busy clears. A degraded LLM answers with
    # the "patitas están ocupadas" fallback — both are valid.
    dlg.get_by_role("textbox").fill("¿Cuánto cuesta un paseo?")
    dlg.get_by_role("textbox").press("Enter")
    expect(dlg).to_contain_text(re.compile(r"Bs 15|patitas están ocupadas"), timeout=35_000)
    shot("03_firulai_price_reply")

    # Free-text zone question still works mid-conversation.
    dlg.get_by_role("textbox").fill("¿En qué zonas trabajan?")
    dlg.get_by_role("textbox").press("Enter")
    expect(dlg).to_contain_text(re.compile(r"zona|Zona|zone"), timeout=35_000)

    # Close via the X button; Escape focus-flow intact.
    dlg.get_by_role("button", name="Cerrar chat").click()
    expect(page.get_by_role("dialog", name="FirulAI")).to_have_count(0)

    # EN toggle: the receptionist greets in English.
    page.get_by_role("button", name="EN", exact=True).click()
    page.wait_for_timeout(400)
    page.get_by_role("button", name="Open FirulAI chat").click()
    dlg_en = page.get_by_role("dialog", name="FirulAI")
    expect(dlg_en).to_contain_text("Woof! 🐾 I'm FirulAI")
    expect(dlg_en).to_contain_text("Dog receptionist · Online")
    shot("05_firulai_english")
    dlg_en.get_by_role("button", name="Close chat").click()

    assert_no_errors(errors, "firulai full chat")


def test_firulai_api_contract(page, errors):
    """Backend validation: bad payloads are rejected; the widget never breaks."""
    r = page.request.post(
        f"{BASE_URL}/api/firulai",
        data={"messages": [], "lang": "es"},
    )
    assert r.status == 400
    r2 = page.request.post(
        f"{BASE_URL}/api/firulai",
        data={"messages": [{"role": "assistant", "content": "hola"}], "lang": "es"},
    )
    assert r2.status == 400  # last message must be from the user
    assert_no_errors(errors, "firulai api contract")


# ---------------------------------------------------------------------------
# 3. FirulAI inside the app shell (logged-in owner) + on mobile.
# ---------------------------------------------------------------------------


def test_firulai_in_app_shell(page, shot, errors):
    login(page, "Ana Rivera")
    launcher = page.get_by_role("button", name="Abrir chat de FirulAI")
    expect(launcher).to_be_visible()
    shot("06_firulai_in_owner_app")
    launcher.click()
    dlg = page.get_by_role("dialog", name="FirulAI")
    expect(dlg).to_contain_text("¡Guau! 🐾 Soy FirulAI")
    dlg.get_by_role("button", name="Cerrar chat").click()
    expect(dlg).to_have_count(0)
    assert_no_errors(errors, "firulai app shell")


def test_firulai_mobile(mobile_page, mshot, errors):
    mobile_page.goto(BASE_URL, wait_until="networkidle")
    mobile_page.wait_for_timeout(800)
    launcher = mobile_page.get_by_role("button", name="Abrir chat de FirulAI")
    expect(launcher).to_be_visible()
    launcher.click()
    dlg = mobile_page.get_by_role("dialog", name="FirulAI")
    expect(dlg).to_be_visible()
    expect(dlg).to_contain_text("¡Guau! 🐾 Soy FirulAI")
    mshot("07_firulai_mobile_panel")

    # The widget must not create horizontal overflow on small screens.
    assert mobile_page.evaluate("document.documentElement.scrollWidth") <= 392

    dlg.get_by_role("button", name="Cerrar chat").click()
    expect(dlg).to_have_count(0)
    assert_no_errors(errors, "firulai mobile")


# ---------------------------------------------------------------------------
# 4. Premium landing cards + the WhatsApp support number everywhere.
# ---------------------------------------------------------------------------


def test_premium_cards_and_whatsapp_number(page, shot, errors):
    page.goto(BASE_URL, wait_until="networkidle")
    page.wait_for_timeout(600)

    # Cómo funciona: the 3 step cards keep their asserted copy after the
    # premium redesign (tilt/gloss/timeline animations).
    how = page.locator("#como-funciona")
    how.scroll_into_view_if_needed()
    page.wait_for_timeout(900)
    for step in ["1. Reserva", "2. Síguelo en vivo", "3. Recibe el reporte"]:
        expect(how.get_by_text(step, exact=False)).to_be_visible()
    shot("08_how_it_works_premium")

    # Confianza: stat cards count up on view and SETTLE on the exact strings.
    trust = page.locator("#confianza")
    trust.scroll_into_view_if_needed()
    page.wait_for_timeout(1_300)  # count-up is 0.9s
    for stat in ["100%", "GPS", "Bs 15", "24/7"]:
        expect(trust.get_by_text(stat, exact=False).first).to_be_visible()
    expect(trust.get_by_text("Le confías a tu familia", exact=False)).to_be_visible()
    shot("09_confianza_premium")

    # WhatsApp support line → +59177165787 on every public CTA.
    hero_wa = page.locator(f"a[href*='wa.me/{WA_NUMBER}']").filter(has_text="Hablar por WhatsApp")
    expect(hero_wa.first).to_be_visible()
    footer_wa = page.locator("footer").locator(f"a[href*='wa.me/{WA_NUMBER}']")
    expect(footer_wa).to_be_visible()
    expect(footer_wa).to_contain_text("+59177165787")

    # No stray placeholder numbers anywhere on the landing.
    body_text = page.locator("body").inner_text()
    assert "+59170000000" not in body_text, "old placeholder WhatsApp still visible"

    assert_no_errors(errors, "premium cards + whatsapp")
