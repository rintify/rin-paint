import {inverse, transformBounds} from '../geometry/homography';
import type {TextParams} from '../../model';
import {fontFamily} from './render';

export interface TextRun {text:string;x:number;y:number;w:number;h:number;font:string;color:string;size:number;vertical:boolean;sideways:boolean;rtl:boolean}
export interface CanvasTextLayout {width:number;height:number;offsetX:number;offsetY:number;runs:TextRun[]}
const upright=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff01-\uff60]/u;

/** DOM supplies shaping/line/ruby placement; Canvas 2D paints only requested output regions. */
export function measureCanvasText(node:HTMLElement,text:TextParams,ppi:number):CanvasTextLayout {
  const root=node.getBoundingClientRect(), runs:TextRun[]=[];
  const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);
  const range=document.createRange(), measure=document.createElement('canvas').getContext('2d')!;
  const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
  let current:Node|null, fallbackX=0,fallbackY=0,maxX=0,maxY=0,minX=0,minY=0;
  while ((current=walker.nextNode())) {
    const element=current.parentElement!;
    const style=getComputedStyle(element),size=parseFloat(style.fontSize)||text.style.sizeMm*ppi/25.4;
    const font=`${style.fontStyle || 'normal'} ${style.fontWeight || '400'} ${size}px ${style.fontFamily || fontFamily(text.style.fontId)}`;
    const color=style.color || text.style.color,vertical=text.direction==='vertical',rtl=style.direction==='rtl';
    measure.font=font;
    for (const {segment,index} of segmenter.segment(current.textContent ?? '')) {
      if (segment==='\n') {fallbackX=0;fallbackY+=size*text.lineHeight;continue;}
      range.setStart(current,index);range.setEnd(current,index+segment.length);
      const box=range.getBoundingClientRect(), measured=box.width>0 || box.height>0;
      const w=measured?box.width:measure.measureText(segment).width,h=measured?box.height:size;
      const x=measured?box.left-root.left:fallbackX,y=measured?box.top-root.top:fallbackY;
      fallbackX+=w;
      const sideways=vertical && !upright.test(segment);
      const previous=runs.at(-1);
      if (!vertical && previous && previous.font===font && previous.color===color && previous.rtl===rtl && Math.abs(previous.y-y)<.1 && Math.abs(previous.h-h)<.1
        && Math.abs(rtl ? x+w-previous.x : previous.x+previous.w-x)<1) {
        previous.text+=segment;const right=Math.max(previous.x+previous.w,x+w);previous.x=Math.min(previous.x,x);previous.w=right-previous.x;
      } else runs.push({text:segment,x,y,w,h,font,color,size,vertical,sideways,rtl});
      minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x+w);maxY=Math.max(maxY,y+h);
    }
  }
  const width=text.width ?? Math.max(root.width,maxX,1),height=text.height ?? Math.max(root.height,maxY,1);
  return {width,height,offsetX:-Math.min(0,minX),offsetY:-Math.min(0,minY),runs};
}

export function drawCanvasText(ctx:CanvasRenderingContext2D,layout:CanvasTextLayout):void {
  const view=ctx.getTransform(),inv=inverse([view.a,view.c,view.e,view.b,view.d,view.f,0,0,1]);
  const viewport=inv && transformBounds(inv,{x:0,y:0,w:ctx.canvas.width,h:ctx.canvas.height});
  if (!viewport) return;
  const {x:minX,y:minY}=viewport,maxX=minX+viewport.w,maxY=minY+viewport.h;
  for (const run of layout.runs) {
    if (run.x+run.w+run.size<minX || run.x-run.size>maxX || run.y+run.h+run.size<minY || run.y-run.size>maxY) continue;
    ctx.save();ctx.font=run.font;ctx.fillStyle=run.color;ctx.direction=run.rtl?'rtl':'ltr';ctx.textBaseline='alphabetic';
    const metrics=ctx.measureText(run.text),ascent=metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent,descent=metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent;
    if (run.sideways) {
      ctx.translate(run.x+run.w/2,run.y+run.h/2);ctx.rotate(Math.PI/2);ctx.textAlign='center';
      ctx.fillText(run.text,0,(ascent-descent)/2);
    } else if (run.vertical) {
      ctx.textAlign='center';ctx.fillText(run.text,run.x+run.w/2,run.y+(run.h-ascent-descent)/2+ascent);
    } else {
      ctx.textAlign=run.rtl?'right':'left';ctx.fillText(run.text,run.rtl?run.x+run.w:run.x,run.y+(run.h-ascent-descent)/2+ascent);
    }
    ctx.restore();
  }
}
