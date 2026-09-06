"""Real Chromium UI integration tests; no app dependencies.
Run `python tests/browser-integration.py --inline` in a restricted browser environment,
or start the app server and set BASE_URL=http://localhost:8080.
--inline uses an opaque about:blank origin: GPU and durable browser storage are not tested.
Download tests validate generated Blob payloads, not OS download permissions.
"""
import asyncio, json, os, sys, traceback
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / 'test-results'

async def main():
    RESULTS.mkdir(exist_ok=True)
    results, errors, warnings = [], [], []
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=os.environ.get('CHROMIUM', '/usr/bin/chromium'), headless=True,
            args=['--no-sandbox'])
        page = await browser.new_page(viewport={'width':1600, 'height':1040}, device_scale_factor=1)
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('console', lambda msg: warnings.append(msg.text) if msg.type in ['warning','error'] else None)
        async def check(name, expression):
            value = await page.evaluate(expression)
            assert value is True, f'{name}: {value!r}'
            results.append({'name':name, 'passed':True})
            print('PASS', name, flush=True)
        async def world(x, y):
            return await page.evaluate('''([x,y])=>{const r=document.querySelector('#stage').getBoundingClientRect(),s=voltweave.renderer.screen({x,y});return {x:s.x+r.x,y:s.y+r.y};}''',[x,y])
        async def click_world(x,y):
            pt=await world(x,y)
            await page.mouse.click(pt['x'],pt['y'])
        async def click_pin(placement, key):
            pt = await page.evaluate('''([id,key])=>{const p=voltweave.renderer.scene.pins.find(p=>p.placementId===id&&p.pinKey===key);if(!p)throw Error('Pin not found '+key);const r=document.querySelector('#stage').getBoundingClientRect(),s=voltweave.renderer.screen(p);return {x:s.x+r.x,y:s.y+r.y};}''',[placement,key])
            await page.mouse.click(pt['x'],pt['y'])
        async def insert(symbol,x,y):
            await page.locator('#symbolSearch').fill('')
            await page.locator('#symbolCategory').select_option('')
            await page.locator(f'#symbolLibrary [data-symbol="{symbol}"]').click()
            await click_world(x,y)
            await page.keyboard.press('Escape')
            return await page.evaluate('()=>[...voltweave.state.selection][0]')
        async def action(name):
            await page.evaluate('(name)=>voltweave.run(name)',name)
        async def submit():
            await page.locator('#dialogSubmit').click()
            await page.wait_for_function('!document.querySelector("#dialog").open')
        try:
            if '--inline' in sys.argv:
                await page.set_content((ROOT/'dist'/'voltweave.html').read_text(),wait_until='load')
            else:
                await page.goto(os.environ.get('BASE_URL','http://localhost:8080/')+'?demo=1')
            await page.wait_for_function('window.voltweave?.ready',timeout=30000)
            await check('Sample startup and zero implemented ERC findings','''()=>voltweave.analysis.stats.devices===21&&voltweave.analysis.stats.pages===3&&voltweave.analysis.issues.length===0''')
            await page.locator('#pageTabs [data-page]').nth(1).click()
            await check('Page-tab navigation loads control schematic',"()=>voltweave.project.pages[voltweave.state.pageId].number==='2'&&voltweave.renderer.scene.routeFailures.length===0")
            await page.evaluate('''()=>{const p=voltweave.project;window.testDevice=Object.values(p.devices).find(d=>d.tag==='-K1').id;window.testPlacement=Object.values(p.placements).find(s=>p.functions[s.functionId].deviceId===testDevice&&s.pageId===voltweave.state.pageId).id;voltweave.select([testPlacement]);}''')
            await page.locator('[data-bind="device:tag"]').fill('-K100')
            await page.locator('[data-bind="device:tag"]').press('Tab')
            await check('Property editing preserves device UUID and four references',"()=>voltweave.project.devices[testDevice].tag==='-K100'&&voltweave.store.xrefs.get(testDevice).length===4")
            await page.locator('#stage').focus()
            await page.keyboard.press('Control+z')
            await check('Keyboard undo reverts physical tag',"()=>voltweave.project.devices[testDevice].tag==='-K1'")
            await page.keyboard.press('Control+Shift+z')
            await check('Keyboard redo restores physical tag',"()=>voltweave.project.devices[testDevice].tag==='-K100'")
            await page.locator('.reference-button').first.click()
            await check('Cross-reference button navigates to referenced function',"()=>voltweave.state.selection.size===1&&[...voltweave.state.selection][0]!==testPlacement")
            # New project via the actual modal form, then build a simple circuit using pointer input.
            await action('new')
            await page.locator('#dialogBody [name="name"]').fill('Browser integration circuit')
            await submit()
            a=await insert('coil',400,400)
            b=await insert('coil',800,400)
            c=await insert('lamp',650,680)
            await check('Symbol-library insertion creates three devices and six persistent pins',"()=>Object.keys(voltweave.project.devices).length===3&&Object.keys(voltweave.project.pins).length===6")
            await page.keyboard.press('w')
            await click_pin(a,'A1')
            await click_pin(b,'A1')
            await check('Pin-to-pin pointer wiring creates a semantic connection',"()=>Object.keys(voltweave.project.connections).length===1&&voltweave.analysis.stats.nets===1")
            # Explicit wire tap. Choose a long horizontal segment rather than a symbol or escape lead.
            wire = await page.evaluate('()=>Object.keys(voltweave.project.connections)[0]')
            tap=await page.evaluate('''id=>{const pts=voltweave.renderer.scene.routes.get(id);for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i];if(a.y===b.y&&Math.abs(a.x-b.x)>100)return {x:(a.x+b.x)/2,y:a.y};}throw Error('No tap segment');}''',wire)
            await click_world(tap['x'],tap['y'])
            lamp_pin = await page.evaluate('id=>Object.keys(voltweave.project.functions[voltweave.project.placements[id].functionId].pins)[0]',c)
            await click_pin(c,lamp_pin)
            await page.keyboard.press('Escape')
            await check('Explicit wire tap atomically inserts a junction and three connected edges',"()=>Object.keys(voltweave.project.connections).length===3&&Object.values(voltweave.project.functions).filter(f=>f.symbolId==='junction').length===1&&voltweave.analysis.stats.nets===1")
            await page.evaluate('()=>{window.beforeNets=JSON.stringify(voltweave.analysis.netOf);window.beforeUndo=voltweave.store.undoStack.length;}')
            start=await world(400,400);end=await world(440,430)
            await page.mouse.move(start['x'],start['y']);await page.mouse.down();await page.mouse.move(end['x'],end['y'],steps=12);await page.mouse.up()
            await page.evaluate('(id)=>window.movedPlacement=id',a)
            await check('Pointer dragging commits one snapped transaction without changing connectivity',"()=>voltweave.project.placements[movedPlacement].x===440&&voltweave.project.placements[movedPlacement].y===430&&JSON.stringify(voltweave.analysis.netOf)===beforeNets&&voltweave.store.undoStack.length===beforeUndo+1")
            await page.keyboard.press('Control+z')
            await check('Drag undo restores drawing and wire endpoints',"()=>voltweave.project.placements[movedPlacement].x===400&&voltweave.project.placements[movedPlacement].y===400&&JSON.stringify(voltweave.analysis.netOf)===beforeNets")
            await action('number');await submit()
            await check('Numbering dialog updates every conductor on the same net',"()=>Object.values(voltweave.project.connections).every(w=>w.number==='W0001')")
            # Page and terminal / cable engineering forms.
            await action('addPage')
            await page.locator('#dialogBody [name="name"]').fill('Terminal schedule')
            await submit()
            await check('Add-page dialog creates a navigable second page',"()=>Object.keys(voltweave.project.pages).length===2&&voltweave.project.pages[voltweave.state.pageId].name==='Terminal schedule'")
            await action('newStrip');await page.locator('#dialogBody [name="count"]').fill('3');await submit()
            await check('Terminal-strip dialog places independently identified bonded terminals',"()=>Object.keys(voltweave.project.strips).length===1&&voltweave.analysis.terminals.length===3")
            await action('newCable');await page.locator('#dialogBody [name="tag"]').fill('-W7');await submit()
            await check('Cable-definition dialog updates engineering data',"()=>Object.values(voltweave.project.cables).some(c=>c.tag==='-W7'&&c.cores===4)")
            # Return to the curated example for PLC editing and export checks.
            await action('demo');await submit();await action('plc')
            inp=page.locator('[data-plc-channel="I1"][data-plc-key="address"]')
            original=await inp.input_value()
            other=await page.locator('[data-plc-channel="I0"][data-plc-key="address"]').input_value()
            await inp.fill(other);await inp.press('Tab')
            await check('Editable PLC table produces a duplicate-address diagnostic',"()=>voltweave.analysis.issues.some(i=>i.code==='PLC_DUPLICATE')")
            await action('undo')
            await check('PLC assignment undo clears the diagnostic',"()=>!voltweave.analysis.issues.some(i=>i.code==='PLC_DUPLICATE')")
            # Capture the actual generated Blob. Suppress only OS download initiation.
            await page.evaluate('''()=>{window.testBlobs=new Map();window.testDownloads=[];const create=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{const url=create(blob);testBlobs.set(url,blob);return url;};const click=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download){testDownloads.push({name:this.download,url:this.href});return;}return click.call(this);};}''')
            await action('save');await action('exportSVG');await action('documentation');await action('exportCSV')
            await check('Project, SVG, HTML documentation and CSV export payloads are generated',"""async()=>{if(testDownloads.length!==4)return false;const texts=await Promise.all(testDownloads.map(d=>testBlobs.get(d.url).text()));return JSON.parse(texts[0]).format==='voltweave/project'&&texts[1].includes('<svg')&&texts[2].includes('Bill of materials')&&texts[2].includes('PLC I/O assignment')&&texts[3].includes('Address');}""")
            # Open exported project through the browser file input, preserving all UUIDs.
            payload=await page.evaluate('async()=>await testBlobs.get(testDownloads[0].url).text()')
            await page.evaluate('()=>window.savedDeviceIds=Object.keys(voltweave.project.devices).sort().join()')
            await page.locator('#projectFile').set_input_files({'name':'restored.vw.json','mimeType':'application/json','buffer':payload.encode()})
            await check('File-input import restores exported physical identities',"()=>Object.keys(voltweave.project.devices).sort().join()===savedDeviceIds&&voltweave.analysis.issues.length===0")
            # Dialog command search and screen layout.
            await page.locator('#stage').focus();await page.keyboard.press('Control+k')
            await page.locator('#commandSearch').fill('terminal strip')
            await check('Keyboard command palette searches real commands',"()=>document.querySelector('#commandList').textContent.includes('terminal strip')")
            await page.keyboard.press('Escape')
            await page.locator('#pageTabs [data-page]').first.click()
            await action('erc');await action('fit')
            await page.wait_for_timeout(6800)
            await page.screenshot(path=str(RESULTS/'desktop-workspace.png'),full_page=True)
            await page.set_viewport_size({'width':430,'height':932});await action('fit');await page.wait_for_timeout(300)
            await check('Narrow viewport retains an interactive canvas without horizontal page overflow',"()=>document.querySelector('#stage').getBoundingClientRect().width>150&&voltweave.renderer.scene.segments.length>100&&document.documentElement.scrollWidth<=innerWidth")
            await page.screenshot(path=str(RESULTS/'mobile-workspace.png'),full_page=True)
            assert not errors, f'Unhandled browser errors: {errors}'
            results.append({'name':'No unhandled browser errors','passed':True})
            print('PASS No unhandled browser errors',flush=True)
        except Exception as exc:
            results.append({'name':'Integration run', 'passed':False,'error':str(exc)})
            traceback.print_exc()
            await page.screenshot(path=str(RESULTS/'failure.png'),full_page=True)
        finally:
            details=await page.evaluate('''()=>({backend:window.voltweave?.renderer.backend,secureContext:isSecureContext,navigatorGPU:!!navigator.gpu,rendererStatus:document.querySelector('#renderStatus')?.textContent})''')
            record={'testMode':'inline opaque origin' if '--inline' in sys.argv else 'HTTP server','browser':browser.version,'environment':details,'results':results,'unhandledErrors':errors,'consoleWarnings':sorted(set(warnings)),'limitations':['WebGPU path is unverified when navigatorGPU is false.','Inline mode cannot validate IndexedDB or localStorage.','Export tests inspect actual Blob payloads; OS download UI is not tested.']}
            (RESULTS/'browser-integration.json').write_text(json.dumps(record,indent=2))
            print(json.dumps({'passed':sum(r['passed'] for r in results),'failed':sum(not r['passed'] for r in results),'environment':details},indent=2))
            await browser.close()
            if any(not r['passed'] for r in results) or errors:sys.exit(1)

asyncio.run(main())
