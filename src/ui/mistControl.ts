import type { createRoomMist } from '../effects/roomMist';

export function bindMistControl(mist: ReturnType<typeof createRoomMist>) {
  const host=document.getElementById('experience-mist-control');
  if(!host)throw Error('Hallway mist controls are missing.');
  const events=new AbortController();
  host.innerHTML=`<details><summary>Hallway mist</summary>
    <button id="experience-mist-toggle" type="button">Hide hallway mist</button>
    <label>Mist strength <input id="experience-mist-density" aria-label="Mist strength" type="range" min="0" max="50" step="1" value="20"></label>
    <p id="experience-mist-status" aria-live="polite"></p></details>`;
  const button=host.querySelector<HTMLButtonElement>('button')!,slider=host.querySelector<HTMLInputElement>('input')!,status=host.querySelector('p')!;
  let last='';
  const refresh=()=>{
    const s=mist.snapshot(),key=JSON.stringify([s.phase,s.error,s.visibleRequested,s.density]);if(key===last)return;last=key;
    button.textContent=s.visibleRequested?'Hide hallway mist':'Show hallway mist';button.setAttribute('aria-pressed',String(s.visibleRequested));
    button.disabled=slider.disabled=s.phase!=='ready';slider.value=String(Math.round(s.density*100));
    status.textContent=s.error??(s.phase==='off'?'Mist disabled for this page.':s.phase==='loading'?'Loading hallway mist.':s.visibleRequested?'Mist in the added hallway beyond the opening.':'Hallway mist hidden.');
  };
  button.addEventListener('click',()=>{mist.setVisible(!mist.snapshot().visibleRequested);refresh();},{signal:events.signal});
  slider.addEventListener('input',()=>{mist.setDensity(Number(slider.value)/100);refresh();},{signal:events.signal});
  window.addEventListener('pagehide',()=>events.abort(),{once:true,signal:events.signal});refresh();
  return {refresh};
}
