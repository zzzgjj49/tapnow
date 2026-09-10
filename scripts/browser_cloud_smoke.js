const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { CdpClient, waitFor, click } = require('./browser_smoke');
async function press(client, selector) {
  await client.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'}); new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  await click(client, selector);
}
async function main() {
  const f = await require('../test/cloud-fixture')();
  process.env.APP_URL = f.base; // Test origin only, mocked queue never performs network delivery.
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-cloud-browser-'));
  const browser = spawn(process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=9345', `--user-data-dir=${profile}`, '--window-size=1440,1100',f.base], { windowsHide:true, stdio:'ignore' });
  let client;
  try {
    let page;
    await waitFor(async () => { try { page = (await (await fetch('http://127.0.0.1:9345/json/list')).json()).find(p => p.type === 'page' && p.url.startsWith(f.base)); return !!page; } catch { return false; } }, 'Browser failed to start',15000);
    client = new CdpClient(page.webSocketDebuggerUrl); await client.open();
    await waitFor(() => client.evaluate("location.pathname === '/account.html' && !!document.querySelector('.login form')"), 'Login redirect missing', 15000);
    await client.evaluate("document.querySelector('[name=identity]').value='owner@example.com';document.querySelector('[name=password]').value='owner-test-password'");
    await press(client,'.login button');
    await waitFor(() => client.evaluate("!!document.querySelector('.workspace')"), 'Owner login failed');
    await press(client,'[data-category="personal"]');
    await waitFor(() => client.evaluate("document.querySelector('.workspace-heading h1')?.textContent === '个人项目'"), 'Personal tab failed');
    await press(client,'[data-new-project]');
    await waitFor(() => client.evaluate("typeof activeCanvas !== 'undefined' && !!activeCanvas"), 'Personal canvas did not open');
    const personalId = await client.evaluate('activeCanvas.project.id');
    assert.equal(await client.evaluate('activeCanvas.project.visibility'),'personal');
    await client.send('Page.navigate',{url:f.base+'/?category=personal'});
    await waitFor(() => client.evaluate("document.querySelectorAll('.project-card').length === 1"), 'Personal list did not persist');
    await press(client,'[data-project-menu]');
    await press(client,'[data-visibility]');
    await press(client,'[data-cancel]');
    assert.equal(await client.evaluate("document.querySelector('.workspace-heading h1').textContent"),'个人项目');
    await press(client,'[data-project-menu]');
    await press(client,'[data-visibility]');
    await press(client,'[data-confirm]');
    await waitFor(() => client.evaluate("document.querySelector('.workspace-heading h1')?.textContent === '团队项目' && document.querySelectorAll('.project-card').length === 1"),'Publish to team failed');
    await press(client,'[data-project-menu]');
    await press(client,'[data-visibility]');
    await press(client,'[data-confirm]');
    await waitFor(() => client.evaluate("document.querySelector('.workspace-heading h1')?.textContent === '个人项目'"),'Move to personal failed');
    const personalShot = await client.send('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(path.join(__dirname,'../.run/project-categories.png'),Buffer.from(personalShot.data,'base64'));
    await client.send('Page.navigate',{url:f.base+'/account.html'});
    await waitFor(() => client.evaluate("!!document.querySelector('#members form')"), 'Members page missing');
    assert.equal(await client.evaluate("!!document.querySelector('#billing') || !!document.querySelector('#password')"),false);
    assert.equal(await client.evaluate("document.querySelectorAll('#member-usage tbody tr').length"),1);
    assert.ok(await client.evaluate("document.querySelector('#member-usage').textContent.includes('0')"));
    await client.evaluate("document.querySelector('#members [name=email]').value='browser-friend@example.com'");
    await press(client,'#members form button');
    await waitFor(() => client.evaluate("!!document.querySelector('#invite-result input')"), 'Invite not created');
    const invite = await client.evaluate("document.querySelector('#invite-result input').value");
    await press(client,'#logout');
    await waitFor(() => client.evaluate("!!document.querySelector('.login form')"), 'Logout failed');
    await client.send('Page.navigate',{url:invite});
    await waitFor(() => client.evaluate("document.querySelector('.login h1')?.textContent === '加入朋友的画板'"), 'Invitation form missing');
    await client.evaluate("document.querySelector('[name=identity]').value='浏览器朋友';document.querySelector('[name=password]').value='browser-friend-password'");
    await press(client,'.login button');
    await waitFor(() => client.evaluate("!!document.querySelector('.workspace')"), 'Invitation acceptance failed');
    assert.equal(await client.evaluate("document.querySelectorAll('.project-card').length"),0,'Friend cannot see owner personal projects');
    const privateResponse = await client.evaluate(`fetch('/api/projects/${personalId}').then(r=>r.status)`);
    assert.equal(privateResponse,404);
    const project = await client.evaluate("api('/api/projects',{method:'POST',body:JSON.stringify({name:'云端浏览器验收'})})");
    await client.send('Page.navigate',{url:f.base+'/canvas/'+project.id});
    await waitFor(() => client.evaluate("typeof activeCanvas !== 'undefined' && !!activeCanvas"), 'Canvas did not load');
    const result = await client.evaluate("activeCanvas.uploadFiles([new File([new Uint8Array(9*1024*1024)],'browser-video.mp4',{type:'video/mp4'})],{x:100,y:100}).then(()=>activeCanvas.nodes.map(n=>({id:n.id,size:n.size})))");
    assert.equal(result[0].size,9*1024*1024);
    assert.equal(f.objects.size,1);
    const node = await client.evaluate(`api('/api/projects/${project.id}/video-nodes',{method:'POST',body:'{}'})`);
    await client.evaluate(`api('/api/nodes/${node.id}',{method:'PATCH',body:JSON.stringify({generation:{prompt:'cloud browser test',method:'text'}})}).then(()=>api('/api/nodes/${node.id}/generate',{method:'POST',body:'{}'}))`);
    await f.jobs.work(); await f.store.transaction(() => { for (const j of f.store.state.jobs) j.nextAt=0; f.store.save(); }); await f.jobs.work();
    await client.send('Page.navigate',{url:f.base+'/account.html'});
    await waitFor(() => client.evaluate("document.querySelector('#usage')?.textContent.includes('已完成')"), 'Member usage did not load');
    assert.equal(await client.evaluate("!!document.querySelector('#members')"),false,'Member must not see admin controls');
    assert.equal(await client.evaluate("document.querySelector('#usage').textContent.includes('123')"),true);
    const shot = await client.send('Page.captureScreenshot',{format:'png'});
    fs.mkdirSync(path.join(__dirname,'../.run'),{recursive:true}); fs.writeFileSync(path.join(__dirname,'../.run/cloud-members.png'),Buffer.from(shot.data,'base64'));
    await client.send('Page.reload');
    await waitFor(() => client.evaluate("document.querySelector('#usage')?.textContent.includes('已完成')"), 'Session persistence failed');
    await press(client,'#settings-link');
    await waitFor(() => client.evaluate("!!document.querySelector('#password')"),'Self-service password form missing');
    await client.evaluate("document.querySelector('[name=old]').value='browser-friend-password';document.querySelector('#password [name=password]').value='browser-friend-changed-password'");
    await press(client,'#password button');
    await waitFor(() => client.evaluate("document.querySelector('#notice').textContent.includes('你的密码已更新')"),'Self-service password change failed');
    await press(client,'#logout'); await waitFor(() => client.evaluate("!!document.querySelector('.login form')"),'Final logout failed');
    await client.evaluate("document.querySelector('[name=identity]').value='owner@example.com';document.querySelector('[name=password]').value='owner-test-password'");
    await press(client,'.login button');
    await waitFor(() => client.evaluate("!!document.querySelector('.workspace')"),'Owner login failed after member password change');
    await client.send('Page.navigate',{url:f.base+'/account.html'});
    await waitFor(() => client.evaluate("document.querySelectorAll('#member-usage tbody tr').length === 2"),'New member missing from admin usage');
    assert.ok(await client.evaluate("document.querySelector('#member-usage').textContent.includes('123')"));
    await press(client,'#member-usage tbody tr:nth-child(2) button');
    assert.ok(await client.evaluate("document.querySelector('#task-details').open && document.querySelector('#task-details').textContent.includes('123')"));
    assert.equal(await client.evaluate("!!document.querySelector('#password') || !!document.querySelector('#billing')"),false);
    const usageShot=await client.send('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(path.join(__dirname,'../.run/admin-member-usage.png'),Buffer.from(usageShot.data,'base64'));
    await press(client,'#logout');
    console.log('Cloud browser smoke passed: private/team categories, visibility moves, owner isolation, invitation, shared canvas, 9 MB multipart upload, per-member usage and session persistence.');
  } catch (e) {
    if (client) console.error(await client.evaluate("({url:location.href,body:document.body.innerText.slice(0,700)})").catch(()=>({})));
    throw e;
  } finally {
    if(client){await client.send('Browser.close').catch(()=>{});client.close();}
    if(browser.exitCode===null){browser.kill();await once(browser,'exit');}
    await f.close(); fs.rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
