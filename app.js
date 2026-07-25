const CONFIG_KEY='siga_access_config_v022';
const DEFAULT_CONFIG={
  features:[
    {icon:'♢',name:'Seguro',active:true},
    {icon:'▥',name:'Eficiente',active:true},
    {icon:'♧',name:'Colaborativo',active:true},
    {icon:'▤',name:'Confiable',active:true}
  ],
  logos:{local:'assets/logo_local.png',international:'assets/logo_international.png'}
};

const TEST_USER='admin';
const TEST_PASS='Admin@2026Test';

function getConfig(){
  try{return {...DEFAULT_CONFIG,...JSON.parse(localStorage.getItem(CONFIG_KEY)||'{}')}}
  catch(e){return DEFAULT_CONFIG}
}
function renderFeatures(){
  const cfg=getConfig(), box=document.getElementById('features');
  box.innerHTML='';
  (cfg.features||[]).filter(x=>x.active!==false).forEach(x=>{
    const d=document.createElement('div'); d.className='feature';
    d.innerHTML=`<div class="feature-icon">${x.icon||'•'}</div><div class="feature-name">${x.name||''}</div>`;
    box.appendChild(d);
  });
}
function loadLogo(id,placeholder,path){
  const img=document.getElementById(id), ph=document.getElementById(placeholder);
  if(!img||!ph)return;
  img.onerror=()=>{img.style.display='none';ph.style.display='block'};
  img.onload=()=>{img.style.display='block';ph.style.display='none'};
  img.src=path;
}
function init(){
  const cfg=getConfig();
  renderFeatures();
  loadLogo('localLogo','localLogoPlaceholder',cfg.logos.local);
  loadLogo('localLogoBottom','localLogoBottom',cfg.logos.local);
  loadLogo('internationalLogo','internationalLogo',cfg.logos.international);

  document.getElementById('togglePassword').onclick=()=>{
    const p=document.getElementById('password');
    p.type=p.type==='password'?'text':'password';
  };
  document.getElementById('loginForm').onsubmit=e=>{
    e.preventDefault();
    const u=document.getElementById('username').value.trim().toLowerCase();
    const p=document.getElementById('password').value;
    const m=document.getElementById('loginMessage');
    if(u===TEST_USER && p===TEST_PASS){
      m.textContent='Acceso correcto. Ingresando al sistema...';
      m.style.color='#28744f';
      setTimeout(()=>location.href='dashboard.html',450);
    }else{
      m.textContent='Usuario o contraseña incorrectos.';
      m.style.color='#b33a3a';
    }
  };
  document.getElementById('forgot').onclick=e=>{
    e.preventDefault();document.getElementById('recoveryModal').classList.remove('hidden');
  };
  document.getElementById('closeModal').onclick=()=>{
    document.getElementById('recoveryModal').classList.add('hidden');
  };
  document.getElementById('sendRecovery').onclick=()=>{
    const email=document.getElementById('recoveryEmail').value.trim();
    const m=document.getElementById('recoveryMessage');
    if(!email){m.textContent='Ingrese un correo electrónico.';m.style.color='#b33a3a';return}
    m.textContent='Solicitud registrada. La recuperación real se conectará al correo del usuario en el módulo de autenticación.';
    m.style.color='#28744f';
  };
  document.getElementById('microsoftBtn').onclick=()=>{
    alert('La integración real con Microsoft 365 / Outlook se implementará en la fase de autenticación empresarial.');
  };
}
init();
