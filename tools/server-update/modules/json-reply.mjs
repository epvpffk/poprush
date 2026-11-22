// A lightweight response contract consumed by the standalone Node bridge.
export function jsonReply(data,status=200){
 const body=JSON.stringify(data),headers=new Headers({'Cache-Control':'no-store','Content-Type':'application/json'});
 return {status,headers,poprushJsonBody:body,async json(){return JSON.parse(body)},async text(){return body},async arrayBuffer(){return new TextEncoder().encode(body).buffer}};
}
