const test = require('node:test');
const assert = require('node:assert/strict');

test('personal projects isolate nodes, results and uploads; teams share and owners control visibility', async () => {
  const f = await require('./cloud-fixture')();
  try {
    const owner = await f.api('/api/auth/login', {email:'owner@example.com', password:'owner-test-password'});
    const invite = await f.api('/api/members/invites', {email:'private-friend@example.com'}, owner.cookie);
    const friend = await f.api('/api/auth/accept', {token:invite.data.path.split('=')[1], name:'朋友', password:'friend-test-password'});
    const a = owner.cookie, b = friend.cookie;
    const personal = (await f.api('/api/projects', {name:'个人秘密',visibility:'personal'}, a)).data;
    const own = (await f.api('/api/projects', {name:'朋友私有',visibility:'personal'}, b)).data;
    const team = (await f.api('/api/projects', {name:'共同创作',visibility:'team'}, a)).data;
    assert.equal(personal.ownerId, owner.data.id);
    assert.equal(personal.canManageVisibility, true);
    assert.equal((await f.api('/api/projects', {visibility:'public'},a)).status,400);
    assert.deepEqual(new Set((await f.api('/api/projects',null,b)).data.map(p=>p.id)), new Set([own.id,team.id]));
    assert.equal((await f.api('/api/projects/'+own.id,null,a)).status,404,'admins cannot open other members personal projects');
    const node = (await f.api('/api/projects/'+personal.id+'/video-nodes',{},a)).data;
    const text = (await f.api('/api/projects/'+personal.id+'/text-nodes',{content:'私密文字'},a)).data;
    const edge = await f.api('/api/projects/'+personal.id+'/edges',{sourceNodeId:text.id,targetNodeId:node.id},a);
    assert.equal(edge.status,201);
    const denied = [
      ['/api/projects/'+personal.id,null,'GET'],
      ['/api/projects/'+personal.id,{name:'changed'},'PATCH'],
      ['/api/projects/'+personal.id,null,'DELETE'],
      ['/api/projects/'+personal.id+'/state',{nodes:[],edges:[]},'PUT'],
      ['/api/projects/'+personal.id+'/nodes',{nodes:[]},'PATCH'],
      ['/api/projects/'+personal.id+'/video-nodes',{},'POST'],
      ['/api/projects/'+personal.id+'/assets',{},'POST'],
      ['/api/nodes/'+node.id,{generation:{prompt:'override'}},'PATCH'],
      ['/api/nodes/'+node.id,null,'DELETE'],
      ['/api/nodes/'+node.id+'/generation',null,'GET'],
      ['/api/nodes/'+node.id+'/generate',{},'POST'],
      ['/api/nodes/'+node.id+'/download?link=1',null,'GET'],
      ['/api/edges/'+edge.data.edge.id,null,'DELETE'],
      ['/api/uploads/init',{projectId:personal.id,file:{name:'secret.mp4',size:4}},'POST'],
      ['/uploads/'+personal.id+'/secret.mp4',null,'GET'],
    ];
    for (const [url,body,method] of denied) assert.equal((await f.api(url,body,b,method)).status,404,url);
    assert.equal(f.requests.length,0);
    // Crafted undo snapshots cannot steal another project's output via a node ID.
    assert.equal((await f.api('/api/projects/'+team.id+'/state',{nodes:[node],edges:[]},b,'PUT')).status,400);
    assert.equal((await f.api('/api/projects/'+team.id+'/edges',{sourceNodeId:text.id,targetNodeId:node.id},b)).status,404);
    assert.equal((await f.api('/api/projects/'+team.id,{visibility:'personal'},b,'PATCH')).status,403);
    assert.equal((await f.api('/api/projects/'+team.id+'/text-nodes',{content:'共同编辑'},b)).status,201);
    // A team upload ticket loses access when its project becomes personal.
    const ticket = await f.api('/api/uploads/init',{projectId:team.id,file:{name:'team.mp4',size:4}},b);
    assert.equal(ticket.status,201);
    assert.equal((await fetch(ticket.data.urls[0],{method:'PUT',body:Buffer.from('test')})).status,200);
    assert.equal((await f.api('/api/uploads/'+ticket.data.id+'/complete',{},b)).status,200);
    const asset = await f.api('/api/uploads/'+ticket.data.id+'/attach',{},b);
    assert.equal(asset.status,201);
    assert.equal((await f.api(asset.data.url,null,a)).status,302);
    assert.equal((await f.api('/api/projects/'+team.id,{visibility:'personal'},a,'PATCH')).status,200);
    for (const suffix of ['complete','attach']) assert.equal((await f.api('/api/uploads/'+ticket.data.id+'/'+suffix,{},b)).status,404);
    assert.equal((await f.api('/api/uploads/'+ticket.data.id,null,b,'DELETE')).status,404);
    assert.equal((await f.api(asset.data.url,null,b)).status,404);
    assert.equal((await f.api('/api/nodes/'+asset.data.id+'/download?link=1',null,b)).status,404);
    assert.equal((await f.api(asset.data.url,null,a)).status,302);
    assert.equal((await f.api('/api/projects/'+team.id,{visibility:'team'},a,'PATCH')).status,200);
    assert.equal((await f.api('/api/projects/'+team.id,null,b)).status,200);
    assert.equal((await f.api(asset.data.url,null,b)).status,302);
    // Old persisted projects retain their shared behavior; owners survive reload.
    await f.store.transaction(() => {
      f.store.state.projects.push({id:'legacy',name:'已有项目',updatedAt:new Date().toISOString()});
      f.store.save();
    });
    const list = (await f.api('/api/projects',null,b)).data;
    assert.equal(list.find(p=>p.id==='legacy').visibility,'team');
    assert.equal(list.find(p=>p.id==='legacy').canManageVisibility,false);
    assert.equal((await f.api('/api/projects/legacy',{visibility:'personal'},a,'PATCH')).status,200);
    assert.equal((await f.api('/api/projects/legacy',null,b)).status,404);
    assert.equal((await f.api('/api/projects/'+personal.id,null,a)).data.visibility,'personal');
  } finally { await f.close(); }
});
