(function(){
 var ready=false;
 window.poprushReady=function(){ready=true};
 setTimeout(function(){if(ready)return;var root=document.getElementById('root');if(!root||root.getAttribute('data-ready'))return;root.textContent='게임을 불러오지 못했습니다. 인터넷 연결과 브라우저 업데이트를 확인한 뒤 새로고침해 주세요. 계속 안 열리면 브라우저 이름과 버전을 알려 주세요.';},20000);
}());
