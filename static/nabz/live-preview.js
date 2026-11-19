const trendPatient=document.getElementById('trend-patient');
const trendTest=document.getElementById('trend-test');
const trendBars=document.getElementById('trend-bars');
const trendDetail=document.getElementById('reading-detail');
const trendRefresh=document.getElementById('trend-refresh');
const trendConfirmed=document.getElementById('trend-confirmed');
const historyLink=document.getElementById('history-link');
const handoffButtons=[...document.querySelectorAll('[data-review-step]')];
const handoffCount=document.getElementById('handoff-count');
const handoffSource=document.getElementById('handoff-source');
const handoffDetail=document.getElementById('review-detail');
let trendSeries=[],trendSequence=0,inboxReports=null,activeHandoff=0;

async function clinicData(path){
  const response=await fetch('/api/'+path);
  if(!response.ok)throw new Error('Clinic data is unavailable.');
  return response.json();
}

function selectFrom(select,choices,placeholder){
  select.replaceChildren(new Option(placeholder,''));
  for(const [label,value] of choices)select.add(new Option(label,value));
  select.disabled=!choices.length;
}

function renderTrend(){
  const series=trendSeries.find(item=>item.key===trendTest.value);
  trendBars.replaceChildren();
  const points=series?.points.filter(point=>!trendConfirmed.checked||point.confirmed)??[];
  trendBars.hidden=!points.length;
  if(!points.length){
    const empty=trendConfirmed.checked?'No confirmed readings for this test.':'No readable results for this patient.';
    trendDetail.textContent=trendPatient.value?empty:'Select a patient.';
    return;
  }
  const recent=points.slice(-8);
  const values=recent.map(point=>point.value);
  const min=Math.min(0,...values),max=Math.max(0,...values);
  const scale=(max-min||1)/86;
  const controls=[];
  for(const point of recent){
    const button=document.createElement('button');
    button.type='button';
    button.className='plot-column';
    if(!point.confirmed)button.classList.add('unconfirmed');
    button.setAttribute('aria-pressed','false');
    button.style.setProperty('--bar-height',Math.max(2,Math.abs(point.value)/scale)+'%');
    button.style.setProperty('--bar-bottom',(Math.min(0,point.value)-min)/scale+'%');
    const frame=document.createElement('span');
    frame.className='bar-frame';
    const body=document.createElement('span');
    body.className='bar-body';
    const value=document.createElement('strong');
    value.textContent=point.value;
    const date=document.createElement('span');
    date.textContent=point.date;
    body.append(value);
    frame.append(body);
    button.append(frame,date);
    controls.push(button);
    button.addEventListener('click',()=>{
      for(const control of controls)control.setAttribute('aria-pressed',String(control===button));
      const unit=series.unit?' '+series.unit:' · unit unavailable';
      const review=point.confirmed?'Confirmed':'Awaiting confirmation';
      trendDetail.textContent=point.date+' · '+series.name+' · '+point.value+unit+' · '+review;
    });
    trendBars.append(button);
  }
  controls.at(-1)?.click();
}

async function loadTrend(){
  const sequence=++trendSequence;
  const patient=trendPatient.value;
  const selectedTest=trendTest.value;
  historyLink.href='/nabz/clinic.html?view=patients'+(patient?'&patient='+encodeURIComponent(patient):'');
  trendSeries=[];
  selectFrom(trendTest,[],'Select test');
  trendBars.replaceChildren();
  trendBars.hidden=true;
  if(!patient){renderTrend();return;}
  trendDetail.textContent='Loading readings…';
  try{
    const data=await clinicData('patients/'+encodeURIComponent(patient));
    if(sequence!==trendSequence)return;
    const groups=new Map();
    for(const report of data.reports){
      const date=report.report_date||report.received_at?.slice(0,10);
      for(const test of report.tests??[]){
        if(!date||!test.name||!Number.isFinite(test.value))continue;
        const unit=test.unit?.trim()||'';
        const key=JSON.stringify([test.name,unit]);
        if(!groups.has(key))groups.set(key,{key,name:test.name,unit,points:[]});
        groups.get(key).points.push({date,value:test.value,confirmed:report.status==='confirmed'});
      }
    }
    trendSeries=[...groups.values()].sort((a,b)=>b.points.length-a.points.length);
    for(const series of trendSeries)series.points.sort((a,b)=>a.date.localeCompare(b.date));
    selectFrom(trendTest,trendSeries.map(series=>[series.name+(series.unit?' · '+series.unit:''),series.key]),'Select test');
    if(trendSeries.length)trendTest.value=groups.has(selectedTest)?selectedTest:trendSeries[0].key;
    renderTrend();
  }catch(error){
    if(sequence===trendSequence)trendDetail.textContent=error.message;
  }
}

function updateHandoff(){
  const count=inboxReports?.length;
  const confirmed=inboxReports?.filter(report=>report.status==='confirmed').length;
  handoffCount.textContent=inboxReports?[count,count-confirmed,confirmed][activeHandoff]:'—';
  handoffDetail.textContent=[
    'Reports received through screenshot intake.',
    'Reports whose readings still need clinician confirmation.',
    'Reports whose readings a clinician has confirmed.'
  ][activeHandoff];
}

async function loadClinicPreview(){
  trendRefresh.disabled=true;
  const prior=trendPatient.value;
  const [patients,inbox]=await Promise.allSettled([clinicData('patients'),clinicData('inbox')]);
  if(inbox.status==='fulfilled'){
    inboxReports=inbox.value;
    handoffSource.textContent='Live clinic inbox';
  }else handoffSource.textContent='Could not load clinic inbox';
  updateHandoff();
  if(patients.status==='fulfilled'){
    const items=patients.value;
    const counts=new Map();
    for(const report of inboxReports??[]){
      counts.set(report.patient_id,(counts.get(report.patient_id)??0)+1);
    }
    const preferred=[...items].sort((a,b)=>(counts.get(b.id)??0)-(counts.get(a.id)??0))[0];
    selectFrom(trendPatient,items.map(patient=>[patient.name,patient.id]),'Select patient');
    if(items.some(patient=>String(patient.id)===prior))trendPatient.value=prior;
    else if(preferred&&counts.has(preferred.id))trendPatient.value=preferred.id;
    await loadTrend();
    if(!items.length)trendDetail.textContent='No patients in the clinic yet.';
  }else trendDetail.textContent='Could not load patients from the clinic.';
  trendRefresh.disabled=false;
}

for(const button of handoffButtons)button.addEventListener('click',()=>{
  activeHandoff=Number(button.dataset.reviewStep);
  for(const other of handoffButtons)other.setAttribute('aria-pressed',String(other===button));
  updateHandoff();
});
trendPatient.addEventListener('change',loadTrend);
trendTest.addEventListener('change',renderTrend);
trendConfirmed.addEventListener('change',renderTrend);
trendRefresh.addEventListener('click',loadClinicPreview);
let previewLoaded=false;
const previewObserver=new IntersectionObserver(entries=>{
  if(previewLoaded||!entries.some(entry=>entry.isIntersecting))return;
  previewLoaded=true;
  previewObserver.disconnect();
  loadClinicPreview();
},{rootMargin:'200px'});
previewObserver.observe(document.getElementById('history'));
previewObserver.observe(document.getElementById('followup'));
window.addEventListener('pageshow',event=>{
  if(event.persisted&&previewLoaded)loadClinicPreview();
});
