from playwright.sync_api import sync_playwright

errors = []
warnings = []

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()

    # Capture console errors
    def on_console(msg):
        if msg.type == 'error':
            errors.append(msg.text)
        elif msg.type == 'warning':
            warnings.append(msg.text)

    page.on('console', on_console)

    print("1. Navigating to web UI...")
    page.goto('http://127.0.0.1:4567', timeout=10000)
    page.wait_for_load_state('networkidle', timeout=15000)

    print("2. Checking page title / header...")
    title = page.title()
    print(f"   Title: {title}")

    # Check header is visible
    header = page.locator('.logo')
    if header.count() > 0:
        print(f"   Logo text: {header.inner_text()}")
    else:
        print("   [WARN] .logo not found, checking h1...")
        h1 = page.locator('h1, .header-title')
        if h1.count() > 0:
            print(f"   Header: {h1.inner_text()}")

    print("3. Waiting for Cytoscape canvas to render...")
    page.wait_for_timeout(3000)  # Allow Cytoscape to render

    canvas = page.locator('canvas')
    print(f"   Canvas elements found: {canvas.count()}")

    print("4. Checking for node/edge counts in sidebar...")
    stats = page.locator('.stat-value, .stat-count')
    if stats.count() > 0:
        for s in stats.all():
            t = s.inner_text()
            if t.strip():
                print(f"   {t.strip()}")
    else:
        print("   [INFO] No stat elements found, checking sidebar...")
        sidebar = page.locator('.sidebar-left, .search-panel')
        if sidebar.count() > 0:
            print("   Sidebar visible: YES")

    print("5. Testing search functionality...")
    search_input = page.locator('input[type="text"], input[placeholder*="搜索"], input[placeholder*="search"]')
    if search_input.count() > 0:
        search_input.first.fill('Springgraph')
        page.wait_for_timeout(500)
        print("   Search input works: YES")
        # Clear
        search_input.first.fill('')
    else:
        print("   [WARN] Search input not found")

    print("6. Checking console errors...")
    if errors:
        print(f"   ERRORS ({len(errors)}):")
        for e in errors:
            print(f"     - {e}")
    else:
        print("   No console errors!")

    if warnings:
        print(f"   WARNINGS ({len(warnings)}):")
        for w in warnings[:3]:
            print(f"     - {w}")

    page.screenshot(path='D:/code/springgraph-springcloud/web-qa-screenshot.png', full_page=True)
    print("\n7. Screenshot saved to web-qa-screenshot.png")

    browser.close()

print("\n=== QA SUMMARY ===")
print(f"Console errors: {len(errors)}")
print(f"Console warnings: {len(warnings)}")
if errors:
    exit(1)
else:
    print("PASS")
