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
let delayMove=false, armReplyGate=null, armAccepted=null, releaseArm=null;
const server=createServer(async(req,res)=>{
  if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(readFileSync(join(root,'firmware/web/index.html')));return;}
  res.setHeader('Content-Type','application/json');
  if(req.headers.authorization!=='Bearer test-token-123456789'){res.statusCode=401;res.end('{"error":"unauthorized"}');return;}
  let body='';for await(const part of req)body+=part;
  const command=req.method==='GET'?{op:'state'}:JSON.parse(body);
  commands.push(command);
  const next=await exchange(JSON.stringify(command));
  if(command.op==='arm'&&armReplyGate){armAccepted?.();await armReplyGate;}
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
  // A click that lands while a poll is in flight is declined by the page ("Wait for the pending
  // request") and sends nothing, so it is repeated; any other outcome ends the wait.
  async function press(id,expected){
    for(let attempt=0;attempt<20;attempt++){
      await page.evaluate(()=>{document.querySelector('#message').textContent='';});
      await page.locator('#'+id).click();
      const seen=await page.waitForFunction(text=>{const t=document.querySelector('#message').textContent;return t.includes(text)||t.startsWith('Wait for the pending')?t:false;},expected,{timeout:5000}).then(handle=>handle.jsonValue());
      if(seen.includes(expected))return;
      await page.waitForTimeout(100);
    }
    throw Error('Command was never sent: '+id);
  }
  const click=(id,result)=>press(id,result+': ok');
  // Holds a jog button. The page ignores a press while a poll is in flight, so retry until the
  // controller reports jogging, then hold for `ms` and release.
  async function hold(locator,ms){
    await locator.scrollIntoViewIfNeeded();
    const box=await locator.boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
    for(let attempt=0;attempt<20;attempt++){
      await page.mouse.down();
      const started=await page.waitForFunction(()=>JSON.parse(document.querySelector('#diagnostics').textContent).jogging,null,{timeout:1500}).then(()=>true,()=>false);
      if(started){await page.waitForTimeout(ms);await page.mouse.up();return;}
      await page.mouse.up();await page.waitForTimeout(150);
    }
    throw Error('Jog never started');
  }
  // Connecting to an already armed controller does not grant movement ownership.
  let outside=await state();
  outside=await exchange(JSON.stringify({op:'reference',pan:0,tilt:0,epoch:outside.epoch,seq:outside.seq+1}));
  outside=await exchange(JSON.stringify({op:'arm',epoch:outside.epoch,seq:outside.seq+1}));
  await page.waitForFunction(()=>JSON.parse(document.querySelector('#diagnostics').textContent).armed);
  assert.equal(await page.locator('#move').isDisabled(),true,'an observer must not move another session');
  assert.equal(await page.locator('.jog').first().isDisabled(),true);
  const observedAt=commands.length;
  await page.evaluate(()=>request({op:'relative',pan:1,tilt:1}));
  assert.equal(commands.slice(observedAt).some(c=>c.op==='relative'),false);
  outside=await exchange('{"op":"state"}');
  await exchange(JSON.stringify({op:'disarm',epoch:outside.epoch,seq:outside.seq+1}));
  await page.waitForFunction(()=>!JSON.parse(document.querySelector('#diagnostics').textContent).armed);
  await click('reference','reference');await click('arm','arm');
  assert.equal((await state()).armed,true);
  await page.locator('#pan').fill('1');await page.locator('#tilt').fill('-1');
  await click('move','move');
  await page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('#diagnostics').textContent);return !s.moving&&s.axes[0].steps===46&&s.axes[1].steps===-23;});
  // Pointer capture/release yields a bounded jog and controlled deceleration.
  await hold(page.locator('.jog[data-pan="1"][data-tilt="0"]'),0);
  await page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('#diagnostics').textContent);return !s.moving&&!s.jogging;});
  assert.equal(commands.some(c=>c.op==='jog'&&c.pan===0&&c.tilt===0),true);
  // A diagonal jog drives both axes at once.
  const before=(await state()).axes.map(a=>a.steps);
  await hold(page.locator('.jog[data-pan="-1"][data-tilt="-1"]'),500);
  await page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('#diagnostics').textContent);return !s.moving&&!s.jogging;});
  const after=(await state()).axes.map(a=>a.steps);
  assert.ok(after[0]<before[0]&&after[1]<before[1],`diagonal jog moved ${before} to ${after}`);
  assert.equal(commands.some(c=>c.op==='jog'&&c.pan===-1&&c.tilt===-1),true);
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
  // Motion feel: a runtime scale needs neither released motors nor a new reference.
  await click('reference','reference');await click('arm','arm');
  await page.locator('#speedScale').fill('50');await click('motion','motion');
  await page.waitForFunction(()=>JSON.parse(document.querySelector('#diagnostics').textContent).motion.speed===0.5);
  assert.equal((await state()).referenced,true);
  await page.locator('#speedScale').fill('100');await click('motion','motion');
  await page.waitForFunction(()=>JSON.parse(document.querySelector('#diagnostics').textContent).motion.speed===1);
  // Retargeting: moves are refused while moving until the box is ticked, then the newest target wins.
  await page.locator('#pan').fill('4');await page.locator('#tilt').fill('0');await click('move','move');
  await page.waitForFunction(()=>JSON.parse(document.querySelector('#diagnostics').textContent).moving);
  assert.equal(await page.locator('#move').isDisabled(),true);
  await page.locator('#retarget').check();
  await page.waitForFunction(()=>!document.querySelector('#move').disabled);
  await page.locator('#pan').fill('-4');await click('move','move');
  await page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('#diagnostics').textContent);return !s.moving&&!s.queued&&s.axes[0].steps===-182;},null,{timeout:20000});
  assert.equal(commands.some(c=>c.op==='move'&&c.pan===-4&&c.retarget===true),true);
  await page.locator('#retarget').uncheck();
  // Save the present pose under a name while armed, then clear it again.
  await page.locator('#preset').selectOption('1');await page.locator('#presetName').fill('Desk');
  await click('presetSave','preset_save');
  await page.waitForFunction(()=>{const p=JSON.parse(document.querySelector('#diagnostics').textContent).presets[1];return p.valid&&p.name==='Desk'&&Math.abs(p.pan+4)<0.05;});
  assert.match(await page.locator('#presetList').textContent(),/2 · Desk · -4\.0° \/ 0\.0°/);
  await page.locator('#presetName').fill('caf\u00e9');await press('presetSave','16 printable ASCII');
  await click('presetClear','preset_clear');
  await page.waitForFunction(()=>!JSON.parse(document.querySelector('#diagnostics').textContent).presets[1].valid);
  // A per-move speed is sent only below 100 %.
  await page.locator('#moveSpeed').fill('50');await page.locator('#pan').fill('2');await click('move','move');
  await page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('#diagnostics').textContent);return !s.moving&&s.axes[0].steps===91;},null,{timeout:20000});
  assert.equal(commands.some(c=>c.op==='move'&&c.pan===2&&c.speed===0.5),true);
  await page.locator('#moveSpeed').fill('100');
  // Releasing a referenced, resting mechanism remembers where it was, as a hint only.
  await click('disarm','disarm');
  await page.waitForFunction(()=>!document.querySelector('#lastPoseRow').hidden);
  assert.equal((await state()).last_pose.valid,true);
  await page.locator('#useLastPose').click();
  assert.ok(Math.abs(Number(await page.locator('#refPan').inputValue())-2)<0.02);
  // Losing focus while ARM has reached the controller must STOP even before its reply arrives.
  await click('reference','reference');
  armReplyGate=new Promise(resolve=>{releaseArm=resolve;});
  const accepted=new Promise(resolve=>{armAccepted=resolve;});
  await page.waitForFunction(()=>!busy);
  await page.locator('#arm').click();await accepted;
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  try {
    await page.waitForFunction(()=>JSON.parse(document.querySelector('#diagnostics').textContent).stopped,null,{timeout:1500});
  } finally { releaseArm();armReplyGate=null; }
  await page.waitForFunction(()=>!busy);
  assert.equal((await state()).stopped,true);
  // Never persist the API token in browser storage.
  assert.deepEqual(await page.evaluate(()=>[localStorage.length,sessionStorage.length]),[0,0]);
  assert.equal(await page.locator('#token').inputValue(),'');
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);
  console.log('Browser: connect/reference/arm/geared move/jog release/STOP race/preset/motion feel/retarget/named presets/last pose/token/mobile layout: PASS');
} finally {
  await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  child.stdin.end();child.kill();rmSync(temp,{recursive:true,force:true});
}
