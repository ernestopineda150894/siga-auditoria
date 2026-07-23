# SIGA v0.2 corregida

## Cambio principal
Se restauró la autenticación funcional de prueba que existía en SIGA v0.1.

### Credenciales de prueba
- Usuario: `admin`
- Contraseña: `Admin@2026Test`

Al ingresar correctamente, el prototipo dirige a `dashboard.html`.

## Importante
Estas credenciales están incluidas únicamente para pruebas del prototipo. No deben utilizarse en producción.

La autenticación real deberá conectarse posteriormente a la base de datos y al sistema de gestión de usuarios de SIGA.

## Archivos
- `index.html` — ventana de acceso.
- `styles.css` — diseño.
- `app.js` — autenticación de prueba y recuperación preparada.
- `dashboard.html` — dashboard de prueba para validar el acceso.

## Identidad
© 2026 Audit & Tax Services, S.A. de C.V. Todos los derechos reservados.
Derechos de autor: Gabriel Ernesto Barrera Pineda.
Versión 0.2.

## Despliegue
Reemplazar los archivos del proyecto conectado a Vercel y realizar un commit. Vercel debería generar el nuevo deployment automáticamente.
