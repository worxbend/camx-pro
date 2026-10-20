// Browser exercises the real portable C++ controller through a local host fixture.
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {spawn, execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
import assert from 'node:assert/strict';
const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const temp=mkdtempSync(join(tmpdir(),'camx-ui-'));
const binary=join(temp,'simulator');
execFileSync(process.env.CXX||'clang++',['-std=c++17','-Wall','-Wextra','-Werror','-fsanitize=address,undefined','-I',join(root,'firmware/include'),join(root,'firmware/tests/simulator.cpp'),'-o',binary]);
const child=spawn(binary,[],{stdio:['pipe','pipe','inherit']});
const pending=[];const commands=[];const errors=[];
createInterface({input:child.stdout}).on('line',line=>pending.shift()?.(JSON.parse(line)));
const exchange=body=>new Promise(resolve=>{pending.push(resolve);child.stdin.write(body+'\n');});
let delayMove=false;
const server=createServer(async(req,res)=>{
  if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(readFileSync(join(root,'firmware/web/index.html')));return;}
  res.setHeader('Content-Type','application/json');
  if(req.headers.authorization!=='Bearer test-token-123456789'){res.statusCode=401;res.end('{"error":"unauthorized"}');return;}
  let body='';for await(const part of req)body+=part;
  const command=req.method==='GET'?{op:'state'}:JSON.parse(body);
  commands.push(command);
  const next=await exchange(JSON.stringify(command));
  if(delayMove&&command.op==='move')await new Promise(resolve=>setTimeout(resolve,400));
  res.statusCode=next.result==='ok'?200:409;res.end(JSON.stringify(next));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1100,height:900}});
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('#token').fill('test-token-123456789');await page.locator('#connect').click();
  await page.waitForFunction(()=>document.querySelector('#diagnostics').textContent.includes('"api": 1'));
  const state=()=>page.locator('#diagnostics').textContent().then(JSON.parse);
  async function click(id,result){await page.locator('#'+id).click();await page.waitForFunction(text=>document.querySelector('#message').textContent===text,result+': ok');}
  await click('reference','reference');await click('arm','arm');
  assert.equal((await state()).armed,true);
  await page.locator('#pan').fill('1');await page.locator('#tilt').fill('-1');
  await click('move','move');
  await page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('#diagnostics').textContent);return !s.moving&&s.axes[0].steps===46&&s.axes[1].steps===-23;});
  // Pointer capture/release yields a bounded jog and controlled deceleration.
  const jog=page.locator('.jog[data-pan="1"]');
  await jog.scrollIntoViewIfNeeded();const bounds=await jog.boundingBox();
  await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.down();
  await page.waitForFunction(()=>JSON.parse(document.querySelector('#diagnostics').textContent).jogging);
  await page.mouse.up();
  await page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('#diagnostics').textContent);return !s.moving&&!s.jogging;});
  assert.equal(commands.some(c=>c.op==='jog'&&c.pan===0&&c.tilt===0),true);
  // STOP cancels a request whose actuation succeeded but whose response is delayed.
  delayMove=true;
  await page.locator('#pan').fill('10');await page.locator('#move').click();
  await page.waitForTimeout(80);await page.locator('#stop').click();
  await page.waitForFunction(()=>JSON.parse(document.querySelector('#diagnostics').textContent).stopped);
  await page.waitForTimeout(500);
  assert.equal((await state()).stopped,true);assert.equal((await state()).referenced,false);
  assert.equal(commands.filter(c=>c.op==='move'&&c.pan===10).length,1);
  await click('disarm','disarm');
  assert.equal((await state()).armed,false);
  await page.locator('#presetSet').click();
  await page.waitForFunction(()=>JSON.parse(document.querySelector('#diagnostics').textContent).presets[0].valid);
  // Never persist the API token in browser storage.
  assert.deepEqual(await page.evaluate(()=>[localStorage.length,sessionStorage.length]),[0,0]);
  assert.equal(await page.locator('#token').inputValue(),'');
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);
  console.log('Browser: connect/reference/arm/geared move/jog release/STOP race/preset/token/mobile layout: PASS');
} finally {
  await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  child.stdin.end();child.kill();rmSync(temp,{recursive:true,force:true});
}
