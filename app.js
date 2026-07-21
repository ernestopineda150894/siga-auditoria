const DEMO_USER={username:"admin",email:"admin@siga.local",password:"Admin@2026Test",name:"Administrador de Plataforma",mustChange:true,status:"ACTIVE"};

const $=id=>document.getElementById(id);
const views={login:$("loginView"),change:$("changePasswordView"),dashboard:$("dashboardView")};
const showView=v=>Object.values(views).forEach(x=>x.classList.toggle("hidden",x!==v));
const message=(el,text,type="")=>{el.textContent=text;el.className="message "+type;};

$("loginForm").addEventListener("submit",e=>{
  e.preventDefault();
  const username=$("username").value.trim().toLowerCase();
  const password=$("password").value;
  if(username!==DEMO_USER.username||password!==DEMO_USER.password){
    message($("loginMessage"),"Usuario o contraseña incorrectos.","error");return;
  }
  if(DEMO_USER.status!=="ACTIVE"){message($("loginMessage"),"La cuenta no está activa.","error");return;}
  sessionStorage.setItem("sigaUser",DEMO_USER.username);
  if(DEMO_USER.mustChange){showView(views.change);return;}
  enterDashboard();
});

function enterDashboard(){
  $("userBadge").textContent=DEMO_USER.name+" · "+DEMO_USER.username;
  showView(views.dashboard);
}

function validatePassword(p){
  return {
    length:p.length>=12,
    upper:/[A-Z]/.test(p),
    lower:/[a-z]/.test(p),
    number:/\d/.test(p),
    special:/[^A-Za-z0-9]/.test(p),
    username:!p.toLowerCase().includes(DEMO_USER.username)
  };
}

$("newPassword").addEventListener("input",()=>{
  const r=validatePassword($("newPassword").value);
  Object.entries(r).forEach(([k,v])=>{
    const el=document.querySelector(`[data-rule="${k}"]`);
    el.classList.toggle("valid",v);
    el.textContent=(v?"✓ ":"✗ ")+el.textContent.replace(/^[✓✗] /,"");
  });
});

$("changePasswordForm").addEventListener("submit",e=>{
  e.preventDefault();
  const p=$("newPassword").value, c=$("confirmPassword").value, r=validatePassword(p);
  if(!Object.values(r).every(Boolean)){message($("changeMessage"),"La contraseña no cumple todos los requisitos de seguridad.","error");return;}
  if(p!==c){message($("changeMessage"),"Las contraseñas no coinciden.","error");return;}
  DEMO_USER.mustChange=false;
  message($("changeMessage"),"Contraseña actualizada correctamente.","success");
  setTimeout(enterDashboard,700);
});

function logout(){
  sessionStorage.removeItem("sigaUser");
  $("loginForm").reset();$("changePasswordForm").reset();
  showView(views.login);
}
$("logoutBtn").addEventListener("click",logout);
$("logoutChangeBtn").addEventListener("click",logout);

$("forgotBtn").addEventListener("click",()=>{$("forgotModal").classList.remove("hidden");$("resetEmail").focus()});
$("closeModal").addEventListener("click",()=>{$("forgotModal").classList.add("hidden")});
$("forgotModal").addEventListener("click",e=>{if(e.target.id==="forgotModal")$("forgotModal").classList.add("hidden")});
$("forgotForm").addEventListener("submit",e=>{
  e.preventDefault();
  message($("resetMessage"),"Si el correo corresponde a una cuenta registrada, se enviarán instrucciones de recuperación.","success");
});

if(sessionStorage.getItem("sigaUser")){showView(views.change)}else{showView(views.login)}
