const $=id=>document.getElementById(id);
const saved=localStorage.getItem('siga_username');
if(saved){$('username').value=saved;$('remember').checked=true}
$('toggle').onclick=()=>{const p=$('password');p.type=p.type==='password'?'text':'password';$('toggle').textContent=p.type==='password'?'Mostrar':'Ocultar'};
$('loginForm').onsubmit=e=>{e.preventDefault();const m=$('loginMsg');m.className='msg';if(!$('username').value.trim()||!$('password').value){m.textContent='Ingrese su usuario y contraseña.';m.classList.add('error');return}if($('remember').checked)localStorage.setItem('siga_username',$('username').value.trim());else localStorage.removeItem('siga_username');m.textContent='Validación de acceso preparada para la conexión con el sistema.';m.classList.add('success')};
$('forgot').onclick=e=>{e.preventDefault();$('modal').classList.remove('hidden');$('email').focus()};
$('close').onclick=()=> $('modal').classList.add('hidden');
$('modal').onclick=e=>{if(e.target===$('modal'))$('modal').classList.add('hidden')};
$('recovery').onsubmit=e=>{e.preventDefault();const m=$('recoveryMsg');m.className='msg';if(!$('email').value.includes('@')){m.textContent='Ingrese un correo electrónico válido.';m.classList.add('error');return}m.textContent='Solicitud registrada. El flujo real de recuperación se conectará posteriormente al correo del usuario.';m.classList.add('success')};