const $=id=>document.getElementById(id);
const USER='admin', PASS='Admin@2026Test';
const files=['assets/logo_1.png','assets/logo_1.jpg','assets/logo_1.jpeg','assets/logo_1.webp'];
const files2=['assets/logo_2.png','assets/logo_2.jpg','assets/logo_2.jpeg','assets/logo_2.webp'];
function logo(id,fb,list,i=0){if(i>=list.length){$(id).style.display='none';$(fb).style.display='block';return}$(id).onerror=()=>logo(id,fb,list,i+1);$(id).onload=()=>{$(id).style.display='block';$(fb).style.display='none'};$(id).src=list[i]}
logo('mainLogo','mainFallback',files);logo('localLogo','localFallback',files);logo('intlLogo','intlFallback',files2);
$('show').onclick=()=>{$('pass').type=$('pass').type==='password'?'text':'password'};
$('loginForm').onsubmit=e=>{e.preventDefault();let m=$('msg');if($('user').value.trim()===USER&&$('pass').value===PASS){m.textContent='Acceso correcto. Ingresando al sistema...';m.style.cssText='color:#28744f;font-size:10px;text-align:center;margin-top:7px';setTimeout(()=>location.href='dashboard.html',500)}else{m.textContent='Usuario o contraseña incorrectos.';m.style.cssText='color:#b33a3a;font-size:10px;text-align:center;margin-top:7px'}};
$('forgot').onclick=e=>{e.preventDefault();$('modal').classList.remove('hidden')};
$('close').onclick=()=>$('modal').classList.add('hidden');
$('send').onclick=()=>{$('recoverMsg').textContent='Solicitud registrada. La recuperación real se conectará al correo del usuario en el módulo de autenticación.';$('recoverMsg').style.cssText='color:#28744f;font-size:10px;margin-top:8px'};
$('ms').onclick=()=>alert('Integración Microsoft 365 preparada para una fase posterior.');
