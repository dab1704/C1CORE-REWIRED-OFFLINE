const hero = document.querySelector('.hero');
const canvas = document.getElementById('signal-canvas');
const ctx = canvas.getContext('2d');
const gate = matchMedia('(prefers-reduced-motion: reduce)');
const replay = document.getElementById('replay');
const phase = document.getElementById('signal-phase');
const chars = '@#%+=:·01/';
const clamp = n => Math.max(0, Math.min(n, 1));
const smooth = n => { n = clamp(n); return n*n*(3-2*n); };
const mix = (a,b,t) => a+(b-a)*t;
let clock, w, h, introFrame = 0, introVisible = true;
const points = [];
for (let layer=0;layer<3;layer++) {
  for (let row=0;row<32;row++) {
    for (let col=0;col<23;col++) {
      const edge = col===0||col===22||row===0||row===31;
      const headline = row>=5&&row<=7&&col>2&&col<19;
      const form = [12,15,18,21,25,28].includes(row)&&col>2&&col<20-(row%4);
      const selected = row>=17&&row<=19&&col>=2&&col<=20;
      if(layer===0 ? edge||headline||form||selected : edge||((row+col)%17===0)) {
        const index = points.length, random = ((index*2377)%997)/997;
        points.push({x:col-11,y:row-15.5,z:layer*2.8,layer,row,col,selected,random});
      }
    }
  }
}
function paint(ms) {
  const t=clamp(ms/3500);
  const gather=smooth((t-.09)/.57), turn=smooth((t-.46)/.54);
  const yaw=-.48+turn*.83, pitch=.18-turn*.27;
  const c=Math.cos(yaw),s=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
  ctx.fillStyle='#101111';ctx.fillRect(0,0,w,h);
  const step=w>500?30:22;
  ctx.strokeStyle='#b3b6be13';ctx.lineWidth=1;
  for(let x=0;x<w;x+=step){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}
  for(let y=0;y<h;y+=step){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
  const ix= w*.51, iy=h*.50, size=Math.min(w/35,h/42);
  ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='600 '+Math.max(8,size*.9)+'px monospace';
  const scan= -17+turn*38;
  for(const p of points) {
    const separated = turn * p.layer;
    const x0=p.x + separated*3.4;
    const y0=p.y-sepY(p.layer,turn);
    const z0=p.z + separated*1.4;
    const x=x0*c+z0*s, rz=-x0*s+z0*c;
    const y=y0*cp-rz*sp, depth=y0*sp+rz*cp;
    const perspective= Math.max(.62,Math.min(1.35,90/(90+depth)));
    const sx=mix((((p.row*347+p.col*231+p.layer*719)%907)/907)*w,ix+x*size*perspective,gather);
    const sy=mix((((p.row*761+p.col*423+p.layer*457)%911)/911)*h,iy+y*size*perspective,gather);
    const bright=p.selected||Math.abs(p.y-scan)<1.2;
    ctx.globalAlpha=(p.layer===0?.95:.38)*mix(.27,1,gather);
    ctx.fillStyle=bright?'#f6f3e8':p.layer===0?'#b0bdf4':'#6878a0';
    const seq=t>.85?0:Math.floor(ms/67);
    ctx.fillText(chars[(Math.floor(p.random*chars.length)+seq)%chars.length],sx,sy);
  }
  ctx.globalAlpha=1;
}
function sepY(layer,t) { return layer===1?t*5:layer===2?-t*3:0; }
function resize() {
  const rect=canvas.getBoundingClientRect();
  const scale=Math.min(devicePixelRatio,2);
  w=rect.width;h=rect.height;
  canvas.width=Math.round(w*scale);canvas.height=Math.round(h*scale);
  ctx.setTransform(scale,0,0,scale,0,0);
  paint(gate.matches||!clock?3500:performance.now()-clock);
}

new ResizeObserver(resize).observe(canvas);resize();
const opening=document.getElementById('intro-screen');
const fullSignal=document.getElementById('intro-canvas');
const fullContext=fullSignal.getContext('2d');
let openingRun=0,openingTimer=0,openingAnimation=0;
function sizeFullSignal(){
  const scale=Math.min(devicePixelRatio,1.7);
  fullSignal.width=Math.round(innerWidth*scale);
  fullSignal.height=Math.round(innerHeight*scale);
  fullContext.setTransform(scale,0,0,scale,0,0);
}
function finishOpening(){
  openingRun++;
  cancelAnimationFrame(openingAnimation);
  clearTimeout(openingTimer);
  opening.hidden=true;
  opening.classList.remove('signal','cut');
  document.documentElement.classList.remove('opening');
  paint(3500);
}
function fillOpening(ms){
  const ww=innerWidth,hh=innerHeight;
  const sec=clamp(ms/1850),g=smooth((sec-.07)/.65);
  const film=fullContext;
  film.fillStyle='#11131a';film.fillRect(0,0,ww,hh);
  const step=ww<500?26:39;
  film.strokeStyle='#7d8cb22d';film.lineWidth=1;
  for(let x=0;x<ww;x+=step){film.beginPath();film.moveTo(x,0);film.lineTo(x,hh);film.stroke();}
  for(let y=0;y<hh;y+=step){film.beginPath();film.moveTo(0,y);film.lineTo(ww,y);film.stroke();}
  const scale=Math.min(ww/41,hh/40), angle=-.68+g*.84;
  const centerX=ww*.52,centerY=hh*.49;
  film.textAlign='center';film.textBaseline='middle';film.font= '600 '+Math.max(9,scale*.75)+'px monospace';
  for(const p of points){
    const z=p.z+g*p.layer*3;
    const mx=centerX+(p.x*Math.cos(angle)+z*Math.sin(angle)+g*p.layer*2.6)*scale;
    const my=centerY+(p.y-g*p.layer*2)*scale;
    const x=mix(p.random*ww,mx,g),y=mix(((p.row*761+p.col*423+p.layer*457)%911)/911*hh,my,g);
    film.globalAlpha=(p.layer===0?.87:.42)*mix(.38,1,g);
    film.fillStyle=p.selected?'#f2e3b5':'#b1bcfb';
    film.fillText(chars[(Math.floor(p.random*chars.length)+Math.floor(ms/64))%chars.length],x,y);
  }
  film.globalAlpha=1;
}
function playIntro(){
  finishOpening();
  if(gate.matches)return;
  const run=++openingRun;
  opening.hidden=false;
  document.documentElement.classList.add('opening');
  sizeFullSignal();
  openingTimer=setTimeout(()=>{
    if(run!==openingRun)return;
    opening.classList.add('signal');
    const started=performance.now();
    function frame(now){
      if(run!==openingRun)return;
      const elapsed=now-started;
      fillOpening(elapsed);
      if(elapsed>1350)opening.classList.add('cut');
      if(elapsed<2000){openingAnimation=requestAnimationFrame(frame);return;}
      finishOpening();
    }
    openingAnimation=requestAnimationFrame(frame);
  },420);
}
window.addEventListener('resize',()=>{if(!opening.hidden)sizeFullSignal();});
window.addEventListener('keydown',event=>{if(event.key==='Escape'&&!opening.hidden)finishOpening();});
replay.addEventListener('click',playIntro);
gate.addEventListener('change',()=>{if(gate.matches)finishOpening();});
sizeFullSignal();
if(gate.matches)finishOpening();else playIntro();

const atlasCanvas=document.getElementById('atlas-canvas');
const atlasStage=document.querySelector('.atlas-stage');
const atlasPoster=document.querySelector('.atlas-poster');
const atlasLabel=document.getElementById('atlas-label');
const atlasSwitch=document.getElementById('atlas-layer');
const atlasCard=document.getElementById('atlas-region');
const atlasDescription=document.getElementById('atlas-description');
const atlasInfo={
  bone:['Skeleton','Bones support the body and give muscles anchor points.'],
  other:['Musculature','Skeletal muscles pull on bones and help stabilize joints.'],
  chest:['Pectorals','Chest muscles help bring the upper arm forward and across the body.'],
  shoulder:['Deltoids','These shoulder muscles help lift the upper arm away from the body.'],
  arm:['Arm muscles','Muscles around the upper arm and forearm bend or straighten the elbow and move the wrist.'],
  core:['Abdominal wall','These muscles help move and stabilize the trunk and support the abdominal contents.'],
  back:['Back muscles','Different groups help hold the trunk upright and move the shoulder blades.'],
  thigh:['Anterior thigh','The quadriceps at the front of the thigh straighten the knee.'],
  posterior:['Posterior thigh and glutes','The hamstrings help bend the knee. The gluteal muscles move and stabilize the hip.'],
  calf:['Lower leg','Calf muscles help point the foot downward and push off the ground.']
};
let atlasState=null,atlasLoaded=false,atlasError='';
function makeAtlas(gl,binary,layouts){
  const geometryVS=`#version 300 es
in vec3 aPosition;
in vec3 aNormal;
uniform vec2 angles;
uniform float aspect;
uniform vec2 framing;
out vec3 normal;
vec3 rotate(vec3 p){
  float x=cos(angles.x),s=sin(angles.x),y=cos(angles.y),t=sin(angles.y);
  vec3 q=vec3(x*p.x+s*p.z,p.y,x*p.z-s*p.x);
  return vec3(q.x,y*q.y-t*q.z,t*q.y+y*q.z);
}
void main(){
  vec3 p=rotate(aPosition*1.21359);
  normal=rotate(aNormal);
  float eye=2.9-p.z;
  gl_Position=vec4(p.x*2.64*framing.x/aspect,p.y*2.64*framing.x+framing.y*eye,-p.z*.65*eye,eye);
}`;
  const geometryFS=`#version 300 es
precision highp float;
in vec3 normal;
uniform float id;
out vec4 pixel;
void main(){pixel=vec4(normalize(normal)*.5+.5,id/255.);}`;
  const quadVS=`#version 300 es
out vec2 point;
void main(){
  vec2 q=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));
  point=q;
  gl_Position=vec4(q*2.-1.,0.,1.);
}`;
  const quadFS=`#version 300 es
precision highp float;
in vec2 point;
uniform sampler2D surface;
uniform vec2 resolution;
uniform float selected;
out vec4 pixel;
vec3 plate(vec2 p){
  vec2 q=(p-.5)*vec2(resolution.x/resolution.y,1.);
  float disk=exp(-dot(q,q)*4.4);
  float ring=1.-smoothstep(.001,.004,abs(length(q*vec2(1.,.90))-.47));
  float stripe=1.-smoothstep(.001,.004,abs(p.y-.48));
  float minor=1.-smoothstep(.0007,.0022,abs(p.y-.51));
  float ticks=1.-smoothstep(.03,.08,abs(fract(p.x*37.)-.5));
  vec3 base=vec3(.038,.042,.043)+disk*vec3(.044,.050,.056);
  return base+ring*vec3(.065,.063,.052)+stripe*vec3(.105,.112,.108)+minor*ticks*vec3(.13);
}
void main(){
  vec4 hit=texture(surface,point);
  vec3 base=plate(point);
  if(hit.a<.001){pixel=vec4(base,1.);return;}
  vec3 n=normalize(hit.rgb*2.-1.);
  float facing=clamp(n.z,0.,1.);
  float rim=pow(1.-facing,2.65);
  vec2 deflect=n.xy*(.024+.036*rim);
  vec2 dispersion=n.xy*(.0035+.0075*rim);
  vec3 frosted=vec3(0.);
  for(int i=0;i<24;i++){
    float f=float(i),a=f*2.39996323;
    vec2 disc=vec2(cos(a),sin(a))*sqrt((f+.5)/24.)*(.003+.006*(1.-facing));
    vec2 p=point+deflect+disc;
    frosted+=vec3(plate(p+dispersion).r,plate(p).g,plate(p-dispersion).b);
  }
  frosted/=24.;
  vec3 top=normalize(vec3(-.38,.72,.57)),right=normalize(vec3(.90,.15,.42));
  float softbox=pow(max(dot(n,top),0.),17.)*.86+pow(max(dot(n,right),0.),23.)*.64;
  float sheen=pow(max(dot(n,normalize(vec3(.20,-.58,.76))),0.),13.)*.24;
  bool highlight=abs(hit.a*255.-selected)<.44;
  vec3 tint=highlight?vec3(.95,.37,.50):vec3(.57,.66,.72);
  vec3 fringe=vec3(.58,.69,.90)+vec3(.25,.14,0.)*max(n.x,0.);
  vec3 fill=frosted*1.75+tint*(.07+pow(facing,.7)*.14);
  fill+=(softbox+sheen)*mix(vec3(.76,.83,.89),tint,highlight?.57:.12);
  fill+=rim*fringe*(.42+max(n.y,0.)*.19);
  if(highlight)fill+=vec3(.28,.05,.09)*(.38+facing);
  pixel=vec4(fill,1.);
}`;
  function program(vs,fs){
    const result=gl.createProgram();
    for(const [type,text] of [[gl.VERTEX_SHADER,vs],[gl.FRAGMENT_SHADER,fs]]){
      const shader=gl.createShader(type);gl.shaderSource(shader,text);gl.compileShader(shader);
      if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));
      gl.attachShader(result,shader);
    }
    gl.linkProgram(result);
    if(!gl.getProgramParameter(result,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(result));
    return result;
  }
  const geo=program(geometryVS,geometryFS),finish=program(quadVS,quadFS);
  const vao=gl.createVertexArray();
  const geoPosition=gl.getAttribLocation(geo,'aPosition'),geoNormal=gl.getAttribLocation(geo,'aNormal');
  const angles=gl.getUniformLocation(geo,'angles'),aspect=gl.getUniformLocation(geo,'aspect'),id=gl.getUniformLocation(geo,'id');
  const framing=gl.getUniformLocation(geo,'framing');
  const screen=gl.getUniformLocation(finish,'resolution'),selected=gl.getUniformLocation(finish,'selected');
  const parts=layouts.map(([name,offset,values,count],index)=>{
    const vertex=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,vertex);
    gl.bufferData(gl.ARRAY_BUFFER,new Int16Array(binary,offset,values),gl.STATIC_DRAW);
    const element=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,element);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint32Array(binary,offset+values*2,count),gl.STATIC_DRAW);
    return {name,vertex,element,count,id:index+1};
  });
  const fb=gl.createFramebuffer(),mask=gl.createTexture(),depth=gl.createRenderbuffer(),sample=new Uint8Array(4);
  gl.bindTexture(gl.TEXTURE_2D,mask);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  function resize(w,h){
    gl.bindTexture(gl.TEXTURE_2D,mask);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.bindRenderbuffer(gl.RENDERBUFFER,depth);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,w,h);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,mask,0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,depth);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('glass framebuffer unavailable');
  }
  function draw(yaw,pitch,bones,target,highlight){
    const w=atlasCanvas.width,h=atlasCanvas.height;
    gl.viewport(0,0,w,h);gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.BLEND);gl.enable(gl.DEPTH_TEST);gl.useProgram(geo);gl.bindVertexArray(vao);
    gl.uniform2f(angles,yaw,pitch);gl.uniform1f(aspect,w/h);
    gl.uniform2f(framing,w/h<.95?.78:1,w/h<.95?-.18:0);
    for(const part of parts){
      if(bones&&part.name!=='bone')continue;
      gl.bindBuffer(gl.ARRAY_BUFFER,part.vertex);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,part.element);
      gl.enableVertexAttribArray(geoPosition);gl.vertexAttribPointer(geoPosition,3,gl.SHORT,true,12,0);
      gl.enableVertexAttribArray(geoNormal);gl.vertexAttribPointer(geoNormal,3,gl.SHORT,true,12,6);
      gl.uniform1f(id,part.id);gl.drawElements(gl.TRIANGLES,part.count,gl.UNSIGNED_INT,0);
    }
    let hit=0;
    if(target){
      gl.readPixels(Math.max(0,Math.min(w-1,Math.floor(target.x*w))),Math.max(0,Math.min(h-1,Math.floor((1-target.y)*h))),1,1,gl.RGBA,gl.UNSIGNED_BYTE,sample);
      hit=sample[3];
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.disable(gl.DEPTH_TEST);gl.useProgram(finish);gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,mask);
    gl.uniform2f(screen,w,h);gl.uniform1f(selected,hit||highlight||-1);
    gl.drawArrays(gl.TRIANGLES,0,3);
    return hit;
  }
  return {resize,draw,parts};
}
let isAtlasVisible=false, anatomyLoading=false;
let orbitYaw=.1, pointerYaw=0,pointerPitch=0,yaw=.1,pitch=0,drag=null,pointerNormal=null,hover=0,pinned=0,skeleton=false,scheduledAtlas=0;
let pinnedPoint=null;
function displayRegion(id,point){
  const name=atlasState?.parts.find(part=>part.id===id)?.name;
  const info=atlasInfo[name];
  atlasCard.hidden=!info||!point;
  if(atlasCard.hidden)return;
  if(atlasLabel.textContent!==info[0]){
    atlasLabel.textContent=info[0];atlasDescription.textContent=info[1];
  }
  const width=atlasStage.clientWidth,height=atlasStage.clientHeight;
  const cardWidth=atlasCard.offsetWidth,cardHeight=atlasCard.offsetHeight;
  const x=point.x*width,y=point.y*height;
  const left=x+cardWidth+25<width?x+22:x-cardWidth-18;
  atlasCard.style.setProperty('--atlas-left',Math.max(12,Math.min(left,width-cardWidth-12))+'px');
  atlasCard.style.setProperty('--atlas-top',Math.max(12,Math.min(y+15,height-cardHeight-12))+'px');
}
function frameAtlas(){
  scheduledAtlas=0;
  if(!isAtlasVisible||!atlasState)return;
  const step=gate.matches?1:.16;
  const tx=orbitYaw+pointerYaw,ty=pointerPitch;
  yaw+=(tx-yaw)*step;pitch+=(ty-pitch)*step;
  hover=atlasState.draw(yaw,pitch,skeleton,drag?null:pointerNormal,pinned);
  displayRegion(hover||pinned,hover?pointerNormal:pinnedPoint);
  if(Math.abs(tx-yaw)>.003||Math.abs(ty-pitch)>.003)requestAtlas();
}
function requestAtlas(){if(!scheduledAtlas)scheduledAtlas=requestAnimationFrame(frameAtlas);}
function sizeAtlas(){
  if(!atlasState)return;
  const rect=atlasCanvas.getBoundingClientRect();
  if(!rect.width||!rect.height)return;
  const quality=Math.min(devicePixelRatio,1.45,1080/rect.width,860/rect.height);
  atlasCanvas.width=Math.round(rect.width*quality);atlasCanvas.height=Math.round(rect.height*quality);
  atlasState.resize(atlasCanvas.width,atlasCanvas.height);requestAtlas();
}
async function initAtlas(){
  if(anatomyLoading||atlasLoaded)return;
  anatomyLoading=true;
  try{
    const gl=atlasCanvas.getContext('webgl2',{alpha:false,antialias:false,powerPreference:'high-performance'});
    if(!gl)throw Error('WebGL2 unavailable');
    const model=await fetch('/nabz/anatomy-mesh.bin');
    if(!model.ok||!model.body)throw Error('Anatomy mesh unavailable');
    const binary=await new Response(model.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    atlasState=makeAtlas(gl,binary,[["bone", 0, 766614, 763974], ["other", 4589124, 948312, 946074], ["thigh", 10270044, 106812, 106530], ["arm", 10909788, 154188, 153972], ["posterior", 11834052, 60720, 60498], ["core", 12197484, 570804, 604332], ["chest", 15756420, 46680, 46386], ["back", 16035324, 181932, 181620], ["calf", 17125668, 65724, 65640], ["shoulder", 17519676, 14220, 14352]]);
    atlasLoaded=true;atlasStage.classList.add('live');sizeAtlas();
    atlasCanvas.addEventListener('webglcontextlost',()=>{atlasStage.classList.remove('live');atlasCard.hidden=true;});
  }catch(error){
    atlasError=error.message;atlasCard.hidden=true;atlasSwitch.hidden=true;
    console.warn('Glass anatomy preview:',error.message);
  }
}
new IntersectionObserver(([entry])=>{
  isAtlasVisible=entry.isIntersecting;
  if(isAtlasVisible){initAtlas();requestAtlas();}
},{rootMargin:'100px'}).observe(atlasStage);
new ResizeObserver(sizeAtlas).observe(atlasStage);
function pointerAt(event){
  const rect=atlasCanvas.getBoundingClientRect();
  return {x:(event.clientX-rect.left)/rect.width,y:(event.clientY-rect.top)/rect.height};
}
atlasCanvas.addEventListener('pointerdown',event=>{
  if(!atlasLoaded)return;
  drag={id:event.pointerId,x:event.clientX,y:event.clientY,angle:orbitYaw,moved:false};atlasCanvas.setPointerCapture(event.pointerId);
});
atlasCanvas.addEventListener('pointermove',event=>{
  if(!atlasLoaded)return;
  if(drag){
    const delta=event.clientX-drag.x;
    if(Math.abs(delta)>5)drag.moved=true;
    if(drag.moved){orbitYaw=drag.angle+delta*.010;pointerYaw=0;pointerPitch=0;pointerNormal=null;requestAtlas();return;}
  }
  pointerNormal=pointerAt(event);
  if(!gate.matches&&event.pointerType==='mouse'){pointerYaw=(pointerNormal.x-.5)*.26;pointerPitch=(.5-pointerNormal.y)*.13;}
  requestAtlas();
});
atlasCanvas.addEventListener('pointerup',event=>{
  if(!atlasLoaded)return;
  if(drag&&!drag.moved){
    const point=pointerAt(event);
    pinned=atlasState.draw(yaw,pitch,skeleton,point,0);pinnedPoint=pinned?point:null;
    pointerNormal=event.pointerType==='mouse'?point:null;
  }
  drag=null;requestAtlas();
});
atlasCanvas.addEventListener('pointerleave',()=>{pointerNormal=null;pointerYaw=0;pointerPitch=0;requestAtlas();});
atlasCanvas.addEventListener('pointercancel',()=>{drag=null;pointerNormal=null;requestAtlas();});
atlasCanvas.addEventListener('keydown',event=>{
  if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();orbitYaw+=(event.key==='ArrowLeft'?-.30:.30);requestAtlas();}
});
atlasSwitch.addEventListener('click',()=>{
  skeleton=!skeleton;hover=0;pinned=0;pinnedPoint=null;pointerNormal=null;
  atlasSwitch.setAttribute('aria-pressed',String(skeleton));atlasSwitch.textContent=skeleton?'Show muscles':'Show bones';requestAtlas();
});

