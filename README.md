# SIGA v0.2.2

Versión de prototipo de la interfaz de acceso y configuración global.

## Acceso de prueba
Usuario: `admin`
Contraseña: `Admin@2026Test`

## Archivos
- `index.html` — ventana de acceso.
- `dashboard.html` — interfaz de sistema de prueba.
- `configuracion.html` — configuración editable de las características de acceso y logos.
- `styles.css` — estilos de acceso.
- `app.js` — lógica de autenticación de prototipo.
- `assets/referencia_acceso_v0.2.2.png` — imagen de referencia proporcionada.

## Cambio principal de v0.2.2
Los cuatro elementos:
- Seguro
- Eficiente
- Colaborativo
- Confiable

son configurables desde `Configuración`.

También se preparó la estructura para que los logos sean configurables. En la arquitectura definitiva estos parámetros deberán almacenarse en la base de datos y estar asociados a la Firma y País, en lugar de depender de localStorage.

## Importante
La autenticación de esta versión sigue siendo de demostración. El siguiente paso será conectar:
- usuarios reales,
- roles,
- permisos RBAC/ABAC,
- sesiones seguras,
- recuperación real por correo Outlook/Microsoft 365,
- base de datos,
- configuración Multi-Firma y Multi-País.

## Vercel
Descomprimir el ZIP, subir los archivos al repositorio conectado a Vercel y hacer commit/push. Vercel desplegará la versión automáticamente.
