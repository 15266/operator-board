import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isPublicWorkBuddyGateway} from './workbuddy-gateway.mjs';
test('internal desktop 404 is not a public gateway or evidence of missing credentials',()=>{assert.equal(isPublicWorkBuddyGateway(404,{error:'not found'}),false);});
test('unrelated 200 and HTML are not a gateway',()=>{for(const body of [{ok:true},{status:'ok'},'<html>login</html>',null])assert.equal(isPublicWorkBuddyGateway(200,body),false);});
test('official health envelope identifies a public gateway',()=>{assert.equal(isPublicWorkBuddyGateway(200,{data:{status:'ok',uptime:1}}),true);});
test('only recognized API authentication errors identify a protected gateway',()=>{assert.equal(isPublicWorkBuddyGateway(401,{error:{code:'AUTH_REQUIRED'}}),true);assert.equal(isPublicWorkBuddyGateway(403,{error:{code:'MISSING_REQUIRED_HEADER'}}),true);assert.equal(isPublicWorkBuddyGateway(401,{error:'unauthorized'}),false);});