const deckRegion=document.getElementById('patient-roll'),deck=document.getElementById('patient-deck');
const caseData=[
  ['Asha R.','Lab flag on report','crimson','Potassium report','Compare the extracted value with the source before recording follow-up.'],
  ['Ravi S.','Needs verification','mustard','Cropped haemoglobin report','Request the full image so the unit can be checked.'],
  ['Meera K.','Reviewed','blue','Repeat lab report','The clinician recorded a follow-up for this report.'],
  ['Dev P.','Awaiting review','blue','Lipid panel','Open the source report and record the next action.'],
  ['Ira N.','Patient match needed','mustard','Report from a shared number','Confirm who the report belongs to before adding it to history.'],
  ['Kabir A.','Follow-up pending','crimson','Follow-up blood test','The report was acknowledged. The follow-up still needs an owner.']
];
const glyphs=["                                                          \n                        .......                           \n                      .,,..,:irri:...                     \n                    ...    ::,:;sr;,.:.                   \n                   .     ,::;,  ,;i;,,:..                 \n                         ,;;rs;.  ,i;,,,  .               \n                       .;rsX235Ar;,:;i..   .              \n                      ;X53hMHHHHhhA,:;;.                  \n                     :rA3hMHHGGSS#HX,.,:::,               \n                    .isA5hhMHGGGS##HX  :,,.               \n                    iX25hHHGGGS#9BBB#h;.:,,.              \n                  .isssXA5hMHHM32AA53h3i;.,               \n                  :;iii;,,:s3G3si;r2hMMAi;                \n                 .:;:::;Xr,,29SA;;,iXrAXrX  ,.            \n                 ,i;..::Xs::2#SMArrX55MhXX,.Xi            \n              .. :rAAsXXXXsr2#9##GHGS#99Ms,s2s .          \n              .: :X23MMh35sXh#B##BB9B&&9S5;i5r  .         \n               ,..rX2hMM3Asr2H#HGMG9BB9#G2s55;            \n                ;,;rX2335si:;X3hG#HGSSSSHA5GA,,           \n                i;:irXA22AAX23hGSSGHHGGHM255, ,           \n                 ,,iirssXi;;isA222X3HHHGMr .. .           \n                   :irrXXriisA2hhMM3HGGH2,..:.            \n                    ,iirrssXXAA5MHGHMMhA;,,,i;            \n                     ::;irX2hHGS#SGM525s..,:::,           \n                     ::,,:irA525332XA3Ms   ,...           \n                     :;;,,,,:;;irsA5hHHs  ...             \n                     :;ii;::;isX23hHHHH5. .    .          \n                  ,:;;iirri;is23hMMHHHMM3Ai,              \n              .. rsriiirrssirX23MMHHMMMMHMhh3X.,.         \n          ,:,,:, iXsiirirXAAXX23MHHMhMHHGGGGS3:iAi;,      \n     .:ii:;;;,:, ::;irrr;rA55223hMMMMHGSS#SShrisA;rXri;.  \n  ,;:iiriri;i,.,:,  :sA2XrXhMMh33HGSSSSSS3AsrsA2i;XXXirrr;\n:irisrrs;iii:::::,. :233555MSGHhHS##SSSSH;rXsXss,rAsXiXXsr\n;;;:iiir;;ii.i;,:,.  s5553MMMMhhMhHHHHHHHr::;irs,irsi:srrr", "                              .                           \n                      .,,,:,,,. .,..                      \n                   ,. ,,:,,,:::..,, .,.                   \n                 .,,,:      . :,,,. .,,                   \n                ,...,:        .. ,  ,,  ...               \n               .,  .  .   .,          , ,,:               \n              .        .  ,,::;;;;:.     ,::              \n              .     ,,.. ,isA533hh32Ai,  :::              \n                   ,rriisAA53hHMMMHGGhA..:,.              \n                  .rsA253hMMMMMHGSSGGGhs,,.,,             \n                  iXA2553MHGHHMSSGHh5hH3,                 \n                 .ri;:::,:irAhsr;,;sAAX3A                 \n                 :i..:iisi. rHhr,;:XAs233.                \n                 ;si,.::AA:,AGG3XrrA2AMGHi i.             \n              ;: iA32sssss;r3SSGHMhhMGGSHsAMX             \n             ,:i.iX23hh33AX2M#9SS##S###SH23GM.            \n              i;.rsXA3MM3XX;i25XhSS999SGH52H3             \n              ;r::rsX25332r .i;;ASS##SGGMX5Hi             \n               Xs.;ssXAAsi, :;:::iX3GGGH5r3M              \n               rs..:rss,  ,;sXA2X; ,3M32XiXi              \n                   .,;i.:rrrXss23M5:25Xsi:                \n                     .,.;rriiir2hM3ssXr;:                 \n                        .irXX253hhAi:;,:,                 \n                  .;.    ..,:,,:;ii,  ,5X                 \n                ;i :i,               r3HsAi               \n              ,sX: ,ri,          .,;XhHMi23s              \n             :XAs. ,iiri:,..:;rXAA5hHHH3:A32AXi:          \n        .;;;issXs: .;iiri:::;s555hHGHGHriA5XA2Asssi,      \n     :isXr,:issssr,.;;;isr;;;iX25hMHHHA rAXX552s:X2AXsi,  \n  ;rsssss,,issrsXXs:;ri;rXXrsA23hMMMhA. ii  i55X,r2XXAAAXi\nsXXXssrsr:;rsrsrsAAs;X2sis252253hMM3A;  ;;   X2A:i2AssXXsr\nssssssrsr;;ssr; :2AXrs532A5hMMhhhMM5i:  ;AsisAAA;i2AXsrXXr\nssssrrssri;i:    iXsAss5MMHHHGHHMMhXrri:;AXAAAAAir2AXXrrsr\nirri;rsriiii;,,.    ;srr2hHMMMMh32siirrsssrsssssirXXssrirr", "                                                          \n                        .:;:,,,..                         \n                     .;i;:,..:;;;;.                       \n                  .,;ri,   .,:;;;iii;                     \n                .,;r;.  ...;i;;,..:rAX,                   \n               .,,;;:;:isAAXXAA2As;,i2s .,                \n              :.   ;;:isXA53hhMHHHM5r;Ar. ..              \n             :,.   .,:rX553hMHHGGS#SHX;i;;;:,             \n            ,,       :sA53hhMHGGGS##SH5,,rsi;             \n            .       ,s253hHHGGGGS#99#SG5:,:,:.            \n           .       :s2XsrX2hHHMGHM3553hH5,. ..            \n                  .;rrrsr;::r2HH2Xrs5MHhhr...,.           \n                  :r;;i;r2s; sH#5r;:r22hG5  ...           \n                 ,ss;:::;2X;,AGShXris52hGH,  ,.           \n           ,...  ;X22AXssXXrs2G#SGM3hMHGSGi,,::           \n          ,:,.   :sA53hh335sXhS99###SS###GAi,.,           \n         .,.  .  :rXA5hMMhssri2HhHMH#999SG5A,             \n           ...,:.:isX253hhXr:;XhhhShH###SH5r,             \n             ..ii:irrsA22222A5MhS##GhMGSGM5,              \n               .riiiirsXsr;;;rX255553hHGGMX               \n                  :riirXAsiiiX25hMMh5HGGGA                \n                   :iiirsssXXA223HGSHMHG2                 \n                   ,;;;;irrA5hHGSSSGHMMX                  \n                   .;:,:,:;isA553hh5A5M;                  \n                   .i;:,,,,,,:;;irsAhGS;                  \n                  ,iiii;:,,,:;rs25hHGSSs                  \n             .:irssrirrrri;;;rA3hMGSSSGM5Xr:              \n         ,iX222AXssrirssXXrirX2hHGGGGGHHHMHHHhA;          \n     .;A53hhh335AAXsrrrsA22XA23MHGGGGGHGGGGGSGM2A2AAr;,   \n .:;;;;sMHMhMhh33552AssrrA3hh3hMHGGHHGGGHh352ssXAX2XA5AXs;\niii;;;;:iMGMMhMh35533552AX5HGSGHHGGGHM3552AArsXAXAAA5AAAXX\n;;;;;;;;:iMGMMhMh333333hhMMHSSSGGGM355552srrsrAAX2X52X5AAX\n:::::,:;;;rHGHMMMMMMMMMMMGGGGGHM3555352XssrssX2X2A53X22A2X\n.,,,:,..:;:ihMhhhhhhhhhhhMMh3222AAA2AsrrrirriAssAs5AsAsXAr", "                           ,,                             \n                    r252AX5h32Xr;.                        \n                  :s3MhhhHHh553hh5Xi:                     \n                 :X2AA22525522AAAAX22Xr.                  \n                .A3225222AA53333522AXA2Ai                 \n                r22AA25h35333hMhhhh52AA5h2,               \n               .A2rsXA5253hMMHGGGSSHh2A2HSh,              \n               s5XirXXAA53MMHHHMMHHGHh22M9Ss              \n              .A2XiisX2253MHHMMMGSSGHM52hHS3              \n              ,2Xr:;sXA223hHMH3MMMhh33522HGM:             \n              ,AX;:isXXsrrrrsM5r;;iX22A22MGM,             \n               rAi:;:;iirri.;MH2i;;isXA25GSM,             \n               :XXii,,..;X;.XGM35XX533hM5HS2;             \n               :X5isXriii;:rMGH33h53HHHGhhS3X             \n               :r2;s22AsirrAH#9GMhGGGGMH353M5             \n               ;;i;;rssXAsr;s3M55h2M#SHh55HMr             \n               .rri;rrA52;;irs2hMSGXhGMM33M3              \n                iXrissA2A5hHHM5HS99BMMMH33M5              \n                .srrrXXshHh2srssX25G9HMh332;              \n                 :;iisss3A;;isA53352MHMM32.               \n                   :;rsAAXAXXA223HHHhhhh2i                \n                    ;irrsAX253MHHHMMM335X;                \n                   si:;iirsXA533hMhh5X25r2i               \n                 :5A.;::,,:::;rrrssriX5h;:M;              \n                sh3; ;;:,........:irA5hM:;hH2s,           \n            ,iA3Mh5: .;:::,,,;i:,sA23hM5,AhG##SH3X:       \n        ;X5h5hGHMh5r .;ii;;::rsr,rA5h3hsrMMHS###S99ShX:   \n     i2MGSH55GGHHMMh; :irrr;:i;r;i53335i2HHHS###MGG#999HA,\n .r5MGGGGM52HGHHHGSS5 ,iirXsiirAAr3h33s22GSGS###HGHG#SS#9h\n2MHHHHHGH35MGGGHh53SGi:irirX2sirrs335A2hhHhMG#99SHHGSGGSS3\nMHMMHHHHh3hGHhA;   sHG3Xsrss5h5ArX323hMMHX  :X3S#HHSGHGG#3\n3MM33HHHh25Ai:,::,,:;XHGh22h3MHh5325h5533si;:,.rHGGSGHHGS3\n5hM32hHHMh32AAAAXsiii:iH##HMMhMh522Xi;s5h3333333HHHGGHHHG5\n55hh52hHMMh355552AXXrriiXhSGh552XAXrs23hMhhMMMMGHMHHHMMMH5", "                         ,::,;;:,,,.                      \n                   ,,..,;i;::,..,.,,,,                    \n                  ::,;rri;,.  ....,,,::,.                 \n                .,,,:;;,:   ..        ,:,..               \n              ::.:..,,:.  ..   ,:,..,:,:;.,,.             \n            .:, ,; ..  .  .,,;s55552s: :;. ,,             \n            ,:,:i. .. .  :rX23hMHHGSM2i.:. ,,,            \n            :;::     .  ;s233hMHGG###H5r,  :,,,,,         \n           .. ,.    ,, :sA533hMHHGGS#SGhr .,, ,,::        \n        .,:,  ..      :X25hMMHHHGSSSSGGHHA    . ,:.       \n       .,::,  .      ,irrrsA23MHHhArsA5h3hs      .,       \n      .,,,...        ,rsssr;:;AHH2srr23hMM3  , ::,..      \n      ,..  ,... .:. .;;,,,A2r:iH#3ri,:Xi2HH: . :;;.       \n          ..  :,   .:;. ::X2riih#G3AA253MSSX   .:;.       \n                   .isssXAA2Assh9##SGGS###S5        .     \n                   .iX23hh33AsAH#9#S999999#5       ,:.    \n                   .iX25hMM3rr:r555HH#999#S2. . : .,      \n       ,   .        ;sA25hMh2XX5hSS#GGS##SHA      .       \n       .,           :rsA53555523hMHSSGGSGGMi,. .  ..::..  \n                    ,irXA22Ai;iXA2522hGGGGh    :..,:.,,.  \n             ,,      ;sXX25XssXAA5hHGMHHGHi    :,:    .   \n                      issXXssA53hMHGGGHHhi    .:, ..      \n                       :irrsX23MHGSSGM33r     .. .,:.     \n               .       :,,,:;irXA222AA53i    .     .      \n                       ;i;:,,,::;irX5MHhr   ;.   . ..     \n                       ;rXsi;irsA53hHGGhr                 \n                       :rX2AssX23hMHGGH3;         ,       \n                       .isA2XX25hHHGGHM5: ,.              \n                       :iirXAA253MMHHh35s:.:   ,          \n                     ,:isr;iX2225hhMMhhMh5srsX5MAr;:,     \n     ,::,,...  .,,:irsssA2Xrs5hhhhMHGGGGGHHMHHGGArrrrrrri:\n .;ii;;;;;::::,.,;sA22222253hhHGGHHHGSGHHMMMHH3Xrrssrrrssr\n,:;ii;;;i;;;;;;;:::iX5hhhhhMGHHGGGGHGSSSGSSH3Asrrsssrrrrri\n,:,:i;ii;i;i;;;;i;;:::is23hMMHHHHHHHHGGHM3Arrirrrrrsrrrrri", "                        .,:. :::.                         \n                       ,;:,;rsi;;;,.                      \n                     .::::.:ii;::rr: .:,                  \n                   .,,:,....,:i;. ,i;,,;;,                \n                  .,.,  .,;:;irrri, ,r,.ii.               \n                :,    ,;rsX223hh335s:,i.:i::              \n               ..  ,isAA533hhMHHHGHM5X; .,.;;             \n                 .;sssXA253hMHHHGGHMh32X::: .             \n                 ;rrrrsA553hMMMMMHHhhhh3A;:               \n                 ;rrrX25hMHGHMMHGSGHh3hM3r.               \n                 ;irii;;rA3MMM352XXXAAA5hA                \n                 ;;,,;ri;:,;XMhsi;;s222A55.   ;.          \n                 ;:..,:;2Xi.rhM5Xrii2XX255i .,.           \n                 i;:,:iiXAr;XMHh32A23333h5rrr.            \n               ..isXXssssXrs3HSHMHMhMMMMh3X3h,            \n               .,irsXAAA2XXA3S9SHHGGHGHHh323M,            \n               ::rirsA235r;,i2h35HMGSGGHH353h             \n               .;irrsX235s;,,:,;s5hMSGHHM523A             \n                ;;irrsXs;,. ,;;:,::shGHMh5A5r             \n                .;:;iir;,.,;sXA52Ai:2Hh3522i              \n                 ,::;;irri;;irrX3MM2A3552AA               \n                  ,,::,;iirXA25hHM32AA22s2:               \n                   ..,.:;;sA233hh35ArrXXX:                \n                    ,,  .;sAXsrX252sisA25:                \n                   .;:,  .:;, ,;rsrXX25h3:;               \n                  ..,;;::,.,;ssA53353hMH5,s;.             \n             .,,:.,, :irr;::iX3hhhhHHHHHs:s2XXr;,         \n         .:;;;:;,,,:: :rss;;;iX5hMMHHHH2,rsAAA2AAAs;,     \n      ,;iii;;;;;:,::;i,:rXXrrXA3MMHHHM5:;rsAAXAAAAAAAXs;  \n  ,;irrriiiii;;;::;i;ssi:iXAXA53hHHHh5;:rrrAAXXAXXXXXXXXXr\n;irriiriiiii;;;:,;ir;;;sriX333hhMHGMhs:;;srAAAXXXsssXssssr\n;iiiiiiiriiii;;:,;;,    iX23MMMMHHGH2i;iir  rAXXXsrXXssrri\n:ii;iiiiriiii;;,,:.      :A333hhMMM2s;;ir,  :XXXXrrXsssiri\n,;i;ii;;rriiii;:::,,,.     iX25335srr:;ri:, .XsssrrXssr;ri"];
function fallbackPortrait(seed){
  const shades=' .:;+oO0@#';
  return Array.from({length:32},(_,y)=>Array.from({length:54},(_,x)=>{
    const yy=(y-13)/13,xx=(x-26-Math.sin(seed)*2.2)/16;
    let level=Math.max(0,1-xx*xx-yy*yy)*.77+.15*Math.sin(xx*2+1);
    if(y<9)level*=.73;
    if(y>=11&&y<=12&&Math.abs(Math.abs(xx)-.35)<.16)level*=.22;
    if(y>=18&&y<=19&&Math.abs(xx)<.34)level*=.34;
    if(y>=24)level=Math.max(level,Math.exp(-(xx*xx*.69+(yy-1.5)*(yy-1.5)*3))*.35);
    return shades[Math.max(0,Math.min(shades.length-1,Math.floor(level*11)))];
  }).join('')).join('\n');
}
const deckCards=caseData.map(([name,status,tone,title],index)=>{
  const item=document.createElement('article');item.className='patient-card';item.dataset.tone=tone;
  const strip=document.createElement('header');
  const source=document.createElement('span');source.textContent='Sample record';
  const label=document.createElement('span');label.textContent=status;strip.append(source,label);
  const photo=document.createElement('pre');photo.className='portrait';photo.setAttribute('aria-hidden','true');
  photo.textContent=glyphs[index]||fallbackPortrait(index*19+2);
  const h=document.createElement('h3');h.textContent=name;
  const p=document.createElement('p');p.textContent=title;
  item.append(strip,photo,h,p);deck.append(item);return item;
});
let currentPatient=0,swipeState=null,deckX=0,deckTiltX=0,deckTiltY=0;
const rollCount=document.getElementById('roll-count'),deckStatus=document.getElementById('deck-status'),deckTitle=document.getElementById('deck-title'),deckAction=document.getElementById('deck-action');
function drawDeck(){
  const mobile=innerWidth<850,spacing=mobile?37:63;
  for(const [i,card] of deckCards.entries()){
    let d=(i-currentPatient+deckCards.length)%deckCards.length;
    if(d>3)d-=deckCards.length;
    const weight=Math.max(0,1-Math.abs(d)*.27);
    const shift=deckX*weight;
    const values={
      x:(d*spacing+shift)+'px',
      y:(Math.abs(d)*16+deckTiltY*weight)+'px',
      z:(-Math.abs(d)*47)+'px',
      yaw:(-d*11+shift*.08+deckTiltX*weight)+'deg',
      roll:(d*6+shift*.048)+'deg',
      opacity:String(Math.abs(d)>2?0:1-Math.abs(d)*.15)
    };
    Object.entries(values).forEach(([key,v])=>card.style.setProperty('--card-'+key,v));
    card.style.zIndex=String(10-Math.abs(d));card.setAttribute('aria-hidden',String(d!==0));
  }
}
function selectPatient(i){
  currentPatient=(i+deckCards.length)%deckCards.length;
  const [name,status,tone,title,action]=caseData[currentPatient];
  rollCount.textContent=(currentPatient+1)+' / '+deckCards.length;
  deckStatus.textContent=status;deckStatus.dataset.tone=tone;
  deckTitle.textContent=title;deckAction.textContent=action;drawDeck();
}
let deckFrame=0,deckBounds=null;
function queueDeckDraw(){
  if(!deckFrame)deckFrame=requestAnimationFrame(()=>{deckFrame=0;drawDeck();});
}
function finishDeck(event,cancelled=false){
  if(!swipeState||event.pointerId!==swipeState.id)return;
  const delta=event.clientX-swipeState.x;
  const lift=Math.abs(event.clientY-swipeState.y);
  const elapsed=Math.max(16,event.timeStamp-swipeState.started);
  const swipe=Math.abs(delta)>=23||(Math.abs(delta)>=13&&Math.abs(delta)/elapsed>=.48);
  cancelAnimationFrame(deckFrame);deckFrame=0;
  swipeState=null;deckRegion.classList.remove('dragging');
  deckX=0;deckTiltX=0;deckTiltY=0;
  if(!cancelled&&swipe&&Math.abs(delta)>lift)selectPatient(currentPatient+(delta<0?1:-1));
  else drawDeck();
}
deckRegion.addEventListener('pointerdown',event=>{
  if(!event.isPrimary||event.button!==0)return;
  swipeState={x:event.clientX,y:event.clientY,id:event.pointerId,started:event.timeStamp};
  deckRegion.setPointerCapture(event.pointerId);deckRegion.classList.add('dragging');
});
deckRegion.addEventListener('pointermove',event=>{
  if(swipeState?.id===event.pointerId){deckX=Math.max(-160,Math.min(160,event.clientX-swipeState.x));deckTiltY=Math.max(-18,Math.min(18,(event.clientY-swipeState.y)*.16));deckTiltX=deckX*.065;queueDeckDraw();return;}
  if(gate.matches||event.pointerType!=='mouse')return;
  const box=deckBounds??=deckRegion.getBoundingClientRect();
  deckTiltX=((event.clientX-box.left)/box.width-.5)*13;
  deckTiltY=((event.clientY-box.top)/box.height-.5)*12;queueDeckDraw();
});
deckRegion.addEventListener('pointerleave',()=>{deckBounds=null;if(!swipeState){deckTiltX=0;deckTiltY=0;drawDeck();}});
deckRegion.addEventListener('pointerup',event=>finishDeck(event));
deckRegion.addEventListener('pointercancel',event=>finishDeck(event,true));
deckRegion.addEventListener('keydown',event=>{
  if(!['ArrowRight','ArrowLeft'].includes(event.key))return;
  event.preventDefault();selectPatient(currentPatient+(event.key==='ArrowRight'?1:-1));
});
window.addEventListener('resize',()=>{deckBounds=null;drawDeck();});
window.addEventListener('scroll',()=>{deckBounds=null;},{passive:true});
selectPatient(0);

