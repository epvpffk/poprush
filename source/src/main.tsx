import React,{useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import Arena from '../app/arena';
import '../app/globals.css';
class AppBoundary extends React.Component<{children:React.ReactNode},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return{failed:true}}
 render(){return this.state.failed?<main><h1>POP RUSH</h1><p>화면을 불러오는 중 문제가 생겼습니다. 브라우저를 업데이트한 뒤 다시 열어 주세요.</p><button className="primary" onClick={()=>window.location.reload()}>다시 불러오기</button><p>계속 안 열리면 사용 중인 브라우저 이름과 버전을 알려 주세요.</p><small>v59</small></main>:this.props.children}
}
function App(){useEffect(()=>{document.getElementById('root')?.setAttribute('data-ready','true');(window as unknown as {poprushReady?:()=>void}).poprushReady?.()},[]);return <AppBoundary><Arena/></AppBoundary>}
createRoot(document.getElementById('root')!).render(<App/>);
