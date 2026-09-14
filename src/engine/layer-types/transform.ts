import type { TransformState } from '../../model';
import { IDENTITY, inverse, multiply, rotation, scaling, type Homography } from '../geometry/homography';
import { warpCanvas } from '../geometry/warpCanvas';
import { buildCatalog } from '../parameters/catalog';
import type { ParameterDefinition } from '../parameters/types';
import type { LayerDefinition } from './definition';

const clone = (state: TransformState): TransformState => ({matrix:[...state.matrix]});
const field = (id: string, label: string, read: (h: Homography) => number, write: (h: Homography,v: number) => Homography): ParameterDefinition<TransformState> => ({
  id, semanticId: `transform.${id}`, groupId: 'transform', label, editor: {kind:'number'}, surfaces:['single','multi','link'],
  read: state => read(state.matrix), write: (state,value) => {
    const matrix=write(state.matrix,Number(value));
    return inverse(matrix) ? {matrix} : state;
  },
});
const component = (h: Homography, index: number, value: number): Homography => h.map((v,i)=>i===index?value:v) as unknown as Homography;
export const transformLayerType: LayerDefinition<'transform'> = {
  info:{type:'transform',canMask:false,maskSourceLabel:null,supportsBlend:false,defaultName:index=>`トランスフォーム ${index}`},
  state:{initial:()=>({matrix:[...IDENTITY]}),clone,normalize:clone,applyPatch:(s,p)=>clone({...s,...p}),scale:clone},
  codec:{encode:clone,decode:value=> {
    const matrix=(value as TransformState | null)?.matrix;
    return Array.isArray(matrix)&&matrix.length===9&&matrix.every(Number.isFinite)&&inverse(matrix) ? {matrix:[...matrix] as unknown as Homography} : null;
  }},
  renderer:{draw(){},bakeOnto(){},contentCanvas:()=>null,effect:{apply(scope,layer,env){
    const output=env.borrowCanvas(scope.width,scope.height);
    const px=env.ppi/25.4;
    const matrix=multiply(scaling(px),multiply(layer.state.matrix,scaling(1/px)));
    warpCanvas(scope.canvas,output.ctx,matrix,{x:scope.x,y:scope.y},{x:scope.x,y:scope.y},scope.width,scope.height);
    const ctx=scope.canvas.getContext('2d')!;
    ctx.clearRect(0,0,scope.canvas.width,scope.canvas.height);ctx.drawImage(output.canvas,0,0);output.release();
  }}},
  parameters:buildCatalog([{id:'transform',label:'変形'}],[
    field('xMm','移動 X (mm)',h=>h[2],(h,v)=>component(h,2,v)),
    field('yMm','移動 Y (mm)',h=>h[5],(h,v)=>component(h,5,v)),
    field('rotation','回転 (°)',h=>Math.atan2(h[3],h[0])*180/Math.PI,(h,v)=>{
      const next=multiply(rotation(v*Math.PI/180-Math.atan2(h[3],h[0])),h);
      return component(component(next,2,h[2]),5,h[5]);
    }),
    field('scaleX','横倍率',h=>Math.hypot(h[0],h[3]),(h,v)=>component(component(h,0,h[0]*v/Math.hypot(h[0],h[3])),3,h[3]*v/Math.hypot(h[0],h[3]))),
    field('scaleY','縦倍率',h=>Math.hypot(h[1],h[4]),(h,v)=>component(component(h,1,h[1]*v/Math.hypot(h[1],h[4])),4,h[4]*v/Math.hypot(h[1],h[4]))),
    field('shear','横せん断',h=>h[1],(h,v)=>component(h,1,v)),
    field('perspectiveX','遠近 X (1/mm)',h=>h[6],(h,v)=>component(h,6,v)),
    field('perspectiveY','遠近 Y (1/mm)',h=>h[7],(h,v)=>component(h,7,v)),
  ]),capabilities:{},
};
