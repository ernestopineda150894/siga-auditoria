const $ = (id) => document.getElementById(id);

// Credenciales de prueba de SIGA v0.1 / v0.2
// Se mantienen únicamente para pruebas del prototipo.
// En la fase de autenticación real serán sustituidas por la base de datos.
const TEST_USER = "admin";
const TEST_PASSWORD = "Admin@2026Test";

const saved = localStorage.getItem("siga_username");
if (saved) {
  $("username").value = saved;
  $("remember").checked = true;
}

$("toggle").addEventListener("click", () => {
  const p = $("password");
  p.type = p.type === "password" ? "text" : "password";
  $("toggle").textContent = p.type === "password" ? "Mostrar" : "Ocultar";
});

$("loginForm").addEventListener("submit", (e) => {
  e.preventDefault();

  const username = $("username").value.trim();
  const password = $("password").value;
  const message = $("loginMsg");

  message.className = "msg";
  message.textContent = "";

  if (!username || !password) {
    message.textContent = "Ingrese su usuario y contraseña.";
    message.classList.add("error");
    return;
  }

  if (username !== TEST_USER || password !== TEST_PASSWORD) {
    message.textContent = "Usuario o contraseña incorrectos.";
    message.classList.add("error");
    return;
  }

  if ($("remember").checked) {
    localStorage.setItem("siga_username", username);
  } else {
    localStorage.removeItem("siga_username");
  }

  message.textContent = "Acceso correcto. Ingresando al sistema...";
  message.classList.add("success");

  // Mantiene el comportamiento de la v0.1: acceso al sistema.
  // Si existe una página dashboard.html en el proyecto, se dirige allí.
  // Si aún no existe, se muestra una pantalla de bienvenida de prueba.
  setTimeout(() => {
    window.location.href = "dashboard.html";
  }, 500);
});

$("forgot").addEventListener("click", (e) => {
  e.preventDefault();
  $("modal").classList.remove("hidden");
  $("email").focus();
});

$("close").addEventListener("click", () => {
  $("modal").classList.add("hidden");
});

$("modal").addEventListener("click", (e) => {
  if (e.target === $("modal")) $("modal").classList.add("hidden");
});

$("recovery").addEventListener("submit", (e) => {
  e.preventDefault();

  const email = $("email").value.trim();
  const message = $("recoveryMsg");
  message.className = "msg";

  if (!email || !email.includes("@")) {
    message.textContent = "Ingrese un correo electrónico válido.";
    message.classList.add("error");
    return;
  }

  message.textContent = "Solicitud registrada. El flujo real de recuperación se conectará posteriormente al correo del usuario.";
  message.classList.add("success");
});