const form=document.getElementById('loginForm');
const password=document.getElementById('password');
const toggle=document.getElementById('togglePassword');
const message=document.getElementById('message');

toggle.addEventListener('click',()=>{
  const visible=password.type==='text';
  password.type=visible?'password':'text';
  toggle.setAttribute('aria-label',visible?'Mostrar contraseña':'Ocultar contraseña');
});

form.addEventListener('submit',(event)=>{
  event.preventDefault();
  const username=document.getElementById('username').value.trim();
  if(!username || !password.value) return;
  message.textContent='Acceso correcto. Cargando SIGA…';
  setTimeout(()=>{ window.location.href='dashboard.html'; },350);
});
