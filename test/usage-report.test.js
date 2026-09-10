const test=require('node:test');
const assert=require('node:assert/strict');
const {usageReport}=require('../usage-report');
test('member usage preserves zero users, missing tokens, status, monthly boundaries and member privacy',()=>{
 const users=[{id:'a',name:'管理员',role:'admin'},{id:'b',name:'朋友',email:'b@example.com',disabled:true},{id:'c',name:'新成员'}];
 const usage=[
 {id:'1',userId:'b',createdAt:'2026-09-01T00:00:00Z',status:'complete',usage:{total_tokens:100,completion_tokens:70}},
 {id:'2',userId:'b',createdAt:'2026-09-02T00:00:00Z',status:'failed',usage:null},
 {id:'3',userId:'a',createdAt:'2026-09-02T00:00:00Z',status:'complete',usage:{input_tokens:10,output_tokens:20}},
 {id:'4',userId:'a',createdAt:'2026-09-02T00:00:00Z',status:'queued',usage:{}},
 {id:'5',userId:'b',createdAt:'2026-09-02T00:00:00Z',status:'complete',usage:{total_tokens:0}},
 {id:'6',userId:'b',createdAt:'2026-08-31T23:59:59Z',status:'complete',usage:{total_tokens:999}},
 {id:'7',userId:'b',createdAt:'2026-10-01T00:00:00Z',status:'complete',usage:{total_tokens:999}},
 {id:'8',userId:'a',createdAt:'2026-09-02T00:00:00Z',status:'unknown',usage:{total_tokens:-5}},
 ];
 const result=usageReport({users,usage,viewer:users[0],month:'2026-09'});
 assert.equal(result.members.length,3);
 assert.equal(result.members.find(m=>m.userId==='c').tasks,0);
 assert.equal(result.members.find(m=>m.userId==='b').disabled,true);
 assert.equal(result.members.find(m=>m.userId==='b').tasks,3);
 assert.equal(result.members.find(m=>m.userId==='b').completed,2);
 assert.equal(result.members.find(m=>m.userId==='b').unreported,1);
 assert.equal(result.totals.tasks,6);
 assert.equal(result.totals.tokens,130);
 assert.equal(result.totals.unreported,3);
 assert.equal(result.totals.active,1);
 assert.equal(result.totals.failed,1);
 assert.equal(result.totals.unresolved,1);
 const own=usageReport({users,usage,viewer:users[1],month:'2026-09'});
 assert.equal(own.members.length,1);
 assert.ok(own.records.every(r=>r.userId==='b'));
 assert.equal(own.totals.tokens,100);
 assert.ok(!JSON.stringify(own).includes('管理员'));
});
