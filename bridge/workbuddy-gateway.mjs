export function isPublicWorkBuddyGateway(status,body) {
 if(status===200)return body?.data?.status==='ok';
 return [401,403].includes(status)&&['AUTH_REQUIRED','MISSING_REQUIRED_HEADER'].includes(body?.error?.code);
}
