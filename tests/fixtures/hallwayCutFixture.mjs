// Public fabricated corridor: floor green, ceiling blue, walls orange/purple.
export const hallwayCutMetadata = {cutPlane:{pointRaw:[0,0,0],normalRaw:[0,1,0]},floorFit:{normalRaw:[0,0,1]},walls:{width:2.1}};
export function hallwayCutPoints() {
  const points=[];
  for(let depth=0;depth<=12;depth+=.12) {
    for(let height=0;height<=2.60001;height+=.1) {
      points.push([-1.05,depth,height,.75,.25,.15],[1.05,depth,height,.5,.2,.65]);
    }
    for(let x=-1.05;x<=1.05001;x+=.1) {
      points.push([x,depth,0,.2,.65,.25],[x,depth,2.6,.15,.35,.8]);
    }
  }
  return points;
}
