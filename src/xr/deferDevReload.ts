type Hot = Pick<NonNullable<ImportMeta['hot']>,'on'|'off'>;
type Session = Pick<XRSession,'addEventListener'|'removeEventListener'>;

/** Vite awaits these hooks. A live headset session must outlive a source edit. */
export function deferDevReload(hot:Hot|undefined,getSession:()=>Session|null,onDeferred:()=>void=()=>{}) {
  let pending:Promise<void>|null=null,release:(()=>void)|null=null;
  const wait=():Promise<void>|undefined=>{
    if(pending)return pending;
    const session=getSession();if(!session)return;
    onDeferred();
    pending=new Promise<void>(resolve=>{
      const finish=()=>{session.removeEventListener('end',finish);pending=null;release=null;resolve();};
      release=finish;session.addEventListener('end',finish,{once:true});
    });
    return pending;
  };
  hot?.on('vite:beforeFullReload',wait);
  hot?.on('vite:beforeUpdate',wait);
  hot?.on('vite:ws:disconnect',wait);
  return {dispose(){
    hot?.off('vite:beforeFullReload',wait);hot?.off('vite:beforeUpdate',wait);hot?.off('vite:ws:disconnect',wait);
    release?.();
  }};
}