const sections=[...document.querySelectorAll('.chapter')];
const nav=[...document.querySelectorAll('.menu nav a')];
for (const link of nav)link.addEventListener('click',()=>document.querySelector('.menu').open=false);

let scheduled=false;
function updateScroll(){
  scheduled=false;
  const viewport=innerHeight;
  let active='';
  for(const section of sections){
    const rect=section.getBoundingClientRect();
    const progress=gate.matches?1:clamp((viewport*.91-rect.top)/(rect.height-viewport*.15));
    section.style.setProperty('--progress',String(progress));
    section.style.setProperty('--shift',((progress-.3)*105)+'px');
    section.style.setProperty('--tilt',(12-progress*22)+'deg');
    if(rect.top<viewport*.54&&rect.bottom>viewport*.54)active=section.id;

  }
  if(document.getElementById('research').getBoundingClientRect().top<viewport*.54)active='research';
  for(const link of nav){if(link.hash.slice(1)===active)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');}
}
function queueScroll(){if(!scheduled){scheduled=true;requestAnimationFrame(updateScroll);}}
addEventListener('scroll',queueScroll,{passive:true});addEventListener('resize',queueScroll);gate.addEventListener('change',queueScroll);updateScroll();
const reportLayer=document.getElementById('report-layer');
reportLayer.addEventListener('click',()=>{
  const front=reportLayer.getAttribute('aria-pressed')!=='true';
  reportLayer.setAttribute('aria-pressed',String(front));
  reportLayer.textContent=front?'Bring original forward ↗':'Bring extraction forward ↗';
  document.getElementById('report-stage').classList.toggle('readout-front',front);
});

for(const [selector,key,id,messages] of [
  ['[data-reading]','reading','reading-detail',[
    '12 Nov · 4.3 mmol/L · Lab X baseline report',
    '19 Nov · 6.1 mmol/L · Lab X repeat report'
  ]],
  ['[data-review-step]','reviewStep','review-detail',[
    'Asha’s screenshot entered the review queue with the original attached.',
    'Dr. Rao acknowledged the report. The follow-up stayed open.',
    'Dr. Rao assigned the next action to the clinic assistant and recorded it in the case.'
  ]]
]){
  const buttons=[...document.querySelectorAll(selector)];
  const detail=document.getElementById(id);
  for(const button of buttons)button.addEventListener('click',()=>{
    for(const item of buttons)item.setAttribute('aria-pressed',String(item===button));
    detail.textContent=messages[Number(button.dataset[key])];
  });
}

const sceneCut=document.createElement('div');
sceneCut.className='chapter-cut';
sceneCut.setAttribute('aria-hidden','true');
document.body.append(sceneCut);
const chapterBackdrops=sections.map(chapter=>getComputedStyle(chapter.previousElementSibling).backgroundColor);

function animateChapters(){
  if(gate.matches){sceneCut.hidden=true;return;}
  const height=innerHeight;
  let edge=null;
  for(const [index,chapter] of sections.entries()){
    const top=chapter.getBoundingClientRect().top;
    const open=smooth(clamp((height*.94-top)/(height*.57)));
    chapter.style.setProperty('--open',open.toFixed(3));
    chapter.style.setProperty('--depth-turn',((1-open)*13).toFixed(2)+'deg');
    chapter.style.setProperty('--depth-lift',((1-open)*72).toFixed(1)+'px');
    if(top>height*.32&&top<height*.88)edge={top,open,index};
  }
  sceneCut.hidden=!edge;
  if(edge){
    sceneCut.style.setProperty('--edge',edge.top+'px');
    sceneCut.style.setProperty('--edge-depth',Math.sin(edge.open*Math.PI).toFixed(3));
    sceneCut.style.setProperty('--outgoing-color',chapterBackdrops[edge.index]);
  }
}
let revealFrame=0;
function queueChapterAnimation(){
  if(revealFrame)return;
  revealFrame=requestAnimationFrame(()=>{revealFrame=0;animateChapters();});
}
addEventListener('scroll',queueChapterAnimation,{passive:true});
addEventListener('resize',queueChapterAnimation);
gate.addEventListener('change',queueChapterAnimation);
animateChapters();
