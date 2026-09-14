/** Rebase before entering Canvas implementations that quantize path coordinates to float32. */
export function withCanvasOrigin(ctx:CanvasRenderingContext2D,x:number,y:number,draw:()=>void):void {
  const m=ctx.getTransform();ctx.save();
  ctx.setTransform(m.a,m.b,m.c,m.d,m.a*x+m.c*y+m.e,m.b*x+m.d*y+m.f);
  try {draw();} finally {ctx.restore();}
}
export function composeCanvasTransform(ctx:CanvasRenderingContext2D,a:number,b:number,c:number,d:number,e:number,f:number):void {
  const m=ctx.getTransform();
  ctx.setTransform(m.a*a+m.c*b,m.b*a+m.d*b,m.a*c+m.c*d,m.b*c+m.d*d,m.a*e+m.c*f+m.e,m.b*e+m.d*f+m.f);
}

/** Ordinary painting callbacks keep world coordinates; primitives enter Canvas near zero. */
export function preciseCanvas(ctx:CanvasRenderingContext2D):CanvasRenderingContext2D {
  return new Proxy(ctx,{
    get(target,key){
      if(['fillRect','clearRect','strokeRect'].includes(String(key))) {
        return (x:number,y:number,...args:unknown[])=>withCanvasOrigin(target,x,y,()=>Reflect.apply(Reflect.get(target,key),target,[0,0,...args]));
      }
      if(key==='drawImage')return(...args:unknown[])=>{
        const index=args.length===9?5:1,x=args[index] as number,y=args[index+1] as number;
        args[index]=0;args[index+1]=0;withCanvasOrigin(target,x,y,()=>Reflect.apply(target.drawImage,target,args));
      };
      if(key==='translate')return(x:number,y:number)=>composeCanvasTransform(target,1,0,0,1,x,y);
      if(key==='transform')return(a:number,b:number,c:number,d:number,e:number,f:number)=>composeCanvasTransform(target,a,b,c,d,e,f);
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    },
    set(target,key,value){return Reflect.set(target,key,value,target);},
  });
}
