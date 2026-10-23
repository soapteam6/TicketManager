"""Synthetic-only regression for native date submission and timezone-consistent display.
Start a fresh `npm run dev:review` fixture before running this script.
"""
import asyncio
import json
from playwright.async_api import async_playwright, expect

URL = 'http://localhost:5173/'

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        context = await browser.new_context(locale='en-US', timezone_id='America/Los_Angeles', viewport={'width':1440,'height':1000})
        page = await context.new_page()
        errors, posts = [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('request', lambda request: posts.append(request.post_data_json) if request.method == 'POST' and request.url.endswith('/api/events') else None)
        await page.goto(URL)
        await expect(page.get_by_role('heading', name='Make every ticket count', exact=True)).to_be_visible()
        await page.get_by_role('button', name='Add dated event', exact=True).click()
        dialog = page.get_by_role('dialog', name='Add a dated event', exact=True)
        await dialog.get_by_label('Event title', exact=True).fill('Date QA native keyboard')
        await dialog.get_by_label('Ticket inventory', exact=True).fill('2')
        field = dialog.get_by_label('Date & time (UTC)', exact=False)
        # Native required validation and the explicit submit guard both prevent empty fallback dates.
        await dialog.get_by_role('button', name='Create private event', exact=True).click()
        assert await field.evaluate('e => e.validity.valueMissing')
        assert not posts
        await dialog.locator('form').evaluate('form => form.noValidate = true')
        await dialog.get_by_role('button', name='Create private event', exact=True).click()
        await expect(dialog.get_by_role('alert')).to_contain_text('complete, valid date and time in UTC')
        assert not posts
        await dialog.locator('form').evaluate('form => form.noValidate = false')
        # Real keyboard events through Chromium's segmented date control.
        await field.focus()
        for _ in range(6):
            await field.press('ArrowLeft')
        for text in ['12', '20', '2026']:
            await field.press_sequentially(text)
        await field.press('ArrowRight')
        for text in ['06', '00', 'p']:
            await field.press_sequentially(text)
        await field.press('Tab')
        await expect(field).to_have_value('2026-12-20T18:00')
        async with page.expect_response(lambda response: response.url.endswith('/api/events') and response.request.method == 'POST') as result:
            await dialog.get_by_role('button', name='Create private event', exact=True).click()
        response = await result.value
        assert response.status == 201
        payload = response.request.post_data_json
        assert payload['date'] == '2026-12-20T18:00:00Z' and payload['tickets'] == 2
        assert (await response.json())['game']['gameDate'] == 1797789600000
        await expect(dialog).not_to_be_visible()
        await expect(page.locator('article').filter(has_text='Date QA native keyboard')).to_contain_text('Dec 20, 2026, 6:00 PM UTC')
        # Reproduce the parent fill mechanism: native DOM value without a React change event.
        await page.get_by_role('button', name='Add dated event', exact=True).click()
        dialog = page.get_by_role('dialog', name='Add a dated event', exact=True)
        await dialog.get_by_label('Event title', exact=True).fill('Date QA native value without change event')
        await dialog.get_by_label('Ticket inventory', exact=True).fill('2')
        await dialog.get_by_label('Date & time (UTC)', exact=False).evaluate('e => e.value = "2026-12-21T18:00"')
        async with page.expect_response(lambda response: response.url.endswith('/api/events') and response.request.method == 'POST') as result:
            await dialog.get_by_role('button', name='Create private event', exact=True).click()
        response = await result.value
        assert response.status == 201 and response.request.post_data_json['date'] == '2026-12-21T18:00:00Z'
        assert (await response.json())['game']['gameDate'] == 1797876000000
        await expect(dialog).not_to_be_visible()
        await page.get_by_role('link', name='Dated events', exact=True).click()
        await expect(page.get_by_role('row').filter(has_text='Date QA native value without change event')).to_contain_text('Dec 21, 2026, 6:00 PM UTC')
        # The legacy event screen uses the same validated native UTC submission.
        await page.get_by_role('button', name='New event', exact=True).click()
        dialog = page.get_by_role('dialog', name='New event', exact=True)
        await dialog.get_by_label('Title', exact=False).fill('Date QA legacy event screen')
        await dialog.get_by_label('Number of tickets', exact=False).fill('2')
        await dialog.get_by_label('Date & time (UTC)', exact=False).evaluate('e => e.value = "2026-12-22T03:00"')
        async with page.expect_response(lambda response: response.url.endswith('/api/events') and response.request.method == 'POST') as result:
            await dialog.get_by_role('button', name='Create event', exact=True).click()
        response = await result.value
        assert response.status == 201 and response.request.post_data_json['date'] == '2026-12-22T03:00:00Z'
        await expect(dialog).not_to_be_visible()
        await expect(page.get_by_role('row').filter(has_text='Date QA legacy event screen')).to_contain_text('Dec 22, 2026, 3:00 AM UTC')
        # The other manual game forms preserve their explicit UTC/date-only contracts.
        await page.get_by_role('link', name='Sports setup', exact=True).click()
        await page.get_by_role('button', name='Synthetic Comets', exact=True).click()
        team = page.get_by_role('dialog', name='Synthetic Comets', exact=True)
        await team.get_by_role('button', name='Add game', exact=True).click()
        game = page.get_by_role('dialog', name='Add game', exact=True)
        await game.get_by_label('Date & start time (UTC)', exact=False).evaluate('e => e.value = "2026-12-23T03:00"')
        await game.get_by_label('Opponent', exact=False).fill('Date QA synthetic team opponent')
        async with page.expect_response(lambda response: '/api/teams/' in response.url and response.url.endswith('/games') and response.request.method == 'POST') as result:
            await game.get_by_role('button', name='Add game', exact=True).click()
        response = await result.value
        assert response.status == 201 and response.request.post_data_json['gameDate'] == '2026-12-23T03:00:00Z'
        await expect(game).not_to_be_visible()
        await team.get_by_role('link', name='2026–27 Demo', exact=True).click()
        await page.get_by_role('button', name='Add game', exact=True).click()
        game = page.get_by_role('dialog', name='Add game', exact=True)
        await game.get_by_label('Game date (UTC, midnight)', exact=False).evaluate('e => e.value = "2026-12-24"')
        await game.get_by_label('Opponent', exact=False).fill('Date QA legacy season opponent')
        async with page.expect_response(lambda response: response.url.endswith('/api/games') and response.request.method == 'POST') as result:
            await game.get_by_role('button', name='Add game', exact=True).click()
        response = await result.value
        assert response.status == 201 and response.request.post_data_json['gameDate'] == '2026-12-24'
        assert (await response.json())['game']['gameDate'] == 1798070400000
        await expect(game).not_to_be_visible()
        await page.get_by_role('link', name='Coordinator workspace', exact=True).click()
        await page.locator('article').filter(has_text='Synthetic Winter Performance').get_by_role('checkbox').check()
        await page.get_by_role('combobox', name='Visibility action', exact=True).select_option('schedule')
        await page.get_by_label('Release at (UTC)', exact=True).evaluate('e => e.value = "2026-11-01T12:00"')
        async with page.expect_response(lambda response: response.url.endswith('/api/review/releases') and response.request.method == 'POST') as result:
            await page.get_by_role('button', name='Save release settings', exact=True).click()
        response = await result.value
        assert response.status == 200 and response.request.post_data_json['releaseAt'] == '2026-11-01T12:00:00Z'
        await context.close()
        # Calendar day and zone labels must remain identical across browser timezones.
        for zone in ['America/Los_Angeles', 'Asia/Tokyo']:
            context = await browser.new_context(locale='en-US', timezone_id=zone)
            page = await context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            await page.goto(URL)
            await expect(page.locator('article').filter(has_text='Synthetic Winter Performance')).to_contain_text('Dec 15, 2026, 2:00 AM UTC')
            await page.get_by_role('link', name='Dated events', exact=True).click()
            await expect(page.get_by_role('row').filter(has_text='Synthetic Winter Performance')).to_contain_text('Dec 15, 2026, 2:00 AM UTC')
            await page.get_by_role('link', name='Contacts & history', exact=True).click()
            await page.get_by_label('Search contacts', exact=True).fill('customer0@example.invalid')
            await page.get_by_role('button', name='History', exact=True).click()
            history = page.get_by_role('dialog', name='Alex Sample', exact=True)
            await expect(history).to_contain_text('Mar 1, 2026, 2:00 AM UTC')
            await expect(history).to_contain_text('Oct 1, 2026, 2:00 AM UTC')
            assert 'Feb 28' not in await history.inner_text()
            await context.close()
        assert not errors, errors
        print(json.dumps({'status':'PASS', 'checks':['native required and submit guards','normal keyboard date entry','DOM-only date fill','legacy event submission','manual team/season game dates','scheduled release native value','exact stored instants','catalog/events/history UTC consistency in Pacific and Tokyo'], 'pageErrors':errors}))
        await browser.close()

asyncio.run(main())
