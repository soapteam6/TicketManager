// Dependency-free browser checks against the isolated synthetic review server.
// Start Chrome with --remote-debugging-port=9224 and npm run dev:review first.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.REVIEW_URL || 'http://127.0.0.1:5173';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const artifacts = 'design-artifacts.local';
await mkdir(artifacts, { recursive: true });

class CDP {
  id = 0;
  pending = new Map();
  events = new Map();
  constructor(socket) {
    this.socket = socket;
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const promise = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) promise?.reject(new Error(JSON.stringify(message.error)));
        else promise?.resolve(message.result);
      } else for (const listener of this.events.get(message.method) || []) listener(message.params);
    });
  }
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    return new CDP(socket);
  }
  call(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, listener) { this.events.set(method, [...(this.events.get(method) || []), listener]); }
  async evaluate(expression) {
    const result = await this.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + result.exceptionDetails.exception?.description);
    return result.result.value;
  }
  async wait(expression) {
    for (let attempt = 0; attempt < 160; attempt++) {
      if (await this.evaluate(`Boolean(${expression})`)) return;
      await new Promise(resolve => setTimeout(resolve, 75));
    }
    throw new Error('Timed out: ' + expression);
  }
  close() { this.socket.close(); }
}

const version = await (await fetch('http://127.0.0.1:9224/json/version')).json();
const browser = await CDP.connect(version.webSocketDebuggerUrl);
const results = [];
try {
  const oldTargets = await browser.call('Target.getTargets');
  for (const target of oldTargets.targetInfos.filter(t => t.url.startsWith(base))) await browser.call('Target.closeTarget', { targetId: target.targetId });
  for (const design of ['desk']) {
    const { targetId } = await browser.call('Target.createTarget', { url: 'about:blank' });
    const targets = await (await fetch('http://127.0.0.1:9224/json/list')).json();
    const page = await CDP.connect(targets.find(t => t.id === targetId).webSocketDebuggerUrl);
    const errors = [], external = [];
    page.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails.exception?.description || event.exceptionDetails.text));
    page.on('Network.requestWillBeSent', event => {
      const url = new URL(event.request.url);
      if (['http:', 'https:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname)) external.push(url.href);
    });
    await page.call('Page.enable');
    await page.call('Runtime.enable');
    await page.call('Network.enable');
    await page.call('Network.setBlockedURLs', { urls: ['https://*'] });
    await page.call('Emulation.setTimezoneOverride', { timezoneId: 'America/Los_Angeles' });
    await page.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
    await page.call('Page.navigate', { url: `${base}/` });
    await page.wait(`document.querySelector('.work-shell--${design}') && document.querySelector('table, .work-queue-list')`);
    assert(await page.evaluate(`!document.querySelector('.work-feedback, .work-table-footer, .work-app-footer')`));
    assert(await page.evaluate(`!document.querySelector('[aria-label="Selected request"]') && !document.querySelector('tbody tr[aria-selected="true"]')`));
    assert(await page.evaluate(`!document.querySelector('.design-switcher') && !document.body.innerText.includes('Compare layouts')`));
    const click = async (label, root = 'document') => page.evaluate(`(() => {
      const button = [...${root}.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)});
      if (!button) throw new Error('Missing button: '+${JSON.stringify(label)});
      button.click();
    })()`);
    const nav = async label => page.evaluate(`(() => {
      const button = [...document.querySelectorAll('nav[aria-label="Workspace navigation"] button')].find(b => b.querySelector('span').textContent === ${JSON.stringify(label)});
      if (!button) throw new Error('Missing navigation: '+${JSON.stringify(label)});
      button.click();
    })()`);
    const set = async (selector, value) => page.evaluate(`(() => {
      const control = document.querySelector(${JSON.stringify(selector)});
      if (!control) throw new Error('Missing input: '+${JSON.stringify(selector)});
      const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(control, ${JSON.stringify(value)});
      control.dispatchEvent(new Event('input',{bubbles:true})); control.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    const screenshot = async suffix => {
      await page.evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
      const image = await page.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      await writeFile(`${artifacts}/${design}-${suffix}.png`, Buffer.from(image.data, 'base64'));
    };
    if (design === 'operations') await page.evaluate(`document.querySelector('.work-table tbody tr').cells[2].click()`);
    await screenshot('desktop');
    await nav('Event inventory');
    await page.wait(`document.querySelector('[aria-label="Inventory period"]')`);
    await set('input[placeholder="Search events or seasons"]', 'Winter');
    await page.wait(`document.querySelectorAll('.work-table tbody tr').length===1`);
    await set('input[placeholder="Search events or seasons"]', '');
    await click('+ New event');
    await page.wait(`document.querySelector('[role="dialog"] input[name="title"]')`);
    await set('[role="dialog"] input[name="title"]', `QA layout ${design}`);
    await set('[role="dialog"] input[name="date"]', '2026-12-20T18:00');
    await set('[role="dialog"] input[name="tickets"]', '2');
    await click('Create private inventory');
    await page.wait(`!document.querySelector('[role="dialog"]')`);
    await click(`QA layout ${design}`);
    await click('Record interest');
    await page.wait(`document.querySelector('[role="dialog"] select[name="onBehalfOf"]')`);
    await page.evaluate(`(() => { const select=[...document.querySelectorAll('[role="dialog"] select')].find(s=>[...s.options].some(o=>o.value==='Juniper Example Labs')); select.value='Juniper Example Labs';select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    await page.wait(`document.querySelector('[role="dialog"] input[name="contacts"]')`);
    await page.evaluate(`document.querySelector('[role="dialog"] input[name="contacts"]').click()`);
    await set('[role="dialog"] input[name="quantity"]', '2');
    await set('[role="dialog"] textarea[name="rationale"]', 'QA layout interaction test.');
    await click('Record interest', 'document.querySelector(\'[role="dialog"]\')');
    await page.wait(`!document.querySelector('[role="dialog"]')`);
    await nav('Request queue');
    await set('input[placeholder="Search people, email or events"]', `QA layout ${design}`);
    await page.evaluate(`document.querySelector('.work-request-table tbody tr').cells[1].click()`);
    await page.wait(`document.querySelector('.work-request-detail')?.textContent.includes('QA layout ${design}')`);
    await page.evaluate(`document.querySelector('[aria-label="Close request details"]').click()`);
    await page.wait(`!document.querySelector('.work-request-detail') && !document.querySelector('tbody tr[aria-selected="true"]')`);
    await page.evaluate(`document.querySelector('.work-request-table tbody tr').cells[1].click()`);
    assert(await page.evaluate(`document.querySelector('.work-request-detail').textContent.includes('coordinator@example.invalid')`));
    await set('.work-decision textarea[name="reason"]', 'QA browser allocation decision');
    await click('Allocate tickets');
    await page.wait(`document.querySelector('.work-empty')`);
    await set('select[aria-label="Request status"]', 'all');
    await page.evaluate(`document.querySelector('.work-request-table tbody tr').cells[1].click()`);
    await page.wait(`document.querySelector('.work-completed')?.textContent.includes('fulfilled')`);
    await nav('Allocations');
    await page.wait(`document.querySelector('.work-allocation-split tbody tr')`);
    assert(await page.evaluate(`!document.querySelector('[aria-label="Allocation details"]') && !document.querySelector('tbody tr[aria-selected="true"]')`));
    await set('input[placeholder="Search recipient, email or event"]', `QA layout ${design}`);
    await page.evaluate(`document.querySelector('.work-allocation-split tbody tr').cells[1].click()`);
    await page.wait(`document.querySelector('[name="outcome"]')`);
    await page.evaluate(`document.querySelector('[aria-label="Close allocation details"]').click()`);
    await page.wait(`!document.querySelector('[aria-label="Allocation details"]') && !document.querySelector('tbody tr[aria-selected="true"]')`);
    await page.evaluate(`(() => {const row=document.querySelectorAll('.work-allocation-split tbody tr')[1];row.focus();row.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
    await page.wait(`document.querySelectorAll('.work-allocation-split tbody tr')[1].getAttribute('aria-selected')==='true'`);
    assert(await page.evaluate(`(() => {const table=document.querySelector('.work-allocation-split>.work-table-scroll').getBoundingClientRect();const detail=document.querySelector('[aria-label="Allocation details"]').getBoundingClientRect();return detail.left>=table.right-1 && Math.abs(detail.top-table.top)<2;})()`), `${design}: allocation details are not on the right`);
    await set('select[name="outcome"]', 'attended');
    await click('Save attendance');
    await page.wait(`document.querySelector('aside[role="alert"]')?.textContent.includes('after the event')`);
    await screenshot('validation');
    await page.evaluate(`document.querySelector('[aria-label="Dismiss save error"]').click()`);
    await nav('Contact register');
    await set('input[placeholder="Search name, email, business or phone"]', 'alex@example.invalid');
    await page.wait(`document.querySelectorAll('.work-table tbody tr').length===1`);
    await page.evaluate(`document.querySelector('.work-table tbody tr').cells[1].click()`);
    await page.wait(`document.querySelector('[aria-label="Contact history"]')?.textContent.includes('QA layout ${design}')`);
    await page.evaluate(`document.querySelector('[aria-label="Close contact details"]').click()`);
    if (design === 'desk') {
      await nav('Setup & import');
      await page.wait(`document.querySelector('[aria-label="Setup sections"]')`);
      await page.evaluate(`document.querySelector('button[aria-label="AI Import"]').click()`);
      await page.wait(`document.querySelector('.work-schedule-finder.is-prompt textarea')`);
      assert(await page.evaluate(`!document.querySelector('select[name="searchSeason"]') && !document.querySelector('input[name="searchTickets"]')`), 'AI Import requires setup before the request');
      await screenshot('ai-import-prompt');
      await set('textarea[name="scheduleQuery"]', 'I got tickets for next season. Find their home schedule.');
      await click('Prepare import', 'document.querySelector(".work-schedule-finder form")');
      await page.wait(`document.querySelector('input[name="importTeamName"]')`);
      assert(await page.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Create season & import').disabled`), 'Unknown ticket quantity allowed import');
      assert(await page.evaluate(`document.querySelector('.work-found-schedule input[type="datetime-local"]').value==='2027-09-11T05:00'`), 'AI preview is showing UTC instead of Pacific local time');
      await page.call('Emulation.setTimezoneOverride', { timezoneId: 'America/New_York' });
      await set('input[name="searchTickets"]', '2');
      assert(await page.evaluate(`document.querySelector('.work-found-schedule input[type="datetime-local"]').value==='2027-09-11T08:00'`), 'AI preview did not respect the viewer timezone');
      await page.call('Emulation.setTimezoneOverride', { timezoneId: 'America/Los_Angeles' });
      await set('input[name="searchTickets"]', '3');
      await set('.work-found-schedule input[type="datetime-local"]', '2027-09-11T06:30');
      assert(await page.evaluate(`document.querySelector('input[name="importTeamName"]').value==='Demo schedule search'`));
      await set('input[name="searchTickets"]', '2');
      await screenshot('ai-import-review');
      await click('Create season & import');
      await page.wait(`document.querySelector('.work-found-schedule tbody tr').textContent.includes('Already in inventory')`);
      await page.evaluate(`document.querySelector('button[aria-label="Teams"]').click()`);
      await page.wait(`document.querySelector('.work-setup-register tbody tr')`);
      await page.evaluate(`document.querySelector('.work-setup-register tbody tr').cells[1].click()`);
      await click('+ New team');
      await set('input[name="teamName"]', 'QA setup team');
      await set('input[name="defaultTickets"]', '2');
      await click('Save team');
      await page.wait(`document.querySelector('[aria-label="Team details"] h3')?.textContent==='QA setup team'`);
      await click('Add a season');
      await set('input[name="seasonLabel"]', 'QA 2027 season');
      await set('input[name="seasonStart"]', '2027-01-01');
      await set('input[name="seasonEnd"]', '2027-12-31');
      await click('Save season');
      await page.wait(`document.querySelector('[aria-label="Season details"] h3')?.textContent==='QA 2027 season'`);
      await click('Import into this season');
      await page.evaluate(`document.querySelector('button[aria-label="AI Import"]').click()`);
      await set('textarea[name="scheduleQuery"]', 'Demo schedule 2027');
      await click('Prepare import', 'document.querySelector(".work-schedule-finder form")');
      await page.wait(`document.querySelectorAll('.work-found-schedule tbody tr').length===2`);
      assert(await page.evaluate(`document.querySelectorAll('.work-found-schedule tbody input[type="checkbox"]:checked').length===1`), 'TBD game was selected for import');
      assert(await page.evaluate(`document.querySelector('.work-schedule-sources').textContent.includes('Synthetic schedule source')`));
      await screenshot('schedule-search');
      await click('Import selected games');
      await page.wait(`document.querySelector('.work-found-schedule tbody tr').textContent.includes('Already in inventory')`);
      await click('CSV import');
      await click('Load example');
      await click('Validate & preview');
      await page.wait(`document.querySelectorAll('.work-import-preview tbody tr').length===2`);
      await screenshot('setup');
      await click('Import private inventory');
      await page.wait(`document.querySelector('textarea[name="scheduleCsv"]').value===''`);
    }
    await nav('User access');
    await page.wait(`document.querySelector('.work-table tbody tr')`);
    assert(await page.evaluate(`!document.querySelector('[aria-label="User access details"]') && !document.querySelector('tbody tr[aria-selected="true"]')`));
    await set('input[placeholder="Search name or email"]', 'rep@example.invalid');
    await page.wait(`document.querySelectorAll('.work-table tbody tr').length===1`);
    await page.evaluate(`document.querySelector('.work-table tbody tr').cells[1].click()`);
    await page.wait(`document.querySelector('.work-access-form select')`);
    await set('.work-access-form select', 'coordinator');
    await click('Save role');
    await page.wait(`document.querySelector('.work-table tbody tr').cells[1].textContent==='Coordinator'`);
    await screenshot('user-access');
    await set('select[aria-label="Synthetic persona"]', 'rep');
    assert(await page.evaluate(`![...document.querySelectorAll('nav[aria-label="Workspace navigation"] button')].some(b=>b.textContent.includes('User access'))`), 'Ordinary coordinator can see admin role management');
    await set('select[aria-label="Synthetic persona"]', 'coordinator');
    await nav('User access');
    await set('input[placeholder="Search name or email"]', 'rep@example.invalid');
    await page.evaluate(`document.querySelector('.work-table tbody tr').cells[0].click()`);
    await page.wait(`document.querySelector('.work-access-form select')`);
    await set('.work-access-form select', 'rep');
    await click('Save role');
    await page.wait(`document.querySelector('.work-table tbody tr').cells[1].textContent==='Sales representative'`);
    await page.evaluate(`document.querySelector('[aria-label="Close user access"]').click()`);
    await page.wait(`!document.querySelector('[aria-label="User access details"]') && !document.querySelector('tbody tr[aria-selected="true"]')`);
    await click('Groups');
    await page.wait(`document.querySelector('input[placeholder="Search linked group or ID"]')`);
    assert(await page.evaluate(`!document.querySelector('[aria-label="Group access details"]') && !document.querySelector('tbody tr[aria-selected="true"]')`));
    await page.evaluate(`document.querySelector('.work-table tbody tr').cells[1].click()`);
    await page.wait(`document.querySelector('select[name="groupRole"]')`);
    await set('select[name="groupRole"]', 'rep');
    await click('Save group role');
    await page.wait(`document.querySelector('.work-table tbody tr').cells[3].textContent==='Sales representative'`);
    await screenshot('group-access');
    await page.evaluate(`document.querySelector('[aria-label="Close group access"]').click()`);
    await page.wait(`!document.querySelector('[aria-label="Group access details"]') && !document.querySelector('tbody tr[aria-selected="true"]')`);
    await click('Connect group');
    await page.wait(`document.querySelector('input[name="groupDirectoryId"]')`);
    await set('input[name="groupDirectoryId"]', '80000000-0000-4000-8000-000000000099');
    await click('Connect and assign role');
    await page.wait(`document.querySelector('[aria-label="Group access details"] h3')?.textContent==='Demo directory group'`);
    assert(await page.evaluate(`document.querySelector('[aria-label="Group access details"]').textContent.includes('80000000-0000-4000-8000-000000000099')`));
    await set('select[aria-label="Synthetic persona"]', 'employee');
    await page.wait(`!document.querySelector('nav[aria-label="Workspace navigation"]').textContent.includes('Contact register')`);
    await set('select[aria-label="Synthetic persona"]', 'coordinator');
    await nav(design === 'desk' ? 'Request queue' : 'Event inventory');
    await page.evaluate(`document.querySelector('.work-request-table tbody tr').cells[0].click()`);
    for (const [orientation, width, height] of [['landscape', 1024, 768], ['portrait', 768, 1024]]) {
      await page.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await page.call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await screenshot(`ipad-${orientation}`);
      assert(await page.evaluate(`document.documentElement.scrollWidth <= window.innerWidth`), `${design}: iPad ${orientation} horizontal page overflow`);
      assert(await page.evaluate(`document.documentElement.scrollHeight <= window.innerHeight + 1`), `${design}: iPad ${orientation} whole page scrolls`);
      if (design === 'desk') {
        assert(await page.evaluate(`(() => {const detail=document.querySelector('.work-request-detail').getBoundingClientRect();const decision=document.querySelector('.work-decision-column').getBoundingClientRect();return decision.left>=detail.right-1 && Math.abs(detail.top-decision.top)<2;})()`), `iPad ${orientation}: allocation controls moved below the request`);
        assert(await page.evaluate(`(() => {const pane=document.querySelector('.work-request-detail');const header=document.querySelector('.work-app-header');const top=header.getBoundingClientRect().top;pane.scrollTop=100;return pane.scrollTop>0 && window.scrollY===0 && header.getBoundingClientRect().top===top;})()`), `iPad ${orientation}: detail scrolling moved the page`);
        await nav('Allocations');
        await page.wait(`document.querySelector('.work-allocation-split tbody tr')`);
        await page.evaluate(`document.querySelector('.work-allocation-split tbody tr').cells[1].click()`);
        await page.wait(`document.querySelector('[aria-label="Allocation details"]')`);
        assert(await page.evaluate(`(() => {const table=document.querySelector('.work-allocation-split>.work-table-scroll').getBoundingClientRect();const detail=document.querySelector('[aria-label="Allocation details"]').getBoundingClientRect();return detail.left>=table.right-1 && Math.abs(detail.top-table.top)<2;})()`), `iPad ${orientation}: allocation details moved below the table`);
        await screenshot(`ipad-${orientation}-allocations`);
        await nav('Setup & import');
        await page.wait(`document.querySelector('.work-setup-register tbody tr')`);
        assert(await page.evaluate(`!document.querySelector('[aria-label="Team details"]')`));
        await page.evaluate(`document.querySelector('.work-setup-register tbody tr').cells[0].click()`);
        await page.wait(`document.querySelector('[aria-label="Team details"]')`);
        await page.evaluate(`document.querySelector('[aria-label="Close team details"]').click()`);
        await page.wait(`!document.querySelector('[aria-label="Team details"]') && !document.querySelector('tbody tr[aria-selected="true"]')`);
        assert(await page.evaluate(`document.documentElement.scrollHeight <= window.innerHeight+1 && document.documentElement.scrollWidth <= window.innerWidth`), `iPad ${orientation}: setup overflows the page`);
        await screenshot(`ipad-${orientation}-setup`);
        await page.evaluate(`document.querySelector('button[aria-label="AI Import"]').click()`);
        await click('AI Import', 'document.querySelector(".work-access-sections")');
        await page.wait(`document.querySelector('textarea[name="scheduleQuery"]')`);
        await set('textarea[name="scheduleQuery"]', 'Demo schedule 2027');
        await click('Prepare import', 'document.querySelector(".work-schedule-finder form")');
        await page.wait(`document.querySelectorAll('.work-found-schedule tbody tr').length===2`);
        assert(await page.evaluate(`document.documentElement.scrollHeight <= innerHeight+1 && document.documentElement.scrollWidth <= innerWidth`), `iPad ${orientation}: schedule search overflows the page`);
        assert(await page.evaluate(`(() => {const editor=document.querySelector('.work-schedule-finder form').getBoundingClientRect();const preview=document.querySelector('[aria-label="Found schedule"]').getBoundingClientRect();return preview.left>=editor.right-1 && Math.abs(preview.top-editor.top)<2;})()`), `iPad ${orientation}: schedule preview moved below the form`);
        await screenshot(`ipad-${orientation}-schedule-search`);
        await nav('User access');
        await page.wait(`document.querySelector('.work-table tbody tr')`);
        await page.evaluate(`document.querySelector('.work-table tbody tr').cells[0].click()`);
        await page.wait(`document.querySelector('[aria-label="User access details"]')`);
        assert(await page.evaluate(`(() => {const table=document.querySelector('.work-people-split>.work-table-scroll').getBoundingClientRect();const detail=document.querySelector('[aria-label="User access details"]').getBoundingClientRect();return detail.left>=table.right-1 && document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight+1;})()`), `iPad ${orientation}: user access overflow`);
        await screenshot(`ipad-${orientation}-user-access`);
        await click('Groups');
        await page.wait(`document.querySelector('input[placeholder="Search linked group or ID"]')`);
        assert(await page.evaluate(`!document.querySelector('[aria-label="Group access details"]')`));
        await page.evaluate(`document.querySelector('.work-table tbody tr').cells[0].click()`);
        await page.wait(`document.querySelector('[aria-label="Group access details"]')`);
        assert(await page.evaluate(`(() => {const table=document.querySelector('.work-people-split>.work-table-scroll').getBoundingClientRect();const detail=document.querySelector('[aria-label="Group access details"]').getBoundingClientRect();return detail.left>=table.right-1 && document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight+1;})()`), `iPad ${orientation}: group access overflow`);
        await screenshot(`ipad-${orientation}-group-access`);
        await nav('Request queue');
        await page.evaluate(`document.querySelector('.work-request-table tbody tr').cells[0].click()`);
      }
    }
    assert(await page.evaluate(`!document.querySelector('.work-feedback, .work-table-footer, .work-app-footer, .design-switcher')`), 'Routine feedback or removed layout chrome is still rendered');
    assert.deepEqual(errors, [], `${design}: page errors`);
    assert.deepEqual(external, [], `${design}: external requests`);
    results.push({ design, status: 'PASS', checks: ['no automatic initial selection', 'detail pane dismissal', 'no routine save banners', 'search', 'whole-row and keyboard selection', 'private inventory creation', 'interest', 'requester email', 'allocation', 'right-side allocation details', 'visible rejection reason', 'contact history', ...(design === 'desk' ? ['team and season creation', 'web schedule preview and selected import', 'TBD game excluded', 'CSV fallback', 'iPad schedule search', 'independent detail scrolling'] : []), 'admin-only user access', 'role grant and reversal', 'group role assignment', 'connecting a directory group', 'requester navigation', 'iPad landscape', 'iPad portrait', 'bounded page scroll'], pageErrors: 0, externalRequests: 0 });
    page.close();
    await browser.call('Target.closeTarget', { targetId });
  }
  await writeFile(`${artifacts}/results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { browser.close(); }
