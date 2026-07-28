# SIGA — Sistema Integral de Gestión de Auditorías
### Prototipo funcional v1.0

## Cómo usarlo
1. Descargue `index.html` y `app.js` en la misma carpeta y abra `index.html` en el navegador (Chrome/Edge recomendado), o súbalo a cualquier hosting estático.
2. Inicie sesión con el usuario de prueba:
   - **Usuario:** `admin`
   - **Contraseña:** `Admin@2026Test`
3. Los datos se guardan automáticamente en el navegador (localStorage), por lo que sus cambios persisten entre sesiones en ese mismo navegador/equipo. Para reiniciar los datos de demostración, abra la consola del navegador y ejecute `SIGA_DEBUG.resetDemo()`.

Usuarios adicionales de demostración (mismo esquema de roles): `lfernandez`, `cramirez`, `asolis` — contraseña `Demo@2026`.

## Qué incluye esta versión
Arquitectura Global Core + Capa Local, con la jerarquía completa **Firma → País → Oficina → Cliente → Encargo → Período → Área/Ciclo → Riesgo → Control → Procedimiento → Evidencia → Hallazgo → Conclusión**.

**Módulos funcionales (crear / editar / eliminar, con persistencia real):**
- Login corporativo configurable (identidad visual, logos por texto, colores) + Microsoft 365 (simulado)
- Dashboard ejecutivo con KPIs, distribución de encargos y próximas visitas
- Clientes (CRUD, ficha de cliente, encargos asociados, normativa referencial)
- Encargos (CRUD) con **Dashboard del Encargo** de 17 pestañas:
  Información General · Planificación y Materialidad · Metodología (8 pasos) · Riesgos y Matriz · Áreas de Auditoría · Visitas · Papeles de Trabajo · Evidencia · Hallazgos y Ajustes · Equipo y Asignaciones · Horas y Presupuesto · Revisión y Supervisión · Informes · Normativa Aplicable · Archivo Permanente · Archivo Corriente · Configuración del Encargo
- **Metodología de 8 pasos** con el **Paso 6 (Analítica preliminar)** como punto de generación de áreas sugeridas (aceptar / modificar / eliminar / crear nueva)
- Áreas de auditoría: crear, editar, eliminar, duplicar, reordenar, asignar responsable, procedimientos, muestreo, conclusión
- Visitas de auditoría, vinculadas a áreas y equipo
- Revisión jerárquica (Preparador → Senior → Manager → Director → Partner) con bitácora de comentarios
- Motor Normativo configurable: catálogo Global / País / Industria + simulador de normativa aplicable
- Configuración global: Organización e Identidad, Firmas, Países, Oficinas, Usuarios, Roles (matriz de permisos), Bitácora del sistema (trazabilidad)

## Arquitectura (para evolución hacia producción)
Este prototipo es **frontend puro** (HTML/CSS/JS vanilla) con persistencia en `localStorage`, deliberadamente aislado en tres capas para facilitar el reemplazo por servicios reales sin rediseñar las vistas:

- `Store` / `DB` → sustituir por API REST/GraphQL + PostgreSQL multi-tenant (Row-Level Security por firma/país/encargo).
- `Modules.calcularNormativaAplicable` → candidato a microservicio de motor normativo independiente, versionado.
- `TAB.*` (renderers del workspace del encargo) → mapean 1:1 a los módulos funcionales que se piden en el documento base, para facilitar auditoría de cobertura.
- El motor de formularios (`formModal` schema-driven) permite agregar campos/módulos nuevos sin duplicar código de UI.

## Próximas iteraciones (actualización incremental por áreas)
Dado que este sistema evolucionará mediante pruebas, cada actualización futura debe:
1. Indicar la sección exacta a modificar (p. ej. "Área de auditoría → Muestreo", "Motor Normativo → simulador", "Login → identidad visual").
2. Aplicarse solo sobre esa sección, sin regenerar el archivo completo.

Pendientes conocidos para siguientes iteraciones (no bloqueantes para el uso actual):
- Auditoría de grupo / consolidación de subsidiarias (módulo 18 del documento)
- Estados financieros con trazabilidad a balanza de comprobación
- Aceptación/continuidad de cliente e independencia como formularios dedicados (Paso 1)
- Adjuntos reales (actualmente los campos de archivo son metadatos simulados; requiere backend de almacenamiento)
- SSO real con Microsoft 365
