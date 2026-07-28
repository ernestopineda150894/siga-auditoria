/* =========================================================================
   SIGA — Sistema Integral de Gestión de Auditorías
   Prototipo funcional (frontend). Arquitectura modular basada en un
   modelo de datos jerárquico: Firma → País → Oficina → Cliente →
   Encargo → Período → Área/Ciclo → Riesgo/Control → Procedimiento →
   Evidencia → Hallazgo → Conclusión.

   NOTA DE ARQUITECTURA (para evolución futura):
   Este archivo simula, en el cliente, lo que en producción sería:
     - Un backend con API REST/GraphQL (Node/NestJS, .NET o Java+Spring)
     - Base de datos relacional multi-tenant (PostgreSQL) con esquema
       por Firma/País y Row-Level Security por tenant/encargo.
     - Motor normativo como servicio independiente (tabla Normativa
       versionada por jurisdicción/vigencia).
     - Motor de reglas para metodología (configurable, no hardcoded).
     - Almacenamiento de evidencia en object storage (S3/Blob) con
       hash de integridad y bitácora WORM (write once read many).
   La capa de datos (DB.*) y persistencia (Store.*) están aisladas del
   resto para poder sustituirse por llamadas API sin rediseñar las vistas.
   ========================================================================= */

(function(){
"use strict";

/* ============================= UTILIDADES ============================= */
const uid = (p='id') => p + '_' + Math.random().toString(36).slice(2,9) + Date.now().toString(36).slice(-4);
const nowISO = () => new Date().toISOString();
const todayStr = () => new Date().toISOString().slice(0,10);
function escapeHtml(str){
  if(str===undefined||str===null) return '';
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function fmtDate(d){
  if(!d) return '—';
  try{
    const dt = new Date(d+'T00:00:00');
    return dt.toLocaleDateString('es-ES',{day:'2-digit',month:'short',year:'numeric'});
  }catch(e){return d;}
}
function fmtDateTime(iso){
  if(!iso) return '—';
  try{
    const dt = new Date(iso);
    return dt.toLocaleDateString('es-ES',{day:'2-digit',month:'short',year:'numeric'}) + ' · ' +
           dt.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'});
  }catch(e){return iso;}
}
function fmtMoney(n, cur='USD'){
  n = Number(n)||0;
  return (cur==='USD'?'$':cur+' ') + n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
}
function fmtHours(n){ return (Number(n)||0).toLocaleString('en-US',{maximumFractionDigits:1}) + ' h'; }
function initials(name){
  if(!name) return '—';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0]||'') + (parts[1]?.[0]||'')).toUpperCase();
}
function byId(arr, id){ return (arr||[]).find(x=>x.id===id); }
function debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }

function toast(msg, type='info'){
  const wrap = document.getElementById('toast-wrap');
  const el = document.createElement('div');
  el.className = 'toast ' + (type==='error'?'err':type==='success'?'ok':'');
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(()=>{ el.style.opacity='0'; el.style.transition='opacity .25s'; setTimeout(()=>el.remove(),250); }, 3200);
}

/* ============================= PERSISTENCIA ============================= */
const STORAGE_KEY = 'siga_db_v1';
const Store = {
  save(db){
    try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); }
    catch(e){ console.warn('No se pudo persistir SIGA (localStorage no disponible):', e); }
  },
  load(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    }catch(e){ return null; }
  },
  reset(){ try{ localStorage.removeItem(STORAGE_KEY); }catch(e){} }
};

/* ============================= CATÁLOGOS FIJOS ============================= */
const ROLES_BASE = ['Administrador','Partner / Socio','Director','Manager','Senior','Staff','Usuario especializado'];
const ESTADOS_CLIENTE = ['Activo','Inactivo','Archivado','En configuración'];
const TIPOS_ENCARGO = ['Auditoría financiera externa','Auditoría fiscal','Contabilidad','Gestión de riesgos','Otros servicios profesionales'];
const ESTADOS_ENCARGO = ['Planificación','Ejecución','En revisión','Cierre','Emitido','Archivado'];
const ESTADOS_AREA = ['No iniciado','En proceso','Pendiente','En revisión','Revisado','Completado'];
const AFIRMACIONES = ['Existencia','Integridad','Derechos y obligaciones','Valuación','Presentación y revelación','Ocurrencia','Exactitud','Corte'];
const AREAS_SUGERIDAS_CATALOGO = ['Efectivo y equivalentes','Cuentas por cobrar','Inventarios','Propiedad, planta y equipo','Inversiones','Cuentas por pagar','Provisiones','Patrimonio','Ingresos','Gastos'];
const TIPOS_EVIDENCIA = ['Documento','Excel','PDF','Imagen','Correo','Confirmación','Contrato','Reporte','Otra evidencia'];
const NIVELES_REVISION = ['Preparador','Senior','Manager','Director','Partner'];
const ESTADOS_REVISION = ['Preparado','En revisión','Comentarios','Revisado','Aprobado'];
const ESTADOS_AJUSTE = ['Pendiente','Aceptado','Rechazado'];
const ESTADOS_HALLAZGO = ['Abierto','En seguimiento','Respondido por cliente','Cerrado'];
const ESTADOS_PT = ['Borrador','En preparación','En revisión','Revisado','Aprobado'];
const TIPOS_INFORME = ['Informe de auditoría','Opinión','Carta de recomendaciones','Comunicación de deficiencias','Informe fiscal','Informes regulatorios','Otros informes'];
const JURISDICCION_NORMA = ['Global','País','Industria'];
const NORMAS_BASE_TIPO = ['NIA/ISA','NIIF/IFRS','NIIF para PYMES','ISQM','Código de Ética','Legislación local','Normativa fiscal','Normativa de regulador','Normativa específica de industria'];
const INDUSTRIAS = ['Comercial','Manufactura','Servicios','Bancos y entidades financieras','Aseguradoras','Construcción','Tecnología','Energía y minería','Agroindustria','Sector público','Organizaciones sin fines de lucro','Otra'];
const MONEDAS = ['USD','EUR','GTQ','MXN','COP','PEN','CRC','HNL','NIO','DOP','PAB','CLP','ARS','BRL'];
const IDIOMAS = ['Español','Inglés','Portugués','Francés'];
const METODOLOGIA_PASOS = [
  {n:1, titulo:'Tareas previas', desc:'Aceptación/continuidad del cliente, independencia y conflictos de interés, carta de contratación.'},
  {n:2, titulo:'Importancia relativa', desc:'Determinación de materialidad global, de ejecución y umbral de diferencias no significativas.'},
  {n:3, titulo:'Comprender la entidad y su ambiente', desc:'Industria, marco regulatorio, factores externos, estructura y gobierno corporativo.'},
  {n:4, titulo:'Discusión sobre fraude', desc:'Reunión del equipo de encargo sobre riesgo de fraude e incorrección material.'},
  {n:5, titulo:'Comprender los procesos de negocio', desc:'Ciclos transaccionales, controles clave y sistemas de información relevantes.'},
  {n:6, titulo:'Analítica preliminar', desc:'Análisis financiero, variaciones, tendencias, ratios y saldos relevantes. Punto de generación de áreas sugeridas.'},
  {n:7, titulo:'Identificar y evaluar riesgos', desc:'Matriz de riesgos y controles, riesgos significativos y de incorrección material.'},
  {n:8, titulo:'Diseñar respuestas generales', desc:'Estrategia de auditoría, naturaleza/oportunidad/alcance de procedimientos.'}
];

/* ============================= SEED / DATOS DEMO ============================= */
function seedDB(){
  const firmaId = uid('firma');
  const paisId1 = uid('pais'), paisId2 = uid('pais');
  const oficinaId1 = uid('oficina'), oficinaId2 = uid('oficina');
  const adminId = uid('user');
  const userManagerId = uid('user');
  const userSeniorId = uid('user');
  const userStaffId = uid('user');
  const rolAdminId = uid('rol'), rolPartnerId = uid('rol'), rolDirectorId = uid('rol'),
        rolManagerId = uid('rol'), rolSeniorId = uid('rol'), rolStaffId = uid('rol'), rolEspId = uid('rol');

  const roles = [
    {id:rolAdminId, nombre:'Administrador', descripcion:'Acceso total a configuración global y todos los encargos.', permisos:{organizacion:true,firmas:true,usuarios:true,clientes:true,encargos:true,normativa:true,auditoriaSistema:true}},
    {id:rolPartnerId, nombre:'Partner / Socio', descripcion:'Responsable final del encargo, aprueba informes y conclusiones.', permisos:{organizacion:false,firmas:false,usuarios:false,clientes:true,encargos:true,normativa:false,auditoriaSistema:false}},
    {id:rolDirectorId, nombre:'Director', descripcion:'Supervisión general y revisión de nivel superior.', permisos:{organizacion:false,firmas:false,usuarios:false,clientes:true,encargos:true,normativa:false,auditoriaSistema:false}},
    {id:rolManagerId, nombre:'Manager', descripcion:'Gestión operativa del encargo, revisión de papeles de trabajo.', permisos:{organizacion:false,firmas:false,usuarios:false,clientes:true,encargos:true,normativa:false,auditoriaSistema:false}},
    {id:rolSeniorId, nombre:'Senior', descripcion:'Ejecución y supervisión de campo, revisión de staff.', permisos:{organizacion:false,firmas:false,usuarios:false,clientes:false,encargos:true,normativa:false,auditoriaSistema:false}},
    {id:rolStaffId, nombre:'Staff', descripcion:'Ejecución de procedimientos y preparación de papeles de trabajo.', permisos:{organizacion:false,firmas:false,usuarios:false,clientes:false,encargos:true,normativa:false,auditoriaSistema:false}},
    {id:rolEspId, nombre:'Usuario especializado', descripcion:'Especialista (TI, valuación, impuestos) con acceso restringido por área.', permisos:{organizacion:false,firmas:false,usuarios:false,clientes:false,encargos:true,normativa:false,auditoriaSistema:false}},
  ];

  const usuarios = [
    {id:adminId, nombre:'Administrador SIGA', email:'admin', usuario:'admin', password:'Admin@2026Test', rolId:rolAdminId, oficinaId:oficinaId1, estado:'Activo', telefono:'', cargo:'Administrador de Sistema'},
    {id:userManagerId, nombre:'Lucía Fernández', email:'lucia.fernandez@firma.com', usuario:'lfernandez', password:'Demo@2026', rolId:rolManagerId, oficinaId:oficinaId1, estado:'Activo', telefono:'', cargo:'Manager de Auditoría'},
    {id:userSeniorId, nombre:'Carlos Ramírez', email:'carlos.ramirez@firma.com', usuario:'cramirez', password:'Demo@2026', rolId:rolSeniorId, oficinaId:oficinaId1, estado:'Activo', telefono:'', cargo:'Senior de Auditoría'},
    {id:userStaffId, nombre:'Andrea Solís', email:'andrea.solis@firma.com', usuario:'asolis', password:'Demo@2026', rolId:rolStaffId, oficinaId:oficinaId2, estado:'Activo', telefono:'', cargo:'Staff de Auditoría'},
  ];

  const firmas = [{id:firmaId, nombre:'Firma Auditora Regional, S.A.', red:'SIGA Global Network', pais:'Regional', estado:'Activa'}];
  const paises = [
    {id:paisId1, nombre:'Guatemala', codigo:'GT', moneda:'GTQ', idioma:'Español', regulador:'Superintendencia de Administración Tributaria (SAT) / Registro Mercantil', calendarioFiscal:'Enero–Diciembre'},
    {id:paisId2, nombre:'México', codigo:'MX', moneda:'MXN', idioma:'Español', regulador:'CNBV / SAT', calendarioFiscal:'Enero–Diciembre'},
  ];
  const oficinas = [
    {id:oficinaId1, nombre:'Oficina Ciudad de Guatemala', paisId:paisId1, direccion:'Zona 10, Ciudad de Guatemala', responsable:'Lucía Fernández'},
    {id:oficinaId2, nombre:'Oficina Ciudad de México', paisId:paisId2, direccion:'CDMX, México', responsable:'Andrea Solís'},
  ];

  const clienteId1 = uid('cli'), clienteId2 = uid('cli');
  const clientes = [
    {id:clienteId1, nombre:'Comercializadora Andina, S.A.', idFiscal:'GT-1234567-8', paisId:paisId1, industria:'Comercial', estado:'Activo', contacto:'Marco Gil', email:'mgil@andina.com', telefono:'+502 2345 6789', firmaResponsable:firmaId, grupoEmpresarial:'Grupo Andina', informacionLegal:'Sociedad Anónima constituida en 2005.', notas:''},
    {id:clienteId2, nombre:'Manufacturas del Istmo, S.A. de C.V.', idFiscal:'MX-9876543-2', paisId:paisId2, industria:'Manufactura', estado:'Activo', contacto:'Paola Núñez', email:'pnunez@istmo.mx', telefono:'+52 55 1234 5678', firmaResponsable:firmaId, grupoEmpresarial:'', informacionLegal:'Sociedad constituida en 2011.', notas:''}
  ];

  const encargoId1 = uid('enc');
  const areaEfectivoId = uid('area'), areaCxCId = uid('area');
  const visitaId1 = uid('vis'), visitaId2 = uid('vis');
  const ptId1 = uid('pt'), ptId2 = uid('pt');
  const evId1 = uid('ev');
  const hallazgoId1 = uid('hal');
  const ajusteId1 = uid('adj');

  const encargos = [{
    id:encargoId1,
    clienteId:clienteId1,
    nombre:'Auditoría Financiera Externa 2025',
    tipo:'Auditoría financiera externa',
    periodoFiscal:'2025-01-01 a 2025-12-31',
    paisId:paisId1,
    firmaId:firmaId,
    industria:'Comercial',
    estado:'Ejecución',
    normativaMarco:'NIIF / IFRS Completas',
    moneda:'GTQ',
    fechaInicio:'2026-01-15',
    fechaEntregaEstimada:'2026-04-15',
    equipo:[
      {usuarioId:userManagerId, rolEncargo:'Manager'},
      {usuarioId:userSeniorId, rolEncargo:'Senior'},
      {usuarioId:userStaffId, rolEncargo:'Staff'}
    ],
    materialidad:{
      materialidadGlobal:1500000, baseGlobal:'Ingresos totales', porcentajeGlobal:1.0,
      materialidadEjecucion:1125000, porcentajeEjecucion:75,
      umbralDiferencias:75000, justificacion:'Se utiliza el 1% de ingresos por tratarse de entidad orientada a resultados operativos estables.'
    },
    metodologia: METODOLOGIA_PASOS.map(p => ({
      paso:p.n,
      estado: p.n<=5 ? 'Completado' : (p.n===6?'Completado':(p.n===7?'En proceso':'Pendiente')),
      responsable: p.n<=2?userManagerId:userSeniorId,
      fechaCompletado: p.n<=6? '2026-02-'+(String(10+p.n)):'',
      notas:''
    })),
    areasSugeridasGeneradas:true,
    riesgos:[
      {id:uid('rie'), descripcion:'Riesgo de sobrevaluación de inventarios por obsolescencia no identificada', tipo:'Significativo', afirmacion:'Valuación', areaId:areaCxCId, probabilidad:'Media', impacto:'Alto', estado:'Identificado'}
    ],
    archivoPermanente:[
      {id:uid('ap'), nombre:'Escritura de constitución', categoria:'Legal', fecha:'2020-01-10', version:'1.0', responsable:'Lucía Fernández', archivo:'escritura_constitucion.pdf'}
    ],
    archivoCorriente:[
      {id:uid('ac'), nombre:'Planificación general 2025', categoria:'Planificación', fecha:'2026-01-20', version:'1.0', responsable:'Carlos Ramírez', archivo:'planificacion_2025.docx'}
    ],
    informes:[
      {id:uid('inf'), tipo:'Informe de auditoría', estado:'Borrador', fecha:'', version:'0.1', responsable:'Lucía Fernández'}
    ],
    horas:[
      {id:uid('hp'), usuarioId:userManagerId, area:'Planificación', horasPresupuestadas:40, horasReales:35, tarifa:120},
      {id:uid('hp'), usuarioId:userSeniorId, area:'Efectivo y equivalentes', horasPresupuestadas:25, horasReales:22, tarifa:75},
      {id:uid('hp'), usuarioId:userStaffId, area:'Cuentas por cobrar', horasPresupuestadas:35, horasReales:38, tarifa:45},
    ],
    revisiones:[
      {id:uid('rev'), nivel:'Senior', referencia:'Efectivo y equivalentes', estado:'Aprobado', fecha:'2026-02-18', responsable:userSeniorId, comentario:'Conforme. Sin observaciones.'},
      {id:uid('rev'), nivel:'Manager', referencia:'Cuentas por cobrar', estado:'Comentarios', fecha:'2026-02-20', responsable:userManagerId, comentario:'Ampliar muestra de confirmaciones a 3 clientes adicionales.'}
    ],
    visitas:[
      {id:visitaId1, nombre:'Visita 1 — Planificación', fecha:'2026-01-20', objetivo:'Levantamiento de información y comprensión del negocio', equipo:[userManagerId,userSeniorId], areasIds:[]},
      {id:visitaId2, nombre:'Visita 2 — Interina', fecha:'2026-03-05', objetivo:'Ejecución de procedimientos sustantivos de ciclos clave', equipo:[userSeniorId,userStaffId], areasIds:[areaEfectivoId, areaCxCId]},
    ],
    areas:[
      {
        id:areaEfectivoId, nombre:'Efectivo y equivalentes', objetivo:'Verificar existencia, integridad y valuación del efectivo al cierre.',
        afirmaciones:['Existencia','Integridad','Valuación'], responsable:userSeniorId, estado:'Revisado', visitaId:visitaId2,
        procedimientos:[
          {id:uid('proc'), descripcion:'Confirmación bancaria directa', tipo:'Sustantivo', estado:'Completado'},
          {id:uid('proc'), descripcion:'Arqueo de caja chica', tipo:'Sustantivo', estado:'Completado'},
        ],
        muestra:{metodo:'No estadístico', tamano:5, criterio:'Saldos mayores al 10% de materialidad de ejecución'},
        conclusion:'Los saldos de efectivo se presentan razonablemente de acuerdo al marco de referencia aplicable.'
      },
      {
        id:areaCxCId, nombre:'Cuentas por cobrar', objetivo:'Evaluar existencia y valuación (estimación de incobrables) de cuentas por cobrar.',
        afirmaciones:['Existencia','Valuación','Presentación y revelación'], responsable:userStaffId, estado:'En revisión', visitaId:visitaId2,
        procedimientos:[
          {id:uid('proc'), descripcion:'Circularización de saldos a clientes seleccionados', tipo:'Sustantivo', estado:'En proceso'},
          {id:uid('proc'), descripcion:'Revisión de antigüedad de saldos y estimación de incobrables', tipo:'Sustantivo', estado:'Pendiente'},
        ],
        muestra:{metodo:'Estadístico (MUM)', tamano:12, criterio:'Muestreo por unidad monetaria sobre saldo total de cartera'},
        conclusion:''
      }
    ],
    papelesTrabajo:[
      {id:ptId1, codigo:'A-100', nombre:'Programa de auditoría — Efectivo', areaId:areaEfectivoId, responsable:userSeniorId, preparador:userStaffId, revisor:userManagerId, fecha:'2026-02-15', estado:'Revisado', version:'1.1', referencia:'A-100', evidenciaId:evId1},
      {id:ptId2, codigo:'B-100', nombre:'Programa de auditoría — Cuentas por cobrar', areaId:areaCxCId, responsable:userStaffId, preparador:userStaffId, revisor:userManagerId, fecha:'2026-02-22', estado:'En revisión', version:'1.0', referencia:'B-100', evidenciaId:''}
    ],
    evidencias:[
      {id:evId1, tipo:'Confirmación', origen:'Banco Industrial', fecha:'2026-02-12', responsable:userSeniorId, descripcion:'Confirmación bancaria de saldos al 31/12/2025', areaId:areaEfectivoId, procedimiento:'Confirmación bancaria directa', papelTrabajoId:ptId1, integridad:'Verificada', archivo:'confirmacion_banco_industrial.pdf'}
    ],
    hallazgos:[
      {id:hallazgoId1, titulo:'Diferencia en conciliación bancaria', condicion:'Se identificó una diferencia no conciliada de GTQ 18,500 entre el libro auxiliar y el estado de cuenta.', criterio:'Los saldos de efectivo deben coincidir con las confirmaciones bancarias y conciliaciones mensuales.', causa:'Cheques en tránsito no registrados oportunamente.', efecto:'Subvaluación menor de efectivo en libros.', recomendacion:'Fortalecer el proceso de conciliación bancaria mensual.', respuestaCliente:'La administración indicó que corregirá el registro en el siguiente cierre.', areaId:areaEfectivoId, estado:'En seguimiento'}
    ],
    ajustes:[
      {id:ajusteId1, cuenta:'Efectivo en bancos', debito:0, credito:18500, descripcion:'Ajuste por diferencia en conciliación bancaria no registrada', estado:'Pendiente', areaId:areaEfectivoId}
    ],
    configuracion:{plantillaMetodologica:'Estándar SIGA v1', parametrosAdicionales:''}
  }];

  const normativas = [
    {id:uid('norm'), norma:'NIA 315 — Identificación y valoración de los riesgos de incorrección material', jurisdiccion:'Global', tipo:'NIA/ISA', version:'2019', vigenteDesde:'2022-01-01', fuenteOficial:'IFAC / IAASB', requisito:'Comprender la entidad y su entorno para identificar y evaluar riesgos.', aplicabilidad:'Todos los encargos de auditoría financiera', procedimientosRelacionados:'Paso 3, Paso 5, Paso 7'},
    {id:uid('norm'), norma:'NIA 320 — Importancia relativa en la planificación y ejecución', jurisdiccion:'Global', tipo:'NIA/ISA', version:'2019', vigenteDesde:'2022-01-01', fuenteOficial:'IFAC / IAASB', requisito:'Determinación de materialidad global y de ejecución.', aplicabilidad:'Todos los encargos de auditoría financiera', procedimientosRelacionados:'Paso 2'},
    {id:uid('norm'), norma:'ISQM 1 — Gestión de calidad para firmas', jurisdiccion:'Global', tipo:'ISQM', version:'2022', vigenteDesde:'2023-01-01', fuenteOficial:'IFAC / IAASB', requisito:'Sistema de gestión de calidad a nivel de firma.', aplicabilidad:'Toda la firma', procedimientosRelacionados:'Aceptación y continuidad, Revisión y supervisión'},
    {id:uid('norm'), norma:'Código de Ética para Profesionales de la Contabilidad', jurisdiccion:'Global', tipo:'Código de Ética', version:'2023', vigenteDesde:'2023-01-01', fuenteOficial:'IESBA', requisito:'Independencia y objetividad del auditor y del equipo.', aplicabilidad:'Todos los encargos', procedimientosRelacionados:'Tareas previas'},
    {id:uid('norm'), norma:'Código de Comercio — Registro Mercantil', jurisdiccion:'País', pais:'Guatemala', tipo:'Legislación local', version:'Vigente', vigenteDesde:'—', fuenteOficial:'Congreso de la República de Guatemala', requisito:'Obligaciones mercantiles y de registro de sociedades.', aplicabilidad:'Clientes constituidos en Guatemala', procedimientosRelacionados:'Archivo permanente'},
    {id:uid('norm'), norma:'Ley del Impuesto Sobre la Renta', jurisdiccion:'País', pais:'Guatemala', tipo:'Normativa fiscal', version:'Vigente', vigenteDesde:'—', fuenteOficial:'SAT Guatemala', requisito:'Determinación y cumplimiento de obligaciones tributarias.', aplicabilidad:'Clientes en Guatemala', procedimientosRelacionados:'Área de impuestos, Informe fiscal'},
    {id:uid('norm'), norma:'NIIF 9 — Instrumentos Financieros', jurisdiccion:'Industria', industria:'Bancos y entidades financieras', tipo:'NIIF/IFRS', version:'2018', vigenteDesde:'2018-01-01', fuenteOficial:'IASB', requisito:'Clasificación, medición y deterioro de instrumentos financieros.', aplicabilidad:'Entidades financieras y bancos', procedimientosRelacionados:'Área de inversiones, cartera de créditos'},
  ];

  const bitacora = [
    {id:uid('log'), fecha:nowISO(), usuario:'admin', accion:'Inicialización del sistema (datos de demostración cargados).', entidad:'Sistema'}
  ];

  return {
    version:1,
    config:{
      nombreOrganizacion:'SIGA Global Network',
      colorPrimario:'#0e2440',
      colorAcento:'#c9a227',
      logoFirmaTexto:'FIRMA',
      logoLocalTexto:'LOCAL',
      fondoLogin:'default',
      idiomaDefault:'Español',
      monedaDefault:'USD'
    },
    firmas, paises, oficinas, roles, usuarios, clientes, encargos, normativas, bitacora,
    session:null
  };
}

/* ============================= DB (estado en memoria) ============================= */
let DB = Store.load() || seedDB();
if(!DB.bitacora) DB.bitacora = [];
function saveDB(){ Store.save(DB); }

function logAction(accion, entidad){
  DB.bitacora.unshift({id:uid('log'), fecha:nowISO(), usuario:(DB.session?DB.session.usuario:'sistema'), accion, entidad:entidad||''});
  if(DB.bitacora.length>500) DB.bitacora.length = 500;
  saveDB();
}

/* Lookups */
const getUser = id => byId(DB.usuarios, id);
const getUserName = id => { const u=getUser(id); return u? u.nombre : '—'; };
const getRol = id => byId(DB.roles, id);
const getRolName = id => { const r=getRol(id); return r? r.nombre : '—'; };
const getPais = id => byId(DB.paises, id);
const getPaisName = id => { const p=getPais(id); return p? p.nombre : '—'; };
const getOficina = id => byId(DB.oficinas, id);
const getFirma = id => byId(DB.firmas, id);
const getCliente = id => byId(DB.clientes, id);
const getEncargo = id => byId(DB.encargos, id);
const getArea = (enc, id) => byId(enc.areas, id);

window.SIGA_DEBUG = {DB, resetDemo(){ Store.reset(); location.reload(); }};

/* Exponer utilidades a otras partes del script (misma IIFE, ver parte 2) */
window.__SIGA_CORE__ = {
  uid, nowISO, todayStr, escapeHtml, fmtDate, fmtDateTime, fmtMoney, fmtHours, initials, byId, debounce, toast,
  Store, DB: ()=>DB, setDB:(d)=>{DB=d;}, saveDB, logAction,
  ROLES_BASE, ESTADOS_CLIENTE, TIPOS_ENCARGO, ESTADOS_ENCARGO, ESTADOS_AREA, AFIRMACIONES,
  AREAS_SUGERIDAS_CATALOGO, TIPOS_EVIDENCIA, NIVELES_REVISION, ESTADOS_REVISION, ESTADOS_AJUSTE,
  ESTADOS_HALLAZGO, ESTADOS_PT, TIPOS_INFORME, JURISDICCION_NORMA, NORMAS_BASE_TIPO, INDUSTRIAS,
  MONEDAS, IDIOMAS, METODOLOGIA_PASOS,
  getUser, getUserName, getRol, getRolName, getPais, getPaisName, getOficina, getFirma, getCliente, getEncargo, getArea,
  seedDB
};

})();

/* =========================================================================
   PARTE 2 — UI CORE: Modal, Toast, Confirmaciones, Motor de formularios
   genérico y CRUD reutilizable (schema-driven) para minimizar duplicación
   entre los ~20 módulos de datos de SIGA.
   ========================================================================= */
(function(){
"use strict";
const C = window.__SIGA_CORE__;
const {uid, escapeHtml, fmtDate, toast, saveDB, logAction} = C;
const DBref = () => C.DB();

/* ---------- MODAL ---------- */
const modalOverlay = document.getElementById('modalOverlay');
const modalBox = document.getElementById('modalBox');
let modalCloseCallback = null;

function closeModal(){
  modalOverlay.classList.remove('show');
  modalBox.innerHTML = '';
  if(modalCloseCallback){ const cb=modalCloseCallback; modalCloseCallback=null; cb(); }
}
modalOverlay.addEventListener('click', (e)=>{ if(e.target===modalOverlay) closeModal(); });
document.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && modalOverlay.classList.contains('show')) closeModal(); });

function openModal(html, onClose){
  modalBox.innerHTML = html;
  modalOverlay.classList.add('show');
  modalOverlay.scrollTop = 0;
  modalCloseCallback = onClose || null;
}

function confirmDialog(title, message, onConfirm, opts){
  opts = opts||{};
  openModal(`
    <div class="modal-head"><h3>${escapeHtml(title)}</h3><button class="modal-close" data-close>×</button></div>
    <div class="modal-body"><p style="margin:0;font-size:13.5px;color:var(--text);line-height:1.55;">${message}</p></div>
    <div class="modal-foot">
      <button class="btn btn-secondary" data-close>Cancelar</button>
      <button class="btn ${opts.danger?'btn-danger-ghost' : 'btn-gold'}" id="confirmYesBtn" style="${opts.danger?'background:var(--danger);color:#fff;':''}">${opts.confirmLabel||'Confirmar'}</button>
    </div>
  `);
  modalBox.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click', closeModal));
  modalBox.querySelector('#confirmYesBtn').addEventListener('click', ()=>{ closeModal(); onConfirm(); });
}
window.confirmDialog = confirmDialog;
window.closeModalGlobal = closeModal;

/* ---------- FORM ENGINE (schema-driven) ----------
   schema field: {key, label, type: text|textarea|select|multiselect|date|number|email|password|checkbox,
                  options(array or fn), required, span('full'|undefined), placeholder, hint, disabled}
------------------------------------------------------ */
function fieldHtml(f, value){
  const opts = typeof f.options==='function' ? f.options() : (f.options||[]);
  const req = f.required ? 'required' : '';
  const dis = f.disabled ? 'disabled' : '';
  let inner = '';
  if(f.type==='select'){
    inner = `<select name="${f.key}" ${req} ${dis}>
      <option value="">Seleccione...</option>
      ${opts.map(o=>{
        const ov = typeof o==='object'? o.value : o;
        const ol = typeof o==='object'? o.label : o;
        return `<option value="${escapeHtml(ov)}" ${String(value)===String(ov)?'selected':''}>${escapeHtml(ol)}</option>`;
      }).join('')}
    </select>`;
  } else if(f.type==='multiselect'){
    const vals = Array.isArray(value) ? value : [];
    inner = `<div class="multiselect-box" data-msfield="${f.key}">
      ${opts.map(o=>{
        const ov = typeof o==='object'? o.value : o;
        const ol = typeof o==='object'? o.label : o;
        return `<label class="ms-opt"><input type="checkbox" value="${escapeHtml(ov)}" ${vals.includes(ov)?'checked':''}> ${escapeHtml(ol)}</label>`;
      }).join('')}
    </div>`;
  } else if(f.type==='textarea'){
    inner = `<textarea name="${f.key}" ${req} ${dis} placeholder="${escapeHtml(f.placeholder||'')}">${escapeHtml(value||'')}</textarea>`;
  } else if(f.type==='checkbox'){
    inner = `<label class="checkbox-row" style="margin-top:6px;"><input type="checkbox" name="${f.key}" ${value?'checked':''}> ${escapeHtml(f.checkboxLabel||'Sí')}</label>`;
  } else {
    const t = f.type||'text';
    inner = `<input type="${t}" name="${f.key}" value="${escapeHtml(value===undefined||value===null?'':value)}" ${req} ${dis} placeholder="${escapeHtml(f.placeholder||'')}" ${f.step?`step="${f.step}"`:''}>`;
  }
  return `<div class="field ${f.span==='full'?'full':''}">
    <label>${escapeHtml(f.label)}${f.required?' *':''}</label>
    ${inner}
    ${f.hint?`<div class="field-hint">${escapeHtml(f.hint)}</div>`:''}
  </div>`;
}

function formModal({title, subtitle, schema, values, submitLabel, onSubmit, extraFooterHtml}){
  values = values || {};
  openModal(`
    <div class="modal-head">
      <div><h3>${escapeHtml(title)}</h3>${subtitle?`<p>${escapeHtml(subtitle)}</p>`:''}</div>
      <button class="modal-close" data-close>×</button>
    </div>
    <form id="genForm">
      <div class="modal-body">
        <div class="form-grid">
          ${schema.map(f=>fieldHtml(f, values[f.key])).join('')}
        </div>
      </div>
      <div class="modal-foot">
        ${extraFooterHtml||''}
        <button type="button" class="btn btn-secondary" data-close>Cancelar</button>
        <button type="submit" class="btn btn-gold">${submitLabel||'Guardar'}</button>
      </div>
    </form>
  `);
  modalBox.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click', closeModal));
  const form = modalBox.querySelector('#genForm');
  form.addEventListener('submit', (e)=>{
    e.preventDefault();
    const result = {};
    schema.forEach(f=>{
      if(f.type==='multiselect'){
        const box = form.querySelector(`[data-msfield="${f.key}"]`);
        result[f.key] = Array.from(box.querySelectorAll('input[type=checkbox]:checked')).map(i=>i.value);
      } else if(f.type==='checkbox'){
        result[f.key] = form.elements[f.key].checked;
      } else if(f.type==='number'){
        const v = form.elements[f.key].value;
        result[f.key] = v===''? '' : Number(v);
      } else {
        result[f.key] = form.elements[f.key] ? form.elements[f.key].value : '';
      }
    });
    onSubmit(result);
  });
  // focus first field
  setTimeout(()=>{ const first = form.querySelector('input,select,textarea'); if(first) first.focus(); }, 30);
}
window.formModal = formModal;

/* ---------- BADGE helper ---------- */
const BADGE_MAP = {
  'Activo':'badge-green','Activa':'badge-green','Aprobado':'badge-green','Completado':'badge-green','Revisado':'badge-green','Cerrado':'badge-green','Aceptado':'badge-green','Emitido':'badge-green',
  'Inactivo':'badge-gray','Archivado':'badge-gray','Borrador':'badge-gray','No iniciado':'badge-gray','Pendiente':'badge-amber',
  'En configuración':'badge-blue','En proceso':'badge-blue','En preparación':'badge-blue','Preparado':'badge-blue','Planificación':'badge-blue','En ejecución':'badge-blue','Ejecución':'badge-blue','Identificado':'badge-blue','Abierto':'badge-blue',
  'En revisión':'badge-gold','Comentarios':'badge-amber','En seguimiento':'badge-amber','Rechazado':'badge-red','Respondido por cliente':'badge-blue','Cierre':'badge-gold','Significativo':'badge-red'
};
function badge(estado){
  const cls = BADGE_MAP[estado] || 'badge-gray';
  return `<span class="badge ${cls}">${escapeHtml(estado||'—')}</span>`;
}
window.badgeHtml = badge;

/* ---------- Tabla genérica ---------- */
function renderTable({columns, rows, onRowClick, actions, emptyIcon, emptyTitle, emptyDesc}){
  if(!rows || rows.length===0){
    return `<div class="empty-state">
      <div class="es-icon">${emptyIcon||'📄'}</div>
      <h4>${escapeHtml(emptyTitle||'Sin registros')}</h4>
      <p>${escapeHtml(emptyDesc||'Aún no se han creado elementos en este módulo.')}</p>
    </div>`;
  }
  return `<div class="table-scroll"><table>
    <thead><tr>${columns.map(c=>`<th>${escapeHtml(c.label)}</th>`).join('')}${actions?'<th></th>':''}</tr></thead>
    <tbody>
      ${rows.map((row,idx)=>`<tr ${onRowClick?'class="clickable"':''} data-rowidx="${idx}">
        ${columns.map(c=> `<td>${c.render? c.render(row) : escapeHtml(row[c.key]??'—')}</td>`).join('')}
        ${actions? `<td class="actions-cell">${actions(row)}</td>`:''}
      </tr>`).join('')}
    </tbody>
  </table></div>`;
}
window.renderTableHtml = renderTable;

/* Adjuntar handler de click a filas de una tabla ya insertada en el DOM */
function wireRowClicks(container, rows, handler){
  container.querySelectorAll('tr[data-rowidx]').forEach(tr=>{
    tr.addEventListener('click', (e)=>{
      if(e.target.closest('[data-stop]')) return;
      const idx = Number(tr.getAttribute('data-rowidx'));
      handler(rows[idx]);
    });
  });
}
window.wireRowClicksGlobal = wireRowClicks;

window.__SIGA_UI__ = {openModal, closeModal, confirmDialog, formModal, fieldHtml, badge, renderTable, wireRowClicks};

})();

/* =========================================================================
   PARTE 3 — AUTENTICACIÓN Y LAYOUT DE APLICACIÓN
   ========================================================================= */
(function(){
"use strict";
const C = window.__SIGA_CORE__;
const UI = window.__SIGA_UI__;
const {escapeHtml, toast, saveDB, logAction, initials} = C;
const DBref = () => C.DB();

/* ---------- LOGIN ---------- */
const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');

function applyBranding(){
  const db = DBref();
  const cfg = db.config;
  document.documentElement.style.setProperty('--navy-900', cfg.colorPrimario || '#0e2440');
  document.documentElement.style.setProperty('--gold-500', cfg.colorAcento || '#c9a227');
  const firma = db.firmas[0];
  document.getElementById('loginFirmName').textContent = firma ? firma.nombre : cfg.nombreOrganizacion;
  document.getElementById('loginNetworkName').textContent = cfg.nombreOrganizacion;
  document.getElementById('loginLogoLocal').textContent = cfg.logoLocalTexto || 'LOGO LOCAL';
  document.getElementById('loginLogoFirma').textContent = cfg.logoFirmaTexto || 'LOGO FIRMA';
  document.getElementById('brandMarkLogin').textContent = (cfg.nombreOrganizacion||'S').charAt(0);
  document.getElementById('topbarBrandMark').textContent = (cfg.nombreOrganizacion||'S').charAt(0);
  document.getElementById('loginYearTag').textContent = '© ' + new Date().getFullYear() + ' ' + (firma?firma.nombre:'SIGA');
}

function doLogin(usuario, pass){
  const db = DBref();
  const user = db.usuarios.find(u => (u.usuario===usuario || u.email===usuario) && u.password===pass);
  const errEl = document.getElementById('loginError');
  if(!user){
    errEl.textContent = 'Usuario o contraseña incorrectos.';
    errEl.classList.add('show');
    return false;
  }
  if(user.estado !== 'Activo'){
    errEl.textContent = 'El usuario se encuentra inactivo. Contacte al administrador del sistema.';
    errEl.classList.add('show');
    return false;
  }
  errEl.classList.remove('show');
  db.session = {usuarioId:user.id, usuario:user.usuario, nombre:user.nombre, rolId:user.rolId, loginAt:C.nowISO()};
  saveDB();
  logAction('Inicio de sesión', 'Usuario: '+user.nombre);
  enterApp();
  return true;
}

document.getElementById('loginForm').addEventListener('submit', (e)=>{
  e.preventDefault();
  const u = document.getElementById('loginUser').value.trim();
  const p = document.getElementById('loginPass').value;
  doLogin(u,p);
});
document.getElementById('msLoginBtn').addEventListener('click', ()=>{
  toast('El inicio de sesión con Microsoft 365 requiere integración SSO configurada por el administrador del tenant.', 'info');
});
document.getElementById('forgotBtn').addEventListener('click', ()=>{
  toast('Se enviaría un correo de recuperación. (Simulado en este prototipo.)', 'info');
});

function doLogout(){
  const db = DBref();
  logAction('Cierre de sesión', 'Usuario: '+(db.session?db.session.nombre:''));
  db.session = null;
  saveDB();
  appScreen.classList.remove('active');
  loginScreen.classList.remove('hidden');
  document.getElementById('loginUser').value='';
  document.getElementById('loginPass').value='';
}
window.SIGA_LOGOUT = doLogout;

function enterApp(){
  applyBranding();
  loginScreen.classList.add('hidden');
  appScreen.classList.add('active');
  const db = DBref();
  const user = C.getUser(db.session.usuarioId);
  document.getElementById('userAvatar').textContent = initials(user.nombre);
  document.getElementById('userChipName').textContent = user.nombre;
  document.getElementById('userChipRole').textContent = C.getRolName(user.rolId);
  buildSidebar();
  Router.go('dashboard');
}

document.getElementById('userChip').addEventListener('click', ()=>{
  const db = DBref();
  const user = C.getUser(db.session.usuarioId);
  UI.openModal(`
    <div class="modal-head"><h3>Mi cuenta</h3><button class="modal-close" data-close>×</button></div>
    <div class="modal-body">
      <div class="detail-list">
        <div class="dl-row"><div class="dl-key">Nombre</div><div class="dl-val">${escapeHtml(user.nombre)}</div></div>
        <div class="dl-row"><div class="dl-key">Usuario</div><div class="dl-val">${escapeHtml(user.usuario)}</div></div>
        <div class="dl-row"><div class="dl-key">Correo</div><div class="dl-val">${escapeHtml(user.email)}</div></div>
        <div class="dl-row"><div class="dl-key">Rol</div><div class="dl-val">${C.getRolName(user.rolId)}</div></div>
        <div class="dl-row"><div class="dl-key">Oficina</div><div class="dl-val">${escapeHtml(C.getOficina(user.oficinaId)?.nombre||'—')}</div></div>
        <div class="dl-row"><div class="dl-key">Cargo</div><div class="dl-val">${escapeHtml(user.cargo||'—')}</div></div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-secondary" data-close>Cerrar</button>
      <button class="btn btn-danger-ghost" id="logoutBtn2">Cerrar sesión</button>
    </div>
  `);
  document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click', UI.closeModal));
  document.getElementById('logoutBtn2').addEventListener('click', ()=>{ UI.closeModal(); doLogout(); });
});

document.getElementById('notifBtn').addEventListener('click', ()=>{
  const db = DBref();
  const items = [];
  db.encargos.forEach(enc=>{
    enc.revisiones.filter(r=>r.estado==='Comentarios').forEach(r=>{
      items.push(`Comentarios pendientes en <b>${escapeHtml(r.referencia)}</b> — encargo ${escapeHtml(enc.nombre)}`);
    });
    enc.ajustes.filter(a=>a.estado==='Pendiente').forEach(a=>{
      items.push(`Ajuste pendiente de resolución en <b>${escapeHtml(enc.nombre)}</b>: ${escapeHtml(a.descripcion)}`);
    });
  });
  UI.openModal(`
    <div class="modal-head"><h3>Notificaciones</h3><button class="modal-close" data-close>×</button></div>
    <div class="modal-body">
      ${items.length? `<div class="timeline">${items.map(i=>`<div class="timeline-item"><div class="ti-note">${i}</div></div>`).join('')}</div>` :
      `<div class="empty-state"><div class="es-icon">🔔</div><h4>Sin notificaciones</h4><p>No hay alertas pendientes por el momento.</p></div>`}
    </div>
    <div class="modal-foot"><button class="btn btn-secondary" data-close>Cerrar</button></div>
  `);
  document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click', UI.closeModal));
});
document.getElementById('helpBtn').addEventListener('click', ()=>{
  UI.openModal(`
    <div class="modal-head"><h3>Acerca de SIGA</h3><button class="modal-close" data-close>×</button></div>
    <div class="modal-body" style="font-size:13px;line-height:1.6;">
      <p><b>SIGA — Sistema Integral de Gestión de Auditorías</b> administra de extremo a extremo auditorías financieras externas bajo una arquitectura modular Global Core + Capa Local por país.</p>
      <p>Jerarquía: Firma → País → Oficina → Cliente → Encargo → Período → Área/Ciclo → Riesgo → Control → Procedimiento → Evidencia → Hallazgo → Conclusión.</p>
      <p style="color:var(--text-muted);">Este es un prototipo funcional (frontend) con persistencia local en el navegador, construido para validar flujos y estructura antes de la implementación de backend/API/base de datos multi-tenant.</p>
    </div>
    <div class="modal-foot"><button class="btn btn-secondary" data-close>Cerrar</button></div>
  `);
  document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click', UI.closeModal));
});

/* ---------- SIDEBAR ---------- */
const NAV_ITEMS = [
  {key:'dashboard', icon:'📊', label:'Dashboard Ejecutivo'},
  {key:'clientes', icon:'🏢', label:'Clientes'},
  {key:'encargos', icon:'📁', label:'Encargos'},
  {key:'normativa', icon:'⚖️', label:'Motor Normativo'},
  {key:'config', icon:'⚙️', label:'Configuración', sub:[
    {key:'config-organizacion', label:'Organización e Identidad'},
    {key:'config-firmas', label:'Firmas'},
    {key:'config-paises', label:'Países'},
    {key:'config-oficinas', label:'Oficinas'},
    {key:'config-usuarios', label:'Usuarios'},
    {key:'config-roles', label:'Roles y Permisos'},
    {key:'config-auditoria', label:'Bitácora del Sistema'},
  ]},
];

function buildSidebar(){
  const sidebar = document.getElementById('sidebar');
  sidebar.innerHTML = `
    <div class="sidebar-section">
      <div class="sidebar-label">Navegación</div>
      ${NAV_ITEMS.map(item=>{
        if(item.sub){
          return `<div class="nav-item" data-nav="${item.key}" data-parent="1">
            <span class="ic">${item.icon}</span><span>${item.label}</span><span class="chev">▸</span>
          </div>
          <div class="nav-sub" id="sub-${item.key}">
            ${item.sub.map(s=>`<div class="nav-item" data-nav="${s.key}"><span class="ic">·</span><span>${s.label}</span></div>`).join('')}
          </div>`;
        }
        return `<div class="nav-item" data-nav="${item.key}"><span class="ic">${item.icon}</span><span>${item.label}</span></div>`;
      }).join('')}
    </div>
    <div class="sidebar-footer">SIGA v1.0 — Prototipo funcional<br>Motor: Global Core + Capa Local</div>
  `;
  sidebar.querySelectorAll('[data-nav]').forEach(el=>{
    el.addEventListener('click', ()=>{
      const key = el.getAttribute('data-nav');
      if(el.getAttribute('data-parent')){
        el.classList.toggle('open');
        document.getElementById('sub-'+key).classList.toggle('open');
        return;
      }
      Router.go(key);
      if(window.innerWidth<=900){ document.getElementById('sidebar').classList.remove('open'); document.getElementById('mobileOverlay').classList.remove('show'); }
    });
  });
}
function setActiveNav(key){
  document.querySelectorAll('.nav-item').forEach(el=>el.classList.remove('active'));
  const el = document.querySelector(`.nav-item[data-nav="${key}"]`);
  if(el){
    el.classList.add('active');
    const sub = el.closest('.nav-sub');
    if(sub){
      sub.classList.add('open');
      const parentKey = sub.id.replace('sub-','');
      const parentEl = document.querySelector(`.nav-item[data-nav="${parentKey}"]`);
      if(parentEl) parentEl.classList.add('open');
    }
  }
}

document.getElementById('hamburger').addEventListener('click', ()=>{
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('mobileOverlay').classList.toggle('show');
});
document.getElementById('mobileOverlay').addEventListener('click', ()=>{
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('mobileOverlay').classList.remove('show');
});

/* ---------- BREADCRUMB TRAIL ---------- */
function setBreadcrumb(crumbs){
  const el = document.getElementById('breadcrumbTrail');
  el.innerHTML = crumbs.map((c,i)=>`${i>0?'<span class="sep">›</span>':''}<span class="crumb">${c.strong?`<b>${escapeHtml(c.label)}</b>`:escapeHtml(c.label)}</span>`).join('');
}
window.setBreadcrumbGlobal = setBreadcrumb;

/* ---------- ROUTER ---------- */
const mainContent = document.getElementById('mainContent');
const Router = {
  current:null,
  params:{},
  go(view, params){
    Router.current = view;
    Router.params = params || {};
    setActiveNav(view);
    mainContent.scrollTop = 0;
    window.scrollTo(0,0);
    Views.render(view, Router.params);
  },
  refresh(){ Views.render(Router.current, Router.params); }
};
window.Router = Router;
window.mainContentEl = mainContent;

window.__SIGA_APP__ = {enterApp, doLogin, doLogout, buildSidebar};

/* Si ya existe sesión guardada, entrar directo */
document.addEventListener('DOMContentLoaded', ()=>{
  const db = DBref();
  if(db.session && C.getUser(db.session.usuarioId)){
    enterApp();
  }
});

})();

/* =========================================================================
   PARTE 4 — VISTAS: Dashboard Ejecutivo, Clientes
   ========================================================================= */
(function(){
"use strict";
const C = window.__SIGA_CORE__;
const UI = window.__SIGA_UI__;
const {escapeHtml, fmtDate, fmtMoney, fmtHours, toast, saveDB, logAction} = C;
const DBref = () => C.DB();
const Views = window.Views = window.Views || {};

/* ---------------- DASHBOARD EJECUTIVO ---------------- */
Views.dashboard = function(){
  window.setBreadcrumbGlobal([{label:'SIGA', strong:true}, {label:'Dashboard Ejecutivo'}]);
  const db = DBref();
  const totalClientes = db.clientes.length;
  const activos = db.clientes.filter(c=>c.estado==='Activo').length;
  const totalEncargos = db.encargos.length;
  const enEjecucion = db.encargos.filter(e=>e.estado==='Ejecución').length;
  let horasPres=0, horasReal=0;
  db.encargos.forEach(e=> e.horas.forEach(h=>{ horasPres+=Number(h.horasPresupuestadas)||0; horasReal+=Number(h.horasReales)||0; }));
  let hallazgosAbiertos=0, ajustesPendientes=0;
  db.encargos.forEach(e=>{ hallazgosAbiertos += e.hallazgos.filter(h=>h.estado!=='Cerrado').length; ajustesPendientes += e.ajustes.filter(a=>a.estado==='Pendiente').length; });

  const encargosPorEstado = {};
  ESTADOS_ENCARGO_LOCAL().forEach(s=>encargosPorEstado[s]=0);
  db.encargos.forEach(e=>{ encargosPorEstado[e.estado]=(encargosPorEstado[e.estado]||0)+1; });

  function ESTADOS_ENCARGO_LOCAL(){ return C.ESTADOS_ENCARGO; }

  const proximasVisitas = [];
  db.encargos.forEach(e=>{
    (e.visitas||[]).forEach(v=>{
      if(v.fecha >= C.todayStr()){ proximasVisitas.push({...v, encargoNombre:e.nombre, clienteNombre:C.getCliente(e.clienteId)?.nombre}); }
    });
  });
  proximasVisitas.sort((a,b)=> a.fecha.localeCompare(b.fecha));

  mainContentEl.innerHTML = `
  <div class="page-wrap">
    <div class="page-header">
      <div><h1>Dashboard Ejecutivo</h1><p class="desc">Monitoreo en tiempo real del portafolio de clientes, encargos y desempeño operativo de la firma.</p></div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Clientes</span><span class="kpi-icon" style="background:var(--info-bg);color:var(--info);">🏢</span></div><div class="kpi-value">${totalClientes}</div><div class="kpi-sub">${activos} activos</div></div>
      <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Encargos</span><span class="kpi-icon" style="background:var(--gold-100);color:#8a6a10;">📁</span></div><div class="kpi-value">${totalEncargos}</div><div class="kpi-sub">${enEjecucion} en ejecución</div></div>
      <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Horas (Pres. vs Real)</span><span class="kpi-icon" style="background:var(--success-bg);color:var(--success);">⏱️</span></div><div class="kpi-value">${Math.round(horasReal)}<span style="font-size:15px;color:var(--text-muted);"> / ${Math.round(horasPres)}</span></div><div class="kpi-sub">${horasPres? Math.round(horasReal/horasPres*100):0}% del presupuesto consumido</div></div>
      <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Hallazgos abiertos</span><span class="kpi-icon" style="background:var(--warning-bg);color:var(--warning);">🔎</span></div><div class="kpi-value">${hallazgosAbiertos}</div><div class="kpi-sub">${ajustesPendientes} ajustes pendientes</div></div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div><h3>Encargos por estado</h3><p>Distribución del portafolio activo</p></div></div>
        <div class="card-body">
          ${Object.entries(encargosPorEstado).map(([estado,count])=>`
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
              <div style="width:110px;font-size:12.5px;font-weight:600;color:var(--text-muted);">${escapeHtml(estado)}</div>
              <div class="progress-track" style="flex:1;"><div class="progress-fill" style="width:${totalEncargos? (count/totalEncargos*100):0}%;"></div></div>
              <div style="width:22px;text-align:right;font-weight:700;font-size:12.5px;">${count}</div>
            </div>`).join('')}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div><h3>Próximas visitas</h3><p>Visitas de auditoría programadas</p></div></div>
        <div class="card-body pad0">
          ${proximasVisitas.length? `<div class="table-scroll"><table><thead><tr><th>Fecha</th><th>Visita</th><th>Encargo</th></tr></thead><tbody>
            ${proximasVisitas.slice(0,6).map(v=>`<tr><td>${fmtDate(v.fecha)}</td><td>${escapeHtml(v.nombre)}</td><td>${escapeHtml(v.encargoNombre)}</td></tr>`).join('')}
          </tbody></table></div>` : `<div class="empty-state"><div class="es-icon">🗓️</div><h4>Sin visitas próximas</h4><p>No hay visitas programadas a futuro.</p></div>`}
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div><h3>Encargos recientes</h3><p>Acceso rápido al dashboard de cada encargo</p></div>
        <button class="btn btn-gold btn-sm" id="dashNewEncargoBtn">+ Nuevo encargo</button>
      </div>
      <div class="card-body pad0" id="dashEncargosTableWrap"></div>
    </div>
  </div>`;

  const rows = [...db.encargos].sort((a,b)=> (b.fechaInicio||'').localeCompare(a.fechaInicio||'')).slice(0,8);
  document.getElementById('dashEncargosTableWrap').innerHTML = UI.renderTable({
    columns:[
      {label:'Encargo', render:r=>`<b>${escapeHtml(r.nombre)}</b>`},
      {label:'Cliente', render:r=>escapeHtml(C.getCliente(r.clienteId)?.nombre||'—')},
      {label:'País', render:r=>escapeHtml(C.getPaisName(r.paisId))},
      {label:'Tipo', key:'tipo'},
      {label:'Estado', render:r=>UI.badge(r.estado)},
    ],
    rows, actions:()=>'',
    emptyIcon:'📁', emptyTitle:'Sin encargos', emptyDesc:'Cree su primer encargo de auditoría desde el módulo Clientes o Encargos.'
  });
  UI.wireRowClicks(document.getElementById('dashEncargosTableWrap'), rows, (r)=> Router.go('encargo-workspace', {encargoId:r.id, tab:'info'}));
  document.getElementById('dashNewEncargoBtn').addEventListener('click', ()=> Modules.openEncargoForm());
};

/* ---------------- CLIENTES ---------------- */
Views.clientes = function(){
  window.setBreadcrumbGlobal([{label:'SIGA', strong:true}, {label:'Clientes'}]);
  const db = DBref();
  mainContentEl.innerHTML = `
  <div class="page-wrap">
    <div class="page-header">
      <div><h1>Gestión de Clientes</h1><p class="desc">Administración de clientes, grupos económicos, partes relacionadas e información general por cliente.</p></div>
      <div class="page-actions"><button class="btn btn-gold" id="newClienteBtn">+ Crear cliente</button></div>
    </div>
    <div class="card"><div class="card-body pad0" id="clientesTableWrap"></div></div>
  </div>`;

  function paint(){
    const rows = db.clientes;
    document.getElementById('clientesTableWrap').innerHTML = UI.renderTable({
      columns:[
        {label:'Cliente', render:r=>`<b>${escapeHtml(r.nombre)}</b><br><span class="tag-mono">${escapeHtml(r.idFiscal)}</span>`},
        {label:'País', render:r=>escapeHtml(C.getPaisName(r.paisId))},
        {label:'Industria', key:'industria'},
        {label:'Contacto', render:r=>`${escapeHtml(r.contacto)}<br><span style="color:var(--text-muted);font-size:11.5px;">${escapeHtml(r.email)}</span>`},
        {label:'Encargos', render:r=> db.encargos.filter(e=>e.clienteId===r.id).length},
        {label:'Estado', render:r=>UI.badge(r.estado)},
      ],
      rows,
      actions:(r)=>`<button class="btn btn-ghost btn-sm" data-stop data-editcli="${r.id}">Editar</button>`,
      emptyIcon:'🏢', emptyTitle:'Sin clientes registrados', emptyDesc:'Cree el primer cliente para comenzar a administrar encargos de auditoría.'
    });
    UI.wireRowClicks(document.getElementById('clientesTableWrap'), rows, (r)=> Views.clienteDetail(r.id));
    document.querySelectorAll('[data-editcli]').forEach(b=> b.addEventListener('click', (e)=>{ e.stopPropagation(); Modules.openClienteForm(b.getAttribute('data-editcli'), paint); }));
  }
  paint();
  document.getElementById('newClienteBtn').addEventListener('click', ()=> Modules.openClienteForm(null, paint));
};

Views.clienteDetail = function(clienteId){
  const db = DBref();
  const cliente = C.getCliente(clienteId);
  if(!cliente){ Router.go('clientes'); return; }
  window.setBreadcrumbGlobal([{label:'SIGA', strong:true}, {label:'Clientes'}, {label:cliente.nombre, strong:true}]);
  const encargosCliente = db.encargos.filter(e=>e.clienteId===clienteId);

  mainContentEl.innerHTML = `
  <div class="page-wrap">
    <div class="page-header">
      <div>
        <div style="margin-bottom:6px;"><button class="btn btn-ghost btn-sm" id="backToClientes">← Clientes</button></div>
        <h1>${escapeHtml(cliente.nombre)}</h1>
        <p class="desc">${escapeHtml(cliente.idFiscal)} · ${escapeHtml(C.getPaisName(cliente.paisId))} · ${escapeHtml(cliente.industria)} ${UI.badge(cliente.estado)}</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-secondary" id="editClienteBtn2">Editar cliente</button>
        <button class="btn btn-gold" id="newEncargoForClientBtn">+ Nuevo encargo</button>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-head"><h3>Información general</h3></div>
        <div class="card-body">
          <div class="detail-list">
            <div class="dl-row"><div class="dl-key">Firma responsable</div><div class="dl-val">${escapeHtml(C.getFirma(cliente.firmaResponsable)?.nombre||'—')}</div></div>
            <div class="dl-row"><div class="dl-key">Grupo empresarial</div><div class="dl-val">${escapeHtml(cliente.grupoEmpresarial||'—')}</div></div>
            <div class="dl-row"><div class="dl-key">Contacto</div><div class="dl-val">${escapeHtml(cliente.contacto)} · ${escapeHtml(cliente.email)} · ${escapeHtml(cliente.telefono)}</div></div>
            <div class="dl-row"><div class="dl-key">Información legal</div><div class="dl-val">${escapeHtml(cliente.informacionLegal||'—')}</div></div>
            <div class="dl-row"><div class="dl-key">Notas</div><div class="dl-val">${escapeHtml(cliente.notas||'—')}</div></div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Normativa aplicable (referencial)</h3><p>Según país e industria del cliente</p></div>
        <div class="card-body pad0" id="cliNormativaWrap"></div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div><h3>Encargos</h3><p>Encargos de auditoría asociados a este cliente</p></div></div>
      <div class="card-body pad0" id="cliEncargosWrap"></div>
    </div>
  </div>`;

  document.getElementById('backToClientes').addEventListener('click', ()=>Router.go('clientes'));
  document.getElementById('editClienteBtn2').addEventListener('click', ()=> Modules.openClienteForm(clienteId, ()=>Views.clienteDetail(clienteId)));
  document.getElementById('newEncargoForClientBtn').addEventListener('click', ()=> Modules.openEncargoForm(null, clienteId));

  document.getElementById('cliEncargosWrap').innerHTML = UI.renderTable({
    columns:[
      {label:'Encargo', render:r=>`<b>${escapeHtml(r.nombre)}</b>`},
      {label:'Tipo', key:'tipo'},
      {label:'Período', key:'periodoFiscal'},
      {label:'Estado', render:r=>UI.badge(r.estado)},
    ],
    rows:encargosCliente, actions:()=>'',
    emptyIcon:'📁', emptyTitle:'Sin encargos', emptyDesc:'Este cliente aún no tiene encargos de auditoría creados.'
  });
  UI.wireRowClicks(document.getElementById('cliEncargosWrap'), encargosCliente, (r)=>Router.go('encargo-workspace', {encargoId:r.id, tab:'info'}));

  const normAplicable = Modules.calcularNormativaAplicable({paisId:cliente.paisId, industria:cliente.industria, tipoEncargo:null});
  document.getElementById('cliNormativaWrap').innerHTML = UI.renderTable({
    columns:[{label:'Norma', render:r=>`<b>${escapeHtml(r.norma)}</b>`}, {label:'Jurisdicción', render:r=>UI.badge(r.jurisdiccion)}, {label:'Vigente desde', render:r=>fmtDate(r.vigenteDesde)}],
    rows:normAplicable.slice(0,6), actions:()=>'',
    emptyIcon:'⚖️', emptyTitle:'Sin normativa configurada', emptyDesc:'Configure el catálogo normativo en Motor Normativo.'
  });
};

window.__SIGA_VIEWS_1__ = true;
})();

/* =========================================================================
   PARTE 5 — MODULES: formularios compartidos (Cliente, Encargo) y
   Motor Normativo (cálculo de normativa aplicable).
   ========================================================================= */
(function(){
"use strict";
const C = window.__SIGA_CORE__;
const UI = window.__SIGA_UI__;
const {escapeHtml, uid, toast, saveDB, logAction} = C;
const DBref = () => C.DB();
const Modules = window.Modules = window.Modules || {};

/* ---------- CLIENTE FORM ---------- */
Modules.openClienteForm = function(clienteId, onDone){
  const db = DBref();
  const editing = clienteId ? C.getCliente(clienteId) : null;
  const schema = [
    {key:'nombre', label:'Nombre / Razón social', required:true, span:'full'},
    {key:'idFiscal', label:'Identificación fiscal', required:true},
    {key:'paisId', label:'País', type:'select', required:true, options:()=>db.paises.map(p=>({value:p.id,label:p.nombre}))},
    {key:'industria', label:'Industria', type:'select', required:true, options:C.INDUSTRIAS},
    {key:'estado', label:'Estado', type:'select', required:true, options:C.ESTADOS_CLIENTE},
    {key:'firmaResponsable', label:'Firma responsable', type:'select', options:()=>db.firmas.map(f=>({value:f.id,label:f.nombre}))},
    {key:'contacto', label:'Contacto principal'},
    {key:'email', label:'Correo electrónico', type:'email'},
    {key:'telefono', label:'Teléfono'},
    {key:'grupoEmpresarial', label:'Grupo empresarial'},
    {key:'informacionLegal', label:'Información legal', type:'textarea', span:'full'},
    {key:'notas', label:'Notas / partes relacionadas', type:'textarea', span:'full', hint:'Registre aquí partes relacionadas, subsidiarias u observaciones relevantes.'},
  ];
  UI.formModal({
    title: editing? 'Editar cliente' : 'Crear cliente',
    subtitle: 'Información general del cliente',
    schema, values: editing||{estado:'En configuración'},
    submitLabel: editing? 'Guardar cambios' : 'Crear cliente',
    onSubmit(vals){
      if(editing){
        Object.assign(editing, vals);
        logAction('Actualizó cliente', vals.nombre);
        toast('Cliente actualizado correctamente.', 'success');
      } else {
        const nuevo = {id:uid('cli'), ...vals};
        db.clientes.push(nuevo);
        logAction('Creó cliente', vals.nombre);
        toast('Cliente creado correctamente.', 'success');
      }
      saveDB();
      UI.closeModal();
      if(onDone) onDone();
    }
  });
};

/* ---------- ENCARGO FORM ---------- */
Modules.openEncargoForm = function(encargoId, presetClienteId){
  const db = DBref();
  const editing = encargoId ? C.getEncargo(encargoId) : null;
  const schema = [
    {key:'nombre', label:'Nombre del encargo', required:true, span:'full', placeholder:'Ej. Auditoría Financiera Externa 2026'},
    {key:'clienteId', label:'Cliente', type:'select', required:true, options:()=>db.clientes.map(c=>({value:c.id,label:c.nombre}))},
    {key:'tipo', label:'Tipo de encargo', type:'select', required:true, options:C.TIPOS_ENCARGO},
    {key:'periodoFiscal', label:'Período fiscal', required:true, placeholder:'2026-01-01 a 2026-12-31'},
    {key:'paisId', label:'País', type:'select', required:true, options:()=>db.paises.map(p=>({value:p.id,label:p.nombre}))},
    {key:'firmaId', label:'Firma', type:'select', required:true, options:()=>db.firmas.map(f=>({value:f.id,label:f.nombre}))},
    {key:'industria', label:'Industria', type:'select', required:true, options:C.INDUSTRIAS},
    {key:'moneda', label:'Moneda', type:'select', options:C.MONEDAS},
    {key:'estado', label:'Estado', type:'select', required:true, options:C.ESTADOS_ENCARGO},
    {key:'normativaMarco', label:'Marco normativo contable', placeholder:'Ej. NIIF / IFRS Completas'},
    {key:'fechaInicio', label:'Fecha de inicio', type:'date'},
    {key:'fechaEntregaEstimada', label:'Fecha de entrega estimada', type:'date'},
  ];
  UI.formModal({
    title: editing? 'Editar encargo' : 'Crear encargo',
    subtitle:'Configuración inicial del encargo de auditoría',
    schema, values: editing || {clienteId:presetClienteId||'', estado:'Planificación', moneda:'USD'},
    submitLabel: editing? 'Guardar cambios' : 'Crear encargo',
    onSubmit(vals){
      if(editing){
        Object.assign(editing, vals);
        logAction('Actualizó encargo', vals.nombre);
        toast('Encargo actualizado.', 'success');
        saveDB(); UI.closeModal(); Router.refresh();
      } else {
        const nuevo = {
          id:uid('enc'), ...vals,
          equipo:[], materialidad:{materialidadGlobal:'',baseGlobal:'',porcentajeGlobal:'',materialidadEjecucion:'',porcentajeEjecucion:'',umbralDiferencias:'',justificacion:''},
          metodologia: C.METODOLOGIA_PASOS.map(p=>({paso:p.n, estado: p.n===1?'En proceso':'Pendiente', responsable:'', fechaCompletado:'', notas:''})),
          areasSugeridasGeneradas:false, riesgos:[], archivoPermanente:[], archivoCorriente:[], informes:[], horas:[], revisiones:[],
          visitas:[], areas:[], papelesTrabajo:[], evidencias:[], hallazgos:[], ajustes:[],
          configuracion:{plantillaMetodologica:'Estándar SIGA v1', parametrosAdicionales:''}
        };
        db.encargos.push(nuevo);
        logAction('Creó encargo', vals.nombre);
        toast('Encargo creado correctamente.', 'success');
        saveDB(); UI.closeModal();
        Router.go('encargo-workspace', {encargoId:nuevo.id, tab:'info'});
      }
    }
  });
};

/* ---------- MOTOR NORMATIVO ---------- */
/* Normativa Global + Normativa País + Normativa Industria + Tipo de Encargo → Normativa aplicable al encargo */
Modules.calcularNormativaAplicable = function({paisId, industria, tipoEncargo}){
  const db = DBref();
  const paisNombre = paisId ? C.getPaisName(paisId) : null;
  return db.normativas.filter(n=>{
    if(n.jurisdiccion==='Global') return true;
    if(n.jurisdiccion==='País') return paisNombre && n.pais===paisNombre;
    if(n.jurisdiccion==='Industria') return industria && n.industria===industria;
    return false;
  });
};

window.__SIGA_MODULES_1__ = true;
})();

/* =========================================================================
   PARTE 6 — VISTAS: Lista de Encargos + Workspace del Encargo (shell + tabs
   Información General, Planificación/Materialidad, Metodología, Riesgos, Áreas, Visitas)
   ========================================================================= */
(function(){
"use strict";
const C = window.__SIGA_CORE__;
const UI = window.__SIGA_UI__;
const {escapeHtml, fmtDate, fmtMoney, fmtHours, uid, toast, saveDB, logAction} = C;
const DBref = () => C.DB();
const Views = window.Views;
const Modules = window.Modules;

/* ---------------- LISTA DE ENCARGOS ---------------- */
Views.encargos = function(){
  window.setBreadcrumbGlobal([{label:'SIGA', strong:true}, {label:'Encargos'}]);
  const db = DBref();
  mainContentEl.innerHTML = `
  <div class="page-wrap">
    <div class="page-header">
      <div><h1>Encargos de Auditoría</h1><p class="desc">Administración de todos los encargos activos y cerrados de la firma, por cliente, país y tipo de servicio.</p></div>
      <div class="page-actions"><button class="btn btn-gold" id="newEncargoBtn">+ Crear encargo</button></div>
    </div>
    <div class="subtabs" id="encFilterTabs">
      ${['Todos', ...C.ESTADOS_ENCARGO].map((s,i)=>`<button class="subtab-btn ${i===0?'active':''}" data-filter="${s}">${s}</button>`).join('')}
    </div>
    <div class="card"><div class="card-body pad0" id="encargosTableWrap"></div></div>
  </div>`;

  let filter = 'Todos';
  function paint(){
    const rows = db.encargos.filter(e=> filter==='Todos' || e.estado===filter);
    document.getElementById('encargosTableWrap').innerHTML = UI.renderTable({
      columns:[
        {label:'Encargo', render:r=>`<b>${escapeHtml(r.nombre)}</b><br><span class="tag-mono">${escapeHtml(r.periodoFiscal)}</span>`},
        {label:'Cliente', render:r=>escapeHtml(C.getCliente(r.clienteId)?.nombre||'—')},
        {label:'País', render:r=>escapeHtml(C.getPaisName(r.paisId))},
        {label:'Tipo', key:'tipo'},
        {label:'Áreas', render:r=> `${r.areas.filter(a=>a.estado==='Completado'||a.estado==='Revisado').length}/${r.areas.length||0}`},
        {label:'Estado', render:r=>UI.badge(r.estado)},
      ],
      rows, actions:()=>'',
      emptyIcon:'📁', emptyTitle:'Sin encargos', emptyDesc:'No hay encargos que coincidan con el filtro seleccionado.'
    });
    UI.wireRowClicks(document.getElementById('encargosTableWrap'), rows, (r)=>Router.go('encargo-workspace', {encargoId:r.id, tab:'info'}));
  }
  paint();
  document.getElementById('newEncargoBtn').addEventListener('click', ()=> Modules.openEncargoForm());
  document.querySelectorAll('#encFilterTabs [data-filter]').forEach(b=>{
    b.addEventListener('click', ()=>{
      document.querySelectorAll('#encFilterTabs .subtab-btn').forEach(x=>x.classList.remove('active'));
      b.classList.add('active'); filter = b.getAttribute('data-filter'); paint();
    });
  });
};

/* ---------------- WORKSPACE DEL ENCARGO (SHELL) ---------------- */
const ENCARGO_TABS = [
  {key:'info', label:'Información General'},
  {key:'planificacion', label:'Planificación y Materialidad'},
  {key:'metodologia', label:'Metodología'},
  {key:'riesgos', label:'Riesgos y Matriz'},
  {key:'areas', label:'Áreas de Auditoría'},
  {key:'visitas', label:'Visitas'},
  {key:'papeles', label:'Papeles de Trabajo'},
  {key:'evidencia', label:'Evidencia'},
  {key:'hallazgos', label:'Hallazgos y Ajustes'},
  {key:'equipo', label:'Equipo y Asignaciones'},
  {key:'horas', label:'Horas y Presupuesto'},
  {key:'revision', label:'Revisión y Supervisión'},
  {key:'informes', label:'Informes'},
  {key:'normativa', label:'Normativa Aplicable'},
  {key:'archivoperm', label:'Archivo Permanente'},
  {key:'archivocorr', label:'Archivo Corriente'},
  {key:'configenc', label:'Configuración'},
];

Views['encargo-workspace'] = function(params){
  const db = DBref();
  const enc = C.getEncargo(params.encargoId);
  if(!enc){ Router.go('encargos'); return; }
  const cliente = C.getCliente(enc.clienteId);
  const tab = params.tab || 'info';

  window.setBreadcrumbGlobal([
    {label:'SIGA', strong:true},
    {label:C.getFirma(enc.firmaId)?.nombre||'Firma'},
    {label:C.getPaisName(enc.paisId)},
    {label:cliente?.nombre||'Cliente'},
    {label:enc.nombre, strong:true}
  ]);

  mainContentEl.innerHTML = `
    <div class="tabs" id="encTabs">
      ${ENCARGO_TABS.map(t=>`<button class="tab-btn ${t.key===tab?'active':''}" data-tab="${t.key}">${t.label}</button>`).join('')}
    </div>
    <div class="page-wrap" style="padding-top:22px;">
      <div class="page-header" style="margin-bottom:14px;">
        <div>
          <div style="margin-bottom:6px;"><button class="btn btn-ghost btn-sm" id="backToEncargos">← Encargos</button></div>
          <h1 style="font-size:22px;">${escapeHtml(enc.nombre)}</h1>
          <p class="desc">${escapeHtml(cliente?.nombre||'')} · ${escapeHtml(enc.tipo)} · ${escapeHtml(enc.periodoFiscal)} ${UI.badge(enc.estado)}</p>
        </div>
      </div>
      <div id="encTabContent"></div>
    </div>
  `;
  document.getElementById('backToEncargos').addEventListener('click', ()=>Router.go('encargos'));
  document.querySelectorAll('#encTabs [data-tab]').forEach(b=>{
    b.addEventListener('click', ()=> Router.go('encargo-workspace', {encargoId:enc.id, tab:b.getAttribute('data-tab')}));
  });

  const renderers = window.__ENCARGO_TAB_RENDERERS__;
  const fn = renderers[tab];
  const holder = document.getElementById('encTabContent');
  if(fn) fn(enc, holder); else holder.innerHTML = '<div class="empty-state"><h4>Módulo en construcción</h4></div>';
};

window.__ENCARGO_TAB_RENDERERS__ = window.__ENCARGO_TAB_RENDERERS__ || {};
const TAB = window.__ENCARGO_TAB_RENDERERS__;

/* ---------------- TAB: INFORMACIÓN GENERAL ---------------- */
TAB.info = function(enc, holder){
  const cliente = C.getCliente(enc.clienteId);
  holder.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><h3>Datos generales</h3><button class="btn btn-ghost btn-sm" id="editEncBtn">Editar</button></div>
        <div class="card-body">
          <div class="detail-list">
            <div class="dl-row"><div class="dl-key">Cliente</div><div class="dl-val">${escapeHtml(cliente?.nombre||'—')}</div></div>
            <div class="dl-row"><div class="dl-key">Tipo de encargo</div><div class="dl-val">${escapeHtml(enc.tipo)}</div></div>
            <div class="dl-row"><div class="dl-key">Período fiscal</div><div class="dl-val">${escapeHtml(enc.periodoFiscal)}</div></div>
            <div class="dl-row"><div class="dl-key">País / Firma</div><div class="dl-val">${escapeHtml(C.getPaisName(enc.paisId))} · ${escapeHtml(C.getFirma(enc.firmaId)?.nombre||'—')}</div></div>
            <div class="dl-row"><div class="dl-key">Industria</div><div class="dl-val">${escapeHtml(enc.industria)}</div></div>
            <div class="dl-row"><div class="dl-key">Marco normativo</div><div class="dl-val">${escapeHtml(enc.normativaMarco||'—')}</div></div>
            <div class="dl-row"><div class="dl-key">Moneda</div><div class="dl-val">${escapeHtml(enc.moneda)}</div></div>
            <div class="dl-row"><div class="dl-key">Fechas</div><div class="dl-val">${fmtDate(enc.fechaInicio)} → ${fmtDate(enc.fechaEntregaEstimada)}</div></div>
            <div class="dl-row"><div class="dl-key">Estado</div><div class="dl-val">${UI.badge(enc.estado)}</div></div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Avance del encargo</h3><p>Resumen de progreso metodológico y de áreas</p></div>
        <div class="card-body">
          ${(()=>{ const done = enc.metodologia.filter(m=>m.estado==='Completado').length; const pct = Math.round(done/enc.metodologia.length*100);
            return `<div style="margin-bottom:16px;"><div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:6px;"><b>Metodología (8 pasos)</b><span>${pct}%</span></div><div class="progress-track"><div class="progress-fill" style="width:${pct}%;"></div></div></div>`; })()}
          ${(()=>{ const totalA = enc.areas.length; const doneA = enc.areas.filter(a=>a.estado==='Completado'||a.estado==='Revisado').length; const pct = totalA? Math.round(doneA/totalA*100):0;
            return `<div style="margin-bottom:16px;"><div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:6px;"><b>Áreas de auditoría</b><span>${doneA}/${totalA}</span></div><div class="progress-track"><div class="progress-fill" style="width:${pct}%;"></div></div></div>`; })()}
          <div class="grid-3" style="margin-top:18px;">
            <div><div class="kpi-label" style="font-size:11px;color:var(--text-muted);font-weight:700;">HALLAZGOS</div><div style="font-size:22px;font-weight:700;font-family:var(--font-display);">${enc.hallazgos.length}</div></div>
            <div><div class="kpi-label" style="font-size:11px;color:var(--text-muted);font-weight:700;">AJUSTES</div><div style="font-size:22px;font-weight:700;font-family:var(--font-display);">${enc.ajustes.length}</div></div>
            <div><div class="kpi-label" style="font-size:11px;color:var(--text-muted);font-weight:700;">EQUIPO</div><div style="font-size:22px;font-weight:700;font-family:var(--font-display);">${enc.equipo.length}</div></div>
          </div>
        </div>
      </div>
    </div>
  `;
  document.getElementById('editEncBtn').addEventListener('click', ()=> Modules.openEncargoForm(enc.id));
};

/* ---------------- TAB: PLANIFICACIÓN Y MATERIALIDAD ---------------- */
TAB.planificacion = function(enc, holder){
  const m = enc.materialidad;
  holder.innerHTML = `
    <div class="card">
      <div class="card-head"><div><h3>Materialidad y desempeño</h3><p>NIA 320 — Importancia relativa en la planificación y ejecución de la auditoría</p></div>
        <button class="btn btn-gold btn-sm" id="editMatBtn">Editar materialidad</button></div>
      <div class="card-body">
        <div class="grid-3">
          <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Materialidad global</span></div><div class="kpi-value" style="font-size:22px;">${m.materialidadGlobal!==''? fmtMoney(m.materialidadGlobal, enc.moneda):'—'}</div><div class="kpi-sub">${escapeHtml(m.baseGlobal||'—')} · ${m.porcentajeGlobal||'—'}%</div></div>
          <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Materialidad de ejecución</span></div><div class="kpi-value" style="font-size:22px;">${m.materialidadEjecucion!==''? fmtMoney(m.materialidadEjecucion, enc.moneda):'—'}</div><div class="kpi-sub">${m.porcentajeEjecucion||'—'}% de la global</div></div>
          <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Umbral diferencias no significativas</span></div><div class="kpi-value" style="font-size:22px;">${m.umbralDiferencias!==''? fmtMoney(m.umbralDiferencias, enc.moneda):'—'}</div></div>
        </div>
        <div style="margin-top:16px;"><b style="font-size:12.5px;">Justificación:</b><p style="font-size:13px;color:var(--text-muted);margin-top:6px;">${escapeHtml(m.justificacion||'Sin justificación registrada.')}</p></div>
      </div>
    </div>
  `;
  document.getElementById('editMatBtn').addEventListener('click', ()=>{
    UI.formModal({
      title:'Materialidad y desempeño', subtitle:'Determinación de la importancia relativa',
      schema:[
        {key:'materialidadGlobal', label:'Materialidad global', type:'number'},
        {key:'baseGlobal', label:'Base utilizada', placeholder:'Ej. Ingresos, Activos totales, Utilidad antes de impuestos'},
        {key:'porcentajeGlobal', label:'% aplicado', type:'number', step:'0.01'},
        {key:'materialidadEjecucion', label:'Materialidad de ejecución', type:'number'},
        {key:'porcentajeEjecucion', label:'% de la materialidad global', type:'number', step:'0.01'},
        {key:'umbralDiferencias', label:'Umbral de diferencias no significativas', type:'number'},
        {key:'justificacion', label:'Justificación técnica', type:'textarea', span:'full'},
      ],
      values:m, submitLabel:'Guardar',
      onSubmit(vals){ Object.assign(enc.materialidad, vals); logAction('Actualizó materialidad', enc.nombre); saveDB(); UI.closeModal(); toast('Materialidad actualizada.', 'success'); Router.refresh(); }
    });
  });
};

window.__SIGA_VIEWS_2__ = true;
})();

/* =========================================================================
   PARTE 7 — TAB: Metodología (8 pasos + generación de áreas en Paso 6),
   Riesgos, Áreas de auditoría, Visitas
   ========================================================================= */
(function(){
"use strict";
const C = window.__SIGA_CORE__;
const UI = window.__SIGA_UI__;
const {escapeHtml, fmtDate, uid, toast, saveDB, logAction} = C;
const DBref = () => C.DB();
const TAB = window.__ENCARGO_TAB_RENDERERS__;

/* ---------------- TAB: METODOLOGÍA ---------------- */
TAB.metodologia = function(enc, holder){
  const db = DBref();
  holder.innerHTML = `
    <div class="card">
      <div class="card-head"><div><h3>Metodología de auditoría — 8 pasos</h3><p>El Paso 6 (Analítica preliminar) funciona como punto de generación de áreas sugeridas.</p></div></div>
      <div class="card-body">
        <div class="stepper" id="stepperWrap"></div>
      </div>
    </div>
  `;
  paintStepper();

  function paintStepper(){
    const wrap = document.getElementById('stepperWrap');
    wrap.innerHTML = enc.metodologia.map(mp=>{
      const meta = C.METODOLOGIA_PASOS.find(x=>x.n===mp.paso);
      const cls = mp.estado==='Completado' ? 'done' : (mp.estado==='En proceso' ? 'progress' : '');
      const isPaso6 = mp.paso===6;
      return `<div class="step-item ${cls}">
        <div class="step-num">${mp.estado==='Completado'?'✓':mp.paso}</div>
        <div class="step-body">
          <div class="st-title">Paso ${mp.paso} — ${escapeHtml(meta.titulo)} ${UI.badge(mp.estado)}</div>
          <div class="st-desc">${escapeHtml(meta.desc)}${mp.responsable? ' · Responsable: '+escapeHtml(C.getUserName(mp.responsable)):''}${mp.fechaCompletado? ' · Completado: '+fmtDate(mp.fechaCompletado):''}</div>
          <div class="step-actions">
            <select data-estsel="${mp.paso}" class="subtab-btn" style="padding:5px 9px;border-radius:6px;">
              ${['Pendiente','En proceso','Completado'].map(s=>`<option value="${s}" ${mp.estado===s?'selected':''}>${s}</option>`).join('')}
            </select>
            <button class="btn btn-ghost btn-sm" data-editpaso="${mp.paso}">Notas / Responsable</button>
            ${isPaso6? `<button class="btn btn-gold btn-sm" id="genAreasBtn">✨ Generar áreas sugeridas</button>`:''}
          </div>
          ${mp.notas? `<div class="ti-note" style="margin-top:8px;">${escapeHtml(mp.notas)}</div>`:''}
        </div>
      </div>`;
    }).join('');

    wrap.querySelectorAll('[data-estsel]').forEach(sel=>{
      sel.addEventListener('change', ()=>{
        const paso = Number(sel.getAttribute('data-estsel'));
        const mp = enc.metodologia.find(x=>x.paso===paso);
        mp.estado = sel.value;
        if(sel.value==='Completado') mp.fechaCompletado = C.todayStr();
        logAction('Actualizó estado de metodología', `Paso ${paso} → ${sel.value}`);
        saveDB(); paintStepper();
      });
    });
    wrap.querySelectorAll('[data-editpaso]').forEach(b=>{
      b.addEventListener('click', ()=>{
        const paso = Number(b.getAttribute('data-editpaso'));
        const mp = enc.metodologia.find(x=>x.paso===paso);
        UI.formModal({
          title:`Paso ${paso} — Detalle`,
          schema:[
            {key:'responsable', label:'Responsable', type:'select', options:()=>db.usuarios.map(u=>({value:u.id,label:u.nombre}))},
            {key:'notas', label:'Notas', type:'textarea', span:'full'},
          ],
          values:mp, submitLabel:'Guardar',
          onSubmit(vals){ Object.assign(mp, vals); saveDB(); UI.closeModal(); paintStepper(); toast('Paso actualizado.','success'); }
        });
      });
    });
    const genBtn = document.getElementById('genAreasBtn');
    if(genBtn) genBtn.addEventListener('click', ()=> openGenerarAreas(enc));
  }
};

function openGenerarAreas(enc){
  const existentes = enc.areas.map(a=>a.nombre);
  const sugeridas = C.AREAS_SUGERIDAS_CATALOGO.filter(a=>!existentes.includes(a));
  window.__SIGA_UI__.openModal(`
    <div class="modal-head"><div><h3>Áreas sugeridas — Paso 6</h3><p>Generadas a partir de la analítica preliminar (variaciones, tendencias, ratios y saldos relevantes)</p></div><button class="modal-close" data-close>×</button></div>
    <div class="modal-body">
      ${sugeridas.length? `<div class="multiselect-box" id="sugAreasBox" style="max-height:220px;">
        ${sugeridas.map(a=>`<label class="ms-opt"><input type="checkbox" value="${escapeHtml(a)}" checked> ${escapeHtml(a)}</label>`).join('')}
      </div><p class="field-hint" style="margin-top:10px;">Seleccione las áreas a aceptar. Podrá editarlas, eliminarlas o crear nuevas áreas manualmente desde la pestaña Áreas de Auditoría.</p>` :
      `<div class="empty-state"><div class="es-icon">✅</div><h4>Todas las áreas del catálogo ya existen</h4><p>Puede crear áreas adicionales manualmente desde la pestaña Áreas de Auditoría.</p></div>`}
    </div>
    <div class="modal-foot">
      <button class="btn btn-secondary" data-close>Cancelar</button>
      ${sugeridas.length? `<button class="btn btn-gold" id="acceptAreasBtn">Aceptar seleccionadas</button>`:''}
    </div>
  `);
  document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click', window.closeModalGlobal));
  const acceptBtn = document.getElementById('acceptAreasBtn');
  if(acceptBtn){
    acceptBtn.addEventListener('click', ()=>{
      const checked = Array.from(document.querySelectorAll('#sugAreasBox input:checked')).map(i=>i.value);
      checked.forEach(nombre=>{
        enc.areas.push({
          id:uid('area'), nombre, objetivo:'', afirmaciones:[], responsable:'', estado:'No iniciado', visitaId:'',
          procedimientos:[], muestra:{metodo:'No estadístico', tamano:'', criterio:''}, conclusion:''
        });
      });
      enc.areasSugeridasGeneradas = true;
      logAction('Generó áreas sugeridas (Paso 6)', checked.join(', '));
      saveDB();
      window.closeModalGlobal();
      toast(`${checked.length} área(s) agregada(s) al plan de auditoría.`, 'success');
      Router.refresh();
    });
  }
}

/* ---------------- TAB: RIESGOS ---------------- */
TAB.riesgos = function(enc, holder){
  holder.innerHTML = `
    <div class="card">
      <div class="card-head"><div><h3>Matriz de riesgos</h3><p>Identificación y evaluación de riesgos de incorrección material (NIA 315)</p></div>
        <button class="btn btn-gold btn-sm" id="addRiesgoBtn">+ Nuevo riesgo</button></div>
      <div class="card-body pad0" id="riesgosWrap"></div>
    </div>
  `;
  paint();
  function paint(){
    document.getElementById('riesgosWrap').innerHTML = window.__SIGA_UI__.renderTable({
      columns:[
        {label:'Riesgo', render:r=>`<b>${escapeHtml(r.descripcion)}</b>`},
        {label:'Tipo', render:r=>window.badgeHtml(r.tipo)},
        {label:'Afirmación', key:'afirmacion'},
        {label:'Área relacionada', render:r=>escapeHtml(enc.areas.find(a=>a.id===r.areaId)?.nombre||'—')},
        {label:'Prob. / Impacto', render:r=>`${escapeHtml(r.probabilidad)} / ${escapeHtml(r.impacto)}`},
        {label:'Estado', render:r=>window.badgeHtml(r.estado)},
      ],
      rows:enc.riesgos,
      actions:(r)=>`<button class="btn btn-ghost btn-sm" data-stop data-edit="${r.id}">Editar</button> <button class="btn btn-danger-ghost btn-sm" data-stop data-del="${r.id}">Eliminar</button>`,
      emptyIcon:'⚠️', emptyTitle:'Sin riesgos identificados', emptyDesc:'Registre los riesgos identificados durante la planificación.'
    });
    document.querySelectorAll('#riesgosWrap [data-edit]').forEach(b=>b.addEventListener('click',()=>openForm(b.getAttribute('data-edit'))));
    document.querySelectorAll('#riesgosWrap [data-del]').forEach(b=>b.addEventListener('click',()=>{
      const id = b.getAttribute('data-del');
      window.confirmDialog('Eliminar riesgo', '¿Confirma que desea eliminar este riesgo de la matriz?', ()=>{
        enc.riesgos = enc.riesgos.filter(x=>x.id!==id); saveDB(); paint(); toast('Riesgo eliminado.','success');
      }, {danger:true, confirmLabel:'Eliminar'});
    }));
  }
  document.getElementById('addRiesgoBtn').addEventListener('click', ()=>openForm(null));
  function openForm(id){
    const editing = id ? enc.riesgos.find(x=>x.id===id) : null;
    window.__SIGA_UI__.formModal({
      title: editing?'Editar riesgo':'Nuevo riesgo', schema:[
        {key:'descripcion', label:'Descripción del riesgo', type:'textarea', span:'full', required:true},
        {key:'tipo', label:'Tipo', type:'select', required:true, options:['Significativo','Normal','Fraude']},
        {key:'afirmacion', label:'Afirmación relacionada', type:'select', options:C.AFIRMACIONES},
        {key:'areaId', label:'Área relacionada', type:'select', options:()=>enc.areas.map(a=>({value:a.id,label:a.nombre}))},
        {key:'probabilidad', label:'Probabilidad', type:'select', options:['Baja','Media','Alta']},
        {key:'impacto', label:'Impacto', type:'select', options:['Bajo','Medio','Alto']},
        {key:'estado', label:'Estado', type:'select', options:['Identificado','En evaluación','Controlado','Cerrado']},
      ], values: editing||{estado:'Identificado'}, submitLabel:'Guardar',
      onSubmit(vals){
        if(editing) Object.assign(editing, vals); else enc.riesgos.push({id:uid('rie'), ...vals});
        logAction(editing?'Editó riesgo':'Creó riesgo', vals.descripcion);
        saveDB(); window.closeModalGlobal(); paint(); toast('Riesgo guardado.','success');
      }
    });
  }
};

/* ---------------- TAB: ÁREAS DE AUDITORÍA ---------------- */
TAB.areas = function(enc, holder){
  const db = DBref();
  holder.innerHTML = `
    <div class="card-head" style="padding:0 0 14px;border:none;">
      <div><h3 style="font-family:var(--font-display);font-size:19px;">Áreas de auditoría</h3><p style="color:var(--text-muted);font-size:12.5px;">Cada área contiene objetivo, afirmaciones, riesgos, controles, procedimientos, muestra, evidencia, hallazgos, ajustes y conclusión.</p></div>
      <div style="display:flex;gap:8px;"><button class="btn btn-secondary btn-sm" id="genFromAreasTab">✨ Generar del Paso 6</button><button class="btn btn-gold btn-sm" id="addAreaBtn">+ Nueva área</button></div>
    </div>
    <div id="areasListWrap"></div>
  `;
  document.getElementById('genFromAreasTab').addEventListener('click', ()=> openGenerarAreas(enc));
  document.getElementById('addAreaBtn').addEventListener('click', ()=>openAreaForm(null));
  paint();

  function paint(){
    const wrap = document.getElementById('areasListWrap');
    if(enc.areas.length===0){
      wrap.innerHTML = `<div class="card"><div class="card-body"><div class="empty-state"><div class="es-icon">🗂️</div><h4>Sin áreas definidas</h4><p>Genere áreas sugeridas desde el Paso 6 de la metodología o cree un área manualmente.</p></div></div></div>`;
      return;
    }
    wrap.innerHTML = enc.areas.map((a,idx)=>`
      <div class="card">
        <div class="card-head">
          <div><h3>${escapeHtml(a.nombre)} ${window.badgeHtml(a.estado)}</h3><p>${escapeHtml(a.objetivo||'Sin objetivo definido')}</p></div>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-ghost btn-sm" data-reorder="${idx}" data-dir="up" ${idx===0?'disabled':''} title="Subir">↑</button>
            <button class="btn btn-ghost btn-sm" data-reorder="${idx}" data-dir="down" ${idx===enc.areas.length-1?'disabled':''} title="Bajar">↓</button>
            <button class="btn btn-ghost btn-sm" data-dup="${a.id}">Duplicar</button>
            <button class="btn btn-ghost btn-sm" data-edit="${a.id}">Editar</button>
            <button class="btn btn-danger-ghost btn-sm" data-del="${a.id}">Eliminar</button>
          </div>
        </div>
        <div class="card-body">
          <div class="grid-3" style="margin-bottom:14px;">
            <div><div style="font-size:11px;color:var(--text-muted);font-weight:700;">RESPONSABLE</div><div style="font-size:13px;font-weight:600;">${escapeHtml(C.getUserName(a.responsable))}</div></div>
            <div><div style="font-size:11px;color:var(--text-muted);font-weight:700;">AFIRMACIONES</div><div style="font-size:12.5px;">${a.afirmaciones.map(x=>`<span class="chip">${escapeHtml(x)}</span>`).join(' ')||'—'}</div></div>
            <div><div style="font-size:11px;color:var(--text-muted);font-weight:700;">VISITA</div><div style="font-size:13px;font-weight:600;">${escapeHtml(enc.visitas.find(v=>v.id===a.visitaId)?.nombre||'Sin asignar')}</div></div>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
            <b style="font-size:12.5px;">Procedimientos (${a.procedimientos.length})</b>
            <button class="btn btn-ghost btn-sm" data-addproc="${a.id}">+ Procedimiento</button>
          </div>
          ${a.procedimientos.length? `<div class="table-scroll"><table><thead><tr><th>Procedimiento</th><th>Tipo</th><th>Estado</th><th></th></tr></thead><tbody>
            ${a.procedimientos.map(p=>`<tr><td>${escapeHtml(p.descripcion)}</td><td>${escapeHtml(p.tipo)}</td><td>${window.badgeHtml(p.estado)}</td>
            <td class="actions-cell"><button class="btn btn-ghost btn-sm" data-editproc="${a.id}|${p.id}">Editar</button> <button class="btn btn-danger-ghost btn-sm" data-delproc="${a.id}|${p.id}">✕</button></td></tr>`).join('')}
          </tbody></table></div>` : `<p style="font-size:12.5px;color:var(--text-faint);">Sin procedimientos definidos.</p>`}

          <div class="grid-2" style="margin-top:16px;">
            <div>
              <b style="font-size:12.5px;">Muestreo</b>
              <p style="font-size:12.5px;color:var(--text-muted);margin:6px 0 0;">Método: ${escapeHtml(a.muestra?.metodo||'—')} · Tamaño: ${escapeHtml(String(a.muestra?.tamano||'—'))}<br>Criterio: ${escapeHtml(a.muestra?.criterio||'—')}</p>
            </div>
            <div>
              <b style="font-size:12.5px;">Conclusión del área</b>
              <p style="font-size:12.5px;color:var(--text-muted);margin:6px 0 0;">${escapeHtml(a.conclusion||'Pendiente de conclusión.')}</p>
            </div>
          </div>
        </div>
      </div>
    `).join('');

    wrap.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click',()=>openAreaForm(b.getAttribute('data-edit'))));
    wrap.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click',()=>{
      const id=b.getAttribute('data-del');
      window.confirmDialog('Eliminar área', '¿Confirma que desea eliminar esta área de auditoría? Esta acción no se puede deshacer.', ()=>{
        enc.areas = enc.areas.filter(x=>x.id!==id); saveDB(); paint(); toast('Área eliminada.','success');
      }, {danger:true, confirmLabel:'Eliminar'});
    }));
    wrap.querySelectorAll('[data-dup]').forEach(b=>b.addEventListener('click',()=>{
      const a = enc.areas.find(x=>x.id===b.getAttribute('data-dup'));
      const copia = JSON.parse(JSON.stringify(a));
      copia.id = uid('area'); copia.nombre = a.nombre + ' (copia)';
      copia.procedimientos = copia.procedimientos.map(p=>({...p, id:uid('proc')}));
      enc.areas.splice(enc.areas.indexOf(a)+1, 0, copia);
      saveDB(); paint(); toast('Área duplicada.','success');
    }));
    wrap.querySelectorAll('[data-reorder]').forEach(b=>b.addEventListener('click',()=>{
      const idx = Number(b.getAttribute('data-reorder')); const dir = b.getAttribute('data-dir');
      const to = dir==='up'? idx-1 : idx+1;
      if(to<0||to>=enc.areas.length) return;
      const tmp = enc.areas[idx]; enc.areas[idx]=enc.areas[to]; enc.areas[to]=tmp;
      saveDB(); paint();
    }));
    wrap.querySelectorAll('[data-addproc]').forEach(b=>b.addEventListener('click',()=>openProcForm(b.getAttribute('data-addproc'), null)));
    wrap.querySelectorAll('[data-editproc]').forEach(b=>{
      const [areaId,procId] = b.getAttribute('data-editproc').split('|');
      b.addEventListener('click',()=>openProcForm(areaId, procId));
    });
    wrap.querySelectorAll('[data-delproc]').forEach(b=>{
      const [areaId,procId] = b.getAttribute('data-delproc').split('|');
      b.addEventListener('click',()=>{
        const a = enc.areas.find(x=>x.id===areaId);
        a.procedimientos = a.procedimientos.filter(p=>p.id!==procId);
        saveDB(); paint(); toast('Procedimiento eliminado.','success');
      });
    });
  }

  function openAreaForm(id){
    const editing = id? enc.areas.find(x=>x.id===id): null;
    window.__SIGA_UI__.formModal({
      title: editing? 'Editar área':'Nueva área de auditoría',
      schema:[
        {key:'nombre', label:'Nombre del área', required:true, span:'full'},
        {key:'objetivo', label:'Objetivo', type:'textarea', span:'full'},
        {key:'afirmaciones', label:'Afirmaciones', type:'multiselect', options:C.AFIRMACIONES, span:'full'},
        {key:'responsable', label:'Responsable', type:'select', options:()=>db.usuarios.map(u=>({value:u.id,label:u.nombre}))},
        {key:'visitaId', label:'Visita asignada', type:'select', options:()=>enc.visitas.map(v=>({value:v.id,label:v.nombre}))},
        {key:'estado', label:'Estado', type:'select', options:C.ESTADOS_AREA},
        {key:'conclusion', label:'Conclusión del área', type:'textarea', span:'full'},
      ],
      values: editing || {estado:'No iniciado', afirmaciones:[]}, submitLabel:'Guardar',
      onSubmit(vals){
        if(editing) Object.assign(editing, vals);
        else enc.areas.push({id:uid('area'), ...vals, procedimientos:[], muestra:{metodo:'No estadístico',tamano:'',criterio:''}});
        logAction(editing?'Editó área':'Creó área', vals.nombre);
        saveDB(); window.closeModalGlobal(); paint(); toast('Área guardada.','success');
      }
    });
  }
  function openProcForm(areaId, procId){
    const a = enc.areas.find(x=>x.id===areaId);
    const editing = procId? a.procedimientos.find(p=>p.id===procId): null;
    window.__SIGA_UI__.formModal({
      title: editing?'Editar procedimiento':'Nuevo procedimiento',
      schema:[
        {key:'descripcion', label:'Descripción del procedimiento', type:'textarea', span:'full', required:true},
        {key:'tipo', label:'Tipo', type:'select', options:['Prueba de controles','Sustantivo','Analítico']},
        {key:'estado', label:'Estado', type:'select', options:['Pendiente','En proceso','Completado']},
      ], values: editing||{tipo:'Sustantivo', estado:'Pendiente'}, submitLabel:'Guardar',
      onSubmit(vals){
        if(editing) Object.assign(editing, vals); else a.procedimientos.push({id:uid('proc'), ...vals});
        saveDB(); window.closeModalGlobal(); paint(); toast('Procedimiento guardado.','success');
      }
    });
  }
};

/* ---------------- TAB: VISITAS ---------------- */
TAB.visitas = function(enc, holder){
  const db = DBref();
  holder.innerHTML = `
    <div class="card">
      <div class="card-head"><div><h3>Visitas de auditoría</h3><p>Organización de áreas y procedimientos por visita realizada al cliente</p></div>
        <button class="btn btn-gold btn-sm" id="addVisitaBtn">+ Nueva visita</button></div>
      <div class="card-body pad0" id="visitasWrap"></div>
    </div>`;
  paint();
  function paint(){
    document.getElementById('visitasWrap').innerHTML = window.__SIGA_UI__.renderTable({
      columns:[
        {label:'Visita', render:r=>`<b>${escapeHtml(r.nombre)}</b>`},
        {label:'Fecha', render:r=>fmtDate(r.fecha)},
        {label:'Objetivo', render:r=>escapeHtml(r.objetivo||'—')},
        {label:'Equipo', render:r=>(r.equipo||[]).map(u=>C.getUserName(u)).join(', ')||'—'},
        {label:'Áreas trabajadas', render:r=>`${(r.areasIds||[]).length} área(s)`},
      ],
      rows:enc.visitas,
      actions:(r)=>`<button class="btn btn-ghost btn-sm" data-stop data-edit="${r.id}">Editar</button> <button class="btn btn-danger-ghost btn-sm" data-stop data-del="${r.id}">Eliminar</button>`,
      emptyIcon:'🗓️', emptyTitle:'Sin visitas registradas', emptyDesc:'Registre las visitas realizadas al cliente para organizar el trabajo de campo.'
    });
    document.querySelectorAll('#visitasWrap [data-edit]').forEach(b=>b.addEventListener('click',()=>openForm(b.getAttribute('data-edit'))));
    document.querySelectorAll('#visitasWrap [data-del]').forEach(b=>b.addEventListener('click',()=>{
      const id=b.getAttribute('data-del');
      window.confirmDialog('Eliminar visita', '¿Confirma que desea eliminar esta visita?', ()=>{
        enc.visitas = enc.visitas.filter(x=>x.id!==id); saveDB(); paint(); toast('Visita eliminada.','success');
      }, {danger:true, confirmLabel:'Eliminar'});
    }));
  }
  document.getElementById('addVisitaBtn').addEventListener('click', ()=>openForm(null));
  function openForm(id){
    const editing = id? enc.visitas.find(x=>x.id===id): null;
    window.__SIGA_UI__.formModal({
      title: editing?'Editar visita':'Nueva visita', schema:[
        {key:'nombre', label:'Nombre de la visita', required:true, span:'full', placeholder:'Ej. Visita 1 — Planificación'},
        {key:'fecha', label:'Fecha', type:'date', required:true},
        {key:'objetivo', label:'Objetivo', type:'textarea', span:'full'},
        {key:'equipo', label:'Equipo asignado', type:'multiselect', span:'full', options:()=>db.usuarios.map(u=>({value:u.id,label:u.nombre}))},
        {key:'areasIds', label:'Áreas trabajadas', type:'multiselect', span:'full', options:()=>enc.areas.map(a=>({value:a.id,label:a.nombre}))},
      ], values: editing||{equipo:[],areasIds:[]}, submitLabel:'Guardar',
      onSubmit(vals){
        if(editing) Object.assign(editing, vals); else enc.visitas.push({id:uid('vis'), ...vals});
        logAction(editing?'Editó visita':'Creó visita', vals.nombre);
        saveDB(); window.closeModalGlobal(); paint(); toast('Visita guardada.','success');
      }
    });
  }
};

window.__SIGA_VIEWS_3__ = true;
})();

/* =========================================================================
   PARTE 8 — TAB: Papeles de Trabajo, Evidencia, Hallazgos y Ajustes
   ========================================================================= */
(function(){
"use strict";
const C = window.__SIGA_CORE__;
const UI = window.__SIGA_UI__;
const {escapeHtml, fmtDate, uid, toast, saveDB, logAction} = C;
const DBref = () => C.DB();
const TAB = window.__ENCARGO_TAB_RENDERERS__;

/* ---------------- TAB: PAPELES DE TRABAJO ---------------- */
TAB.papeles = function(enc, holder){
  const db = DBref();
  holder.innerHTML = `
    <div class="card">
      <div class="card-head"><div><h3>Papeles de trabajo electrónicos</h3><p>Índice, referencias cruzadas y control de versiones</p></div>
        <button class="btn btn-gold btn-sm" id="addPTBtn">+ Nuevo papel de trabajo</button></div>
      <div class="card-body pad0" id="ptWrap"></div>
    </div>`;
  paint();
  function paint(){
    document.getElementById('ptWrap').innerHTML = UI.renderTable({
      columns:[
        {label:'Ref.', render:r=>`<span class="tag-mono">${escapeHtml(r.codigo)}</span>`},
        {label:'Nombre', render:r=>`<b>${escapeHtml(r.nombre)}</b>`},
        {label:'Área', render:r=>escapeHtml(enc.areas.find(a=>a.id===r.areaId)?.nombre||'—')},
        {label:'Preparador / Revisor', render:r=>`${escapeHtml(C.getUserName(r.preparador))} → ${escapeHtml(C.getUserName(r.revisor))}`},
        {label:'Fecha', render:r=>fmtDate(r.fecha)},
        {label:'Versión', render:r=>`v${escapeHtml(r.version||'1.0')}`},
        {label:'Evidencia', render:r=> r.evidenciaId? '🔗 Vinculada' : '—'},
        {label:'Estado', render:r=>UI.badge(r.estado)},
      ],
      rows: enc.papelesTrabajo,
      actions:(r)=>`<button class="btn btn-ghost btn-sm" data-stop data-edit="${r.id}">Editar</button> <button class="btn btn-danger-ghost btn-sm" data-stop data-del="${r.id}">Eliminar</button>`,
      emptyIcon:'📑', emptyTitle:'Sin papeles de trabajo', emptyDesc:'Cree el índice de papeles de trabajo del encargo.'
    });
    document.querySelectorAll('#ptWrap [data-edit]').forEach(b=>b.addEventListener('click',()=>openForm(b.getAttribute('data-edit'))));
    document.querySelectorAll('#ptWrap [data-del]').forEach(b=>b.addEventListener('click',()=>{
      const id=b.getAttribute('data-del');
      window.confirmDialog('Eliminar papel de trabajo', '¿Confirma que desea eliminar este papel de trabajo?', ()=>{
        enc.papelesTrabajo = enc.papelesTrabajo.filter(x=>x.id!==id); saveDB(); paint(); toast('Papel de trabajo eliminado.','success');
      }, {danger:true, confirmLabel:'Eliminar'});
    }));
  }
  document.getElementById('addPTBtn').addEventListener('click', ()=>openForm(null));
  function openForm(id){
    const editing = id? enc.papelesTrabajo.find(x=>x.id===id): null;
    UI.formModal({
      title: editing?'Editar papel de trabajo':'Nuevo papel de trabajo',
      schema:[
        {key:'codigo', label:'Código / Referencia', required:true, placeholder:'Ej. A-100'},
        {key:'nombre', label:'Nombre', required:true},
        {key:'areaId', label:'Área', type:'select', options:()=>enc.areas.map(a=>({value:a.id,label:a.nombre}))},
        {key:'preparador', label:'Preparador', type:'select', options:()=>db.usuarios.map(u=>({value:u.id,label:u.nombre}))},
        {key:'revisor', label:'Revisor', type:'select', options:()=>db.usuarios.map(u=>({value:u.id,label:u.nombre}))},
        {key:'fecha', label:'Fecha', type:'date'},
        {key:'version', label:'Versión', placeholder:'1.0'},
        {key:'estado', label:'Estado', type:'select', options:C.ESTADOS_PT},
        {key:'evidenciaId', label:'Evidencia vinculada', type:'select', options:()=>enc.evidencias.map(e=>({value:e.id,label:e.descripcion}))},
      ], values: editing||{estado:'Borrador', version:'1.0'}, submitLabel:'Guardar',
      onSubmit(vals){
        if(editing) Object.assign(editing, vals); else enc.papelesTrabajo.push({id:uid('pt'), referencia:vals.codigo, ...vals});
        logAction(editing?'Editó papel de trabajo':'Creó papel de trabajo', vals.nombre);
        saveDB(); UI.closeModal(); paint(); toast('Papel de trabajo guardado.','success');
      }
    });
  }
};

/* ---------------- TAB: EVIDENCIA ---------------- */
TAB.evidencia = function(enc, holder){
  const db = DBref();
  holder.innerHTML = `
    <div class="card">
      <div class="card-head"><div><h3>Evidencia de auditoría</h3><p>Origen, integridad y trazabilidad de la evidencia obtenida</p></div>
        <button class="btn btn-gold btn-sm" id="addEvBtn">+ Nueva evidencia</button></div>
      <div class="card-body pad0" id="evWrap"></div>
    </div>`;
  paint();
  function paint(){
    document.getElementById('evWrap').innerHTML = UI.renderTable({
      columns:[
        {label:'Descripción', render:r=>`<b>${escapeHtml(r.descripcion)}</b><br><span class="tag-mono">${escapeHtml(r.archivo||'sin archivo adjunto')}</span>`},
        {label:'Tipo', render:r=>UI.badge(r.tipo)},
        {label:'Origen', key:'origen'},
        {label:'Área', render:r=>escapeHtml(enc.areas.find(a=>a.id===r.areaId)?.nombre||'—')},
        {label:'Papel de trabajo', render:r=>escapeHtml(enc.papelesTrabajo.find(p=>p.id===r.papelTrabajoId)?.codigo||'—')},
        {label:'Responsable', render:r=>escapeHtml(C.getUserName(r.responsable))},
        {label:'Fecha', render:r=>fmtDate(r.fecha)},
        {label:'Integridad', render:r=>UI.badge(r.integridad||'Verificada')},
      ],
      rows: enc.evidencias,
      actions:(r)=>`<button class="btn btn-ghost btn-sm" data-stop data-edit="${r.id}">Editar</button> <button class="btn btn-danger-ghost btn-sm" data-stop data-del="${r.id}">Eliminar</button>`,
      emptyIcon:'📎', emptyTitle:'Sin evidencia registrada', emptyDesc:'Registre la evidencia obtenida durante la ejecución del encargo.'
    });
    document.querySelectorAll('#evWrap [data-edit]').forEach(b=>b.addEventListener('click',()=>openForm(b.getAttribute('data-edit'))));
    document.querySelectorAll('#evWrap [data-del]').forEach(b=>b.addEventListener('click',()=>{
      const id=b.getAttribute('data-del');
      window.confirmDialog('Eliminar evidencia', '¿Confirma que desea eliminar este registro de evidencia? Se perderá la trazabilidad asociada.', ()=>{
        enc.evidencias = enc.evidencias.filter(x=>x.id!==id); saveDB(); paint(); toast('Evidencia eliminada.','success');
      }, {danger:true, confirmLabel:'Eliminar'});
    }));
  }
  document.getElementById('addEvBtn').addEventListener('click', ()=>openForm(null));
  function openForm(id){
    const editing = id? enc.evidencias.find(x=>x.id===id): null;
    UI.formModal({
      title: editing?'Editar evidencia':'Nueva evidencia',
      subtitle:'Se recomienda un origen y descripción específicos para preservar la trazabilidad',
      schema:[
        {key:'descripcion', label:'Descripción', required:true, span:'full'},
        {key:'tipo', label:'Tipo de evidencia', type:'select', options:C.TIPOS_EVIDENCIA},
        {key:'origen', label:'Origen', placeholder:'Ej. Banco, cliente, tercero, sistema'},
        {key:'fecha', label:'Fecha', type:'date'},
        {key:'responsable', label:'Responsable', type:'select', options:()=>db.usuarios.map(u=>({value:u.id,label:u.nombre}))},
        {key:'areaId', label:'Área', type:'select', options:()=>enc.areas.map(a=>({value:a.id,label:a.nombre}))},
        {key:'procedimiento', label:'Procedimiento relacionado'},
        {key:'papelTrabajoId', label:'Papel de trabajo', type:'select', options:()=>enc.papelesTrabajo.map(p=>({value:p.id,label:p.codigo+' — '+p.nombre}))},
        {key:'archivo', label:'Nombre de archivo adjunto (simulado)', placeholder:'archivo.pdf'},
        {key:'integridad', label:'Estado de integridad', type:'select', options:['Verificada','Pendiente de verificación','Observada']},
      ], values: editing||{tipo:'Documento', integridad:'Verificada'}, submitLabel:'Guardar',
      onSubmit(vals){
        if(editing) Object.assign(editing, vals); else enc.evidencias.push({id:uid('ev'), ...vals});
        logAction(editing?'Editó evidencia':'Registró evidencia', vals.descripcion);
        saveDB(); UI.closeModal(); paint(); toast('Evidencia guardada.','success');
      }
    });
  }
};

/* ---------------- TAB: HALLAZGOS Y AJUSTES ---------------- */
TAB.hallazgos = function(enc, holder){
  holder.innerHTML = `
    <div class="subtabs" id="halSubtabs">
      <button class="subtab-btn active" data-sub="hallazgos">Hallazgos</button>
      <button class="subtab-btn" data-sub="ajustes">Ajustes propuestos</button>
    </div>
    <div id="halContent"></div>
  `;
  let sub='hallazgos';
  document.querySelectorAll('#halSubtabs [data-sub]').forEach(b=>b.addEventListener('click',()=>{
    document.querySelectorAll('#halSubtabs .subtab-btn').forEach(x=>x.classList.remove('active'));
    b.classList.add('active'); sub=b.getAttribute('data-sub'); paintSub();
  }));
  paintSub();

  function paintSub(){
    const holder2 = document.getElementById('halContent');
    if(sub==='hallazgos') paintHallazgos(holder2); else paintAjustes(holder2);
  }

  function paintHallazgos(holder2){
    holder2.innerHTML = `<div class="card"><div class="card-head"><div><h3>Hallazgos de auditoría</h3><p>Condición, criterio, causa, efecto y recomendación</p></div>
      <button class="btn btn-gold btn-sm" id="addHalBtn">+ Nuevo hallazgo</button></div><div class="card-body pad0" id="halListWrap"></div></div>`;
    paint();
    function paint(){
      document.getElementById('halListWrap').innerHTML = UI.renderTable({
        columns:[
          {label:'Hallazgo', render:r=>`<b>${escapeHtml(r.titulo)}</b>`},
          {label:'Área', render:r=>escapeHtml(enc.areas.find(a=>a.id===r.areaId)?.nombre||'—')},
          {label:'Condición', render:r=>`<span style="color:var(--text-muted);">${escapeHtml((r.condicion||'').slice(0,70))}${(r.condicion||'').length>70?'…':''}</span>`},
          {label:'Estado', render:r=>UI.badge(r.estado)},
        ],
        rows:enc.hallazgos,
        actions:(r)=>`<button class="btn btn-ghost btn-sm" data-stop data-edit="${r.id}">Editar</button> <button class="btn btn-danger-ghost btn-sm" data-stop data-del="${r.id}">Eliminar</button>`,
        emptyIcon:'🔎', emptyTitle:'Sin hallazgos', emptyDesc:'Registre los hallazgos identificados durante la ejecución.'
      });
      document.querySelectorAll('#halListWrap [data-edit]').forEach(b=>b.addEventListener('click',()=>openHalForm(b.getAttribute('data-edit'))));
      document.querySelectorAll('#halListWrap [data-del]').forEach(b=>b.addEventListener('click',()=>{
        const id=b.getAttribute('data-del');
        window.confirmDialog('Eliminar hallazgo', '¿Confirma que desea eliminar este hallazgo?', ()=>{
          enc.hallazgos = enc.hallazgos.filter(x=>x.id!==id); saveDB(); paint(); toast('Hallazgo eliminado.','success');
        }, {danger:true, confirmLabel:'Eliminar'});
      }));
    }
    document.getElementById('addHalBtn').addEventListener('click', ()=>openHalForm(null));
    function openHalForm(id){
      const editing = id? enc.hallazgos.find(x=>x.id===id): null;
      UI.formModal({
        title: editing?'Editar hallazgo':'Nuevo hallazgo', subtitle:'Estructura: condición, criterio, causa, efecto y recomendación',
        schema:[
          {key:'titulo', label:'Título del hallazgo', required:true, span:'full'},
          {key:'areaId', label:'Área', type:'select', options:()=>enc.areas.map(a=>({value:a.id,label:a.nombre}))},
          {key:'estado', label:'Estado', type:'select', options:C.ESTADOS_HALLAZGO},
          {key:'condicion', label:'Condición (lo que es)', type:'textarea', span:'full'},
          {key:'criterio', label:'Criterio (lo que debería ser)', type:'textarea', span:'full'},
          {key:'causa', label:'Causa', type:'textarea'},
          {key:'efecto', label:'Efecto', type:'textarea'},
          {key:'recomendacion', label:'Recomendación', type:'textarea', span:'full'},
          {key:'respuestaCliente', label:'Respuesta del cliente', type:'textarea', span:'full'},
        ], values: editing||{estado:'Abierto'}, submitLabel:'Guardar',
        onSubmit(vals){
          if(editing) Object.assign(editing, vals); else enc.hallazgos.push({id:uid('hal'), ...vals});
          logAction(editing?'Editó hallazgo':'Creó hallazgo', vals.titulo);
          saveDB(); UI.closeModal(); paint(); toast('Hallazgo guardado.','success');
        }
      });
    }
  }

  function paintAjustes(holder2){
    holder2.innerHTML = `<div class="card"><div class="card-head"><div><h3>Ajustes propuestos y no registrados</h3><p>Control de partidas de ajuste identificadas</p></div>
      <button class="btn btn-gold btn-sm" id="addAdjBtn">+ Nuevo ajuste</button></div><div class="card-body pad0" id="adjListWrap"></div></div>`;
    paint();
    function paint(){
      const totalDeb = enc.ajustes.reduce((s,a)=>s+(Number(a.debito)||0),0);
      const totalCred = enc.ajustes.reduce((s,a)=>s+(Number(a.credito)||0),0);
      document.getElementById('adjListWrap').innerHTML = UI.renderTable({
        columns:[
          {label:'Cuenta', render:r=>`<b>${escapeHtml(r.cuenta)}</b>`},
          {label:'Descripción', key:'descripcion'},
          {label:'Área', render:r=>escapeHtml(enc.areas.find(a=>a.id===r.areaId)?.nombre||'—')},
          {label:'Débito', render:r=>r.debito? C.fmtMoney(r.debito, enc.moneda):'—'},
          {label:'Crédito', render:r=>r.credito? C.fmtMoney(r.credito, enc.moneda):'—'},
          {label:'Estado', render:r=>UI.badge(r.estado)},
        ],
        rows:enc.ajustes,
        actions:(r)=>`<button class="btn btn-ghost btn-sm" data-stop data-edit="${r.id}">Editar</button> <button class="btn btn-danger-ghost btn-sm" data-stop data-del="${r.id}">Eliminar</button>`,
        emptyIcon:'🧮', emptyTitle:'Sin ajustes propuestos', emptyDesc:'Registre los ajustes propuestos identificados durante la auditoría.'
      });
      if(enc.ajustes.length){
        document.getElementById('adjListWrap').insertAdjacentHTML('beforeend', `<div style="padding:12px 20px;border-top:1px solid var(--border);font-size:12.5px;color:var(--text-muted);display:flex;justify-content:flex-end;gap:20px;"><span>Total débitos: <b>${C.fmtMoney(totalDeb, enc.moneda)}</b></span><span>Total créditos: <b>${C.fmtMoney(totalCred, enc.moneda)}</b></span></div>`);
      }
      document.querySelectorAll('#adjListWrap [data-edit]').forEach(b=>b.addEventListener('click',()=>openAdjForm(b.getAttribute('data-edit'))));
      document.querySelectorAll('#adjListWrap [data-del]').forEach(b=>b.addEventListener('click',()=>{
        const id=b.getAttribute('data-del');
        window.confirmDialog('Eliminar ajuste', '¿Confirma que desea eliminar este ajuste propuesto?', ()=>{
          enc.ajustes = enc.ajustes.filter(x=>x.id!==id); saveDB(); paint(); toast('Ajuste eliminado.','success');
        }, {danger:true, confirmLabel:'Eliminar'});
      }));
    }
    document.getElementById('addAdjBtn').addEventListener('click', ()=>openAdjForm(null));
    function openAdjForm(id){
      const editing = id? enc.ajustes.find(x=>x.id===id): null;
      UI.formModal({
        title: editing?'Editar ajuste':'Nuevo ajuste propuesto', schema:[
          {key:'cuenta', label:'Cuenta contable', required:true, span:'full'},
          {key:'areaId', label:'Área', type:'select', options:()=>enc.areas.map(a=>({value:a.id,label:a.nombre}))},
          {key:'debito', label:'Débito', type:'number'},
          {key:'credito', label:'Crédito', type:'number'},
          {key:'descripcion', label:'Descripción del ajuste', type:'textarea', span:'full'},
          {key:'estado', label:'Estado', type:'select', options:C.ESTADOS_AJUSTE},
        ], values: editing||{estado:'Pendiente'}, submitLabel:'Guardar',
        onSubmit(vals){
          if(editing) Object.assign(editing, vals); else enc.ajustes.push({id:uid('adj'), ...vals});
          logAction(editing?'Editó ajuste':'Creó ajuste', vals.cuenta);
          saveDB(); UI.closeModal(); paint(); toast('Ajuste guardado.','success');
        }
      });
    }
  }
};

window.__SIGA_VIEWS_4__ = true;
})();

/* =========================================================================
   PARTE 9 — TAB: Equipo y Asignaciones, Horas y Presupuesto,
   Revisión y Supervisión, Informes
   ========================================================================= */
(function(){
"use strict";
const C = window.__SIGA_CORE__;
const UI = window.__SIGA_UI__;
const {escapeHtml, fmtDate, fmtMoney, fmtHours, uid, toast, saveDB, logAction} = C;
const DBref = () => C.DB();
const TAB = window.__ENCARGO_TAB_RENDERERS__;

/* ---------------- TAB: EQUIPO Y ASIGNACIONES ---------------- */
TAB.equipo = function(enc, holder){
  const db = DBref();
  holder.innerHTML = `
    <div class="card">
      <div class="card-head"><div><h3>Equipo del encargo</h3><p>Asignación de usuarios y rol dentro del encargo</p></div>
        <button class="btn btn-gold btn-sm" id="addMiembroBtn">+ Agregar miembro</button></div>
      <div class="card-body pad0" id="equipoWrap"></div>
    </div>
    <div class="card">
      <div class="card-head"><div><h3>Asignación por área</h3><p>Usuario → Encargo → Área → Procedimiento → Tarea</p></div></div>
      <div class="card-body pad0" id="asigAreaWrap"></div>
    </div>
  `;
  paint();
  function paint(){
    document.getElementById('equipoWrap').innerHTML = UI.renderTable({
      columns:[
        {label:'Usuario', render:r=>`<b>${escapeHtml(C.getUserName(r.usuarioId))}</b>`},
        {label:'Rol en el sistema', render:r=>escapeHtml(C.getRolName(C.getUser(r.usuarioId)?.rolId))},
        {label:'Rol en el encargo', key:'rolEncargo'},
      ],
      rows: enc.equipo,
      actions:(r,idx)=>`<button class="btn btn-danger-ghost btn-sm" data-stop data-delm="${r.usuarioId}">Quitar</button>`,
      emptyIcon:'👥', emptyTitle:'Sin equipo asignado', emptyDesc:'Agregue miembros del equipo para este encargo.'
    });
    document.querySelectorAll('#equipoWrap [data-delm]').forEach(b=>b.addEventListener('click',()=>{
      const uidVal = b.getAttribute('data-delm');
      enc.equipo = enc.equipo.filter(x=>x.usuarioId!==uidVal); saveDB(); paint(); toast('Miembro removido del equipo.','success');
    }));

    document.getElementById('asigAreaWrap').innerHTML = UI.renderTable({
      columns:[
        {label:'Área', render:r=>`<b>${escapeHtml(r.nombre)}</b>`},
        {label:'Responsable asignado', render:r=>escapeHtml(C.getUserName(r.responsable))},
        {label:'Estado', render:r=>UI.badge(r.estado)},
      ],
      rows: enc.areas,
      actions:(r)=>`<button class="btn btn-ghost btn-sm" data-stop data-reasig="${r.id}">Reasignar</button>`,
      emptyIcon:'🗂️', emptyTitle:'Sin áreas', emptyDesc:'Cree áreas de auditoría para asignar responsables.'
    });
    document.querySelectorAll('#asigAreaWrap [data-reasig]').forEach(b=>b.addEventListener('click',()=>{
      const area = enc.areas.find(x=>x.id===b.getAttribute('data-reasig'));
      UI.formModal({
        title:'Reasignar responsable de área', schema:[
          {key:'responsable', label:'Responsable', type:'select', required:true, options:()=>db.usuarios.map(u=>({value:u.id,label:u.nombre}))},
        ], values:area, submitLabel:'Guardar',
        onSubmit(vals){ area.responsable = vals.responsable; saveDB(); UI.closeModal(); paint(); toast('Responsable actualizado.','success'); }
      });
    }));
  }
  document.getElementById('addMiembroBtn').addEventListener('click', ()=>{
    const disponibles = db.usuarios.filter(u=>!enc.equipo.some(m=>m.usuarioId===u.id));
    UI.formModal({
      title:'Agregar miembro al equipo', schema:[
        {key:'usuarioId', label:'Usuario', type:'select', required:true, options:()=>disponibles.map(u=>({value:u.id,label:u.nombre+' — '+C.getRolName(u.rolId)}))},
        {key:'rolEncargo', label:'Rol en el encargo', type:'select', required:true, options:C.ROLES_BASE},
      ], values:{}, submitLabel:'Agregar',
      onSubmit(vals){
        if(!vals.usuarioId){ toast('Seleccione un usuario.','error'); return; }
        enc.equipo.push(vals); logAction('Agregó miembro al equipo', C.getUserName(vals.usuarioId));
        saveDB(); UI.closeModal(); paint(); toast('Miembro agregado.','success');
      }
    });
  });
};

/* ---------------- TAB: HORAS Y PRESUPUESTO ---------------- */
TAB.horas = function(enc, holder){
  const db = DBref();
  holder.innerHTML = `
    <div class="card">
      <div class="card-head"><div><h3>Horas y presupuesto</h3><p>Control de horas presupuestadas vs. reales, costo y rentabilidad</p></div>
        <button class="btn btn-gold btn-sm" id="addHorasBtn">+ Registrar horas</button></div>
      <div class="card-body" id="horasSummary"></div>
      <div class="card-body pad0" id="horasWrap"></div>
    </div>
  `;
  paint();
  function paint(){
    const totPres = enc.horas.reduce((s,h)=>s+(Number(h.horasPresupuestadas)||0),0);
    const totReal = enc.horas.reduce((s,h)=>s+(Number(h.horasReales)||0),0);
    const costoReal = enc.horas.reduce((s,h)=>s+(Number(h.horasReales)||0)*(Number(h.tarifa)||0),0);
    const costoPres = enc.horas.reduce((s,h)=>s+(Number(h.horasPresupuestadas)||0)*(Number(h.tarifa)||0),0);
    const variacion = totPres? Math.round(((totReal-totPres)/totPres)*100) : 0;
    document.getElementById('horasSummary').innerHTML = `
      <div class="grid-3">
        <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Horas presupuestadas</span></div><div class="kpi-value" style="font-size:22px;">${fmtHours(totPres)}</div></div>
        <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Horas reales</span></div><div class="kpi-value" style="font-size:22px;">${fmtHours(totReal)}</div><div class="kpi-sub" style="color:${variacion>0?'var(--danger)':'var(--success)'};">${variacion>0?'+':''}${variacion}% vs. presupuesto</div></div>
        <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Costo real / presupuestado</span></div><div class="kpi-value" style="font-size:22px;">${fmtMoney(costoReal, enc.moneda)}</div><div class="kpi-sub">de ${fmtMoney(costoPres, enc.moneda)}</div></div>
      </div>`;
    document.getElementById('horasWrap').innerHTML = UI.renderTable({
      columns:[
        {label:'Usuario', render:r=>escapeHtml(C.getUserName(r.usuarioId))},
        {label:'Área / Actividad', key:'area'},
        {label:'Horas presup.', render:r=>fmtHours(r.horasPresupuestadas)},
        {label:'Horas reales', render:r=>fmtHours(r.horasReales)},
        {label:'Variación', render:r=>{
          const v = (Number(r.horasReales)||0)-(Number(r.horasPresupuestadas)||0);
          return `<span style="color:${v>0?'var(--danger)':'var(--success)'};font-weight:700;">${v>0?'+':''}${v.toFixed(1)} h</span>`;
        }},
        {label:'Tarifa/h', render:r=>fmtMoney(r.tarifa, enc.moneda)},
        {label:'Costo real', render:r=>fmtMoney((Number(r.horasReales)||0)*(Number(r.tarifa)||0), enc.moneda)},
      ],
      rows: enc.horas,
      actions:(r)=>`<button class="btn btn-ghost btn-sm" data-stop data-edit="${r.id}">Editar</button> <button class="btn btn-danger-ghost btn-sm" data-stop data-del="${r.id}">Eliminar</button>`,
      emptyIcon:'⏱️', emptyTitle:'Sin registros de horas', emptyDesc:'Registre el presupuesto y las horas reales por usuario/área.'
    });
    document.querySelectorAll('#horasWrap [data-edit]').forEach(b=>b.addEventListener('click',()=>openForm(b.getAttribute('data-edit'))));
    document.querySelectorAll('#horasWrap [data-del]').forEach(b=>b.addEventListener('click',()=>{
      const id=b.getAttribute('data-del');
      enc.horas = enc.horas.filter(x=>x.id!==id); saveDB(); paint(); toast('Registro eliminado.','success');
    }));
  }
  document.getElementById('addHorasBtn').addEventListener('click', ()=>openForm(null));
  function openForm(id){
    const editing = id? enc.horas.find(x=>x.id===id): null;
    UI.formModal({
      title: editing?'Editar registro de horas':'Registrar horas', schema:[
        {key:'usuarioId', label:'Usuario', type:'select', required:true, options:()=>db.usuarios.map(u=>({value:u.id,label:u.nombre}))},
        {key:'area', label:'Área / Actividad', required:true},
        {key:'horasPresupuestadas', label:'Horas presupuestadas', type:'number', step:'0.5'},
        {key:'horasReales', label:'Horas reales', type:'number', step:'0.5'},
        {key:'tarifa', label:'Tarifa por hora', type:'number'},
      ], values: editing||{}, submitLabel:'Guardar',
      onSubmit(vals){
        if(editing) Object.assign(editing, vals); else enc.horas.push({id:uid('hp'), ...vals});
        logAction(editing?'Editó horas':'Registró horas', C.getUserName(vals.usuarioId));
        saveDB(); UI.closeModal(); paint(); toast('Registro guardado.','success');
      }
    });
  }
};

/* ---------------- TAB: REVISIÓN Y SUPERVISIÓN ---------------- */
TAB.revision = function(enc, holder){
  const db = DBref();
  holder.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div><h3>Cadena de revisión jerárquica</h3><p>Preparador → Senior → Manager → Director → Partner</p></div></div>
        <div class="card-body">
          <div style="display:flex;flex-wrap:wrap;gap:10px;">
            ${C.NIVELES_REVISION.map((n,i)=>`<div class="chip" style="padding:8px 14px;">${i+1}. ${n}</div>`).join('<span style="align-self:center;color:var(--text-faint);">→</span>')}
          </div>
          <p style="font-size:12px;color:var(--text-muted);margin-top:14px;">Cada nivel debe registrar: quién preparó, quién revisó, cuándo, qué comentario hizo y qué modificación se realizó — trazabilidad completa exigida por el sistema de gestión de calidad (ISQM 1).</p>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Registrar revisión</h3></div></div>
        <div class="card-body"><button class="btn btn-gold" id="addRevBtn" style="width:100%;">+ Nueva revisión / comentario</button></div>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Bitácora de revisión y supervisión</h3></div>
      <div class="card-body pad0" id="revWrap"></div>
    </div>
  `;
  paint();
  function paint(){
    const rows = [...enc.revisiones].sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||''));
    if(rows.length===0){
      document.getElementById('revWrap').innerHTML = `<div class="empty-state"><div class="es-icon">🧾</div><h4>Sin revisiones registradas</h4><p>Registre la primera revisión del encargo.</p></div>`;
      return;
    }
    document.getElementById('revWrap').innerHTML = `<div style="padding:20px;"><div class="timeline">
      ${rows.map(r=>`<div class="timeline-item">
        <div class="ti-title">${escapeHtml(r.nivel)} · ${escapeHtml(r.referencia)} ${UI.badge(r.estado)}</div>
        <div class="ti-meta">${escapeHtml(C.getUserName(r.responsable))} · ${fmtDate(r.fecha)}</div>
        ${r.comentario? `<div class="ti-note">${escapeHtml(r.comentario)}</div>`:''}
      </div>`).join('')}
    </div></div>`;
  }
  document.getElementById('addRevBtn').addEventListener('click', ()=>{
    UI.formModal({
      title:'Nueva revisión / comentario', schema:[
        {key:'nivel', label:'Nivel de revisión', type:'select', required:true, options:C.NIVELES_REVISION},
        {key:'referencia', label:'Referencia (área / papel de trabajo)', required:true, placeholder:'Ej. Efectivo y equivalentes'},
        {key:'responsable', label:'Responsable', type:'select', required:true, options:()=>db.usuarios.map(u=>({value:u.id,label:u.nombre}))},
        {key:'fecha', label:'Fecha', type:'date', required:true},
        {key:'estado', label:'Estado', type:'select', required:true, options:C.ESTADOS_REVISION},
        {key:'comentario', label:'Comentario / modificación realizada', type:'textarea', span:'full'},
      ], values:{fecha:C.todayStr()}, submitLabel:'Registrar',
      onSubmit(vals){
        enc.revisiones.push({id:uid('rev'), ...vals});
        logAction('Registró revisión', vals.nivel+' — '+vals.referencia);
        saveDB(); UI.closeModal(); paint(); toast('Revisión registrada.','success');
      }
    });
  });
};

/* ---------------- TAB: INFORMES ---------------- */
TAB.informes = function(enc, holder){
  holder.innerHTML = `
    <div class="card">
      <div class="card-head"><div><h3>Informes y comunicaciones</h3><p>Informe de auditoría, opinión, cartas y comunicaciones regulatorias</p></div>
        <button class="btn btn-gold btn-sm" id="addInfBtn">+ Nuevo informe</button></div>
      <div class="card-body pad0" id="infWrap"></div>
    </div>
  `;
  paint();
  function paint(){
    document.getElementById('infWrap').innerHTML = UI.renderTable({
      columns:[
        {label:'Tipo', render:r=>`<b>${escapeHtml(r.tipo)}</b>`},
        {label:'Responsable', key:'responsable'},
        {label:'Versión', render:r=>`v${escapeHtml(r.version||'0.1')}`},
        {label:'Fecha', render:r=>r.fecha? fmtDate(r.fecha):'Sin emitir'},
        {label:'Estado', render:r=>UI.badge(r.estado)},
      ],
      rows: enc.informes,
      actions:(r)=>`<button class="btn btn-ghost btn-sm" data-stop data-edit="${r.id}">Editar</button> <button class="btn btn-danger-ghost btn-sm" data-stop data-del="${r.id}">Eliminar</button>`,
      emptyIcon:'📝', emptyTitle:'Sin informes', emptyDesc:'Cree el primer informe del encargo.'
    });
    document.querySelectorAll('#infWrap [data-edit]').forEach(b=>b.addEventListener('click',()=>openForm(b.getAttribute('data-edit'))));
    document.querySelectorAll('#infWrap [data-del]').forEach(b=>b.addEventListener('click',()=>{
      const id=b.getAttribute('data-del');
      enc.informes = enc.informes.filter(x=>x.id!==id); saveDB(); paint(); toast('Informe eliminado.','success');
    }));
  }
  document.getElementById('addInfBtn').addEventListener('click', ()=>openForm(null));
  function openForm(id){
    const editing = id? enc.informes.find(x=>x.id===id): null;
    UI.formModal({
      title: editing?'Editar informe':'Nuevo informe', schema:[
        {key:'tipo', label:'Tipo de informe', type:'select', required:true, options:C.TIPOS_INFORME},
        {key:'responsable', label:'Responsable'},
        {key:'version', label:'Versión', placeholder:'0.1'},
        {key:'fecha', label:'Fecha de emisión', type:'date'},
        {key:'estado', label:'Estado', type:'select', options:['Borrador','En revisión','Aprobado','Emitido']},
      ], values: editing||{estado:'Borrador', version:'0.1'}, submitLabel:'Guardar',
      onSubmit(vals){
        if(editing) Object.assign(editing, vals); else enc.informes.push({id:uid('inf'), ...vals});
        logAction(editing?'Editó informe':'Creó informe', vals.tipo);
        saveDB(); UI.closeModal(); paint(); toast('Informe guardado.','success');
      }
    });
  }
};

window.__SIGA_VIEWS_5__ = true;
})();

/* =========================================================================
   PARTE 10 — TAB: Normativa Aplicable, Archivo Permanente, Archivo Corriente,
   Configuración del Encargo
   ========================================================================= */
(function(){
"use strict";
const C = window.__SIGA_CORE__;
const UI = window.__SIGA_UI__;
const {escapeHtml, fmtDate, uid, toast, saveDB, logAction} = C;
const DBref = () => C.DB();
const TAB = window.__ENCARGO_TAB_RENDERERS__;

/* ---------------- TAB: NORMATIVA APLICABLE ---------------- */
TAB.normativa = function(enc, holder){
  const aplicable = window.Modules.calcularNormativaAplicable({paisId:enc.paisId, industria:enc.industria, tipoEncargo:enc.tipo});
  holder.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div><h3>Normativa aplicable al encargo</h3><p>Motor Normativo: Normativa Global + Normativa País + Normativa Industria + Tipo de Encargo</p></div>
      </div>
      <div class="card-body" style="padding-bottom:0;">
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">
          <span class="chip">País: ${escapeHtml(C.getPaisName(enc.paisId))}</span>
          <span class="chip">Industria: ${escapeHtml(enc.industria)}</span>
          <span class="chip">Tipo: ${escapeHtml(enc.tipo)}</span>
          <span class="chip">${aplicable.length} norma(s) aplicable(s)</span>
        </div>
      </div>
      <div class="card-body pad0" id="normEncWrap"></div>
    </div>
  `;
  document.getElementById('normEncWrap').innerHTML = UI.renderTable({
    columns:[
      {label:'Norma', render:r=>`<b>${escapeHtml(r.norma)}</b>`},
      {label:'Jurisdicción', render:r=>UI.badge(r.jurisdiccion)},
      {label:'Versión', key:'version'},
      {label:'Vigente desde', render:r=>fmtDate(r.vigenteDesde)},
      {label:'Fuente oficial', key:'fuenteOficial'},
      {label:'Procedimientos relacionados', key:'procedimientosRelacionados'},
    ],
    rows: aplicable, actions:()=>'',
    emptyIcon:'⚖️', emptyTitle:'Sin normativa aplicable configurada', emptyDesc:'Configure el catálogo normativo global en el módulo Motor Normativo.'
  });
};

/* ---------------- TAB: ARCHIVO PERMANENTE / CORRIENTE (genérico) ---------------- */
function archivoTabFactory(prop, titulo, descripcion, categoriasDefault){
  return function(enc, holder){
    holder.innerHTML = `
      <div class="card">
        <div class="card-head"><div><h3>${titulo}</h3><p>${descripcion}</p></div>
          <button class="btn btn-gold btn-sm" id="addDocBtn">+ Agregar documento</button></div>
        <div class="card-body pad0" id="docWrap"></div>
      </div>`;
    paint();
    function paint(){
      document.getElementById('docWrap').innerHTML = UI.renderTable({
        columns:[
          {label:'Documento', render:r=>`<b>${escapeHtml(r.nombre)}</b><br><span class="tag-mono">${escapeHtml(r.archivo||'sin archivo adjunto')}</span>`},
          {label:'Categoría', render:r=>UI.badge(r.categoria)},
          {label:'Responsable', key:'responsable'},
          {label:'Fecha', render:r=>fmtDate(r.fecha)},
          {label:'Versión', render:r=>`v${escapeHtml(r.version||'1.0')}`},
        ],
        rows: enc[prop],
        actions:(r)=>`<button class="btn btn-ghost btn-sm" data-stop data-edit="${r.id}">Editar</button> <button class="btn btn-danger-ghost btn-sm" data-stop data-del="${r.id}">Eliminar</button>`,
        emptyIcon:'🗄️', emptyTitle:'Sin documentos', emptyDesc:'Agregue documentos a este archivo.'
      });
      document.querySelectorAll('#docWrap [data-edit]').forEach(b=>b.addEventListener('click',()=>openForm(b.getAttribute('data-edit'))));
      document.querySelectorAll('#docWrap [data-del]').forEach(b=>b.addEventListener('click',()=>{
        const id=b.getAttribute('data-del');
        window.confirmDialog('Eliminar documento', '¿Confirma que desea eliminar este documento del archivo?', ()=>{
          enc[prop] = enc[prop].filter(x=>x.id!==id); saveDB(); paint(); toast('Documento eliminado.','success');
        }, {danger:true, confirmLabel:'Eliminar'});
      }));
    }
    document.getElementById('addDocBtn').addEventListener('click', ()=>openForm(null));
    function openForm(id){
      const editing = id? enc[prop].find(x=>x.id===id): null;
      UI.formModal({
        title: editing?'Editar documento':'Agregar documento', schema:[
          {key:'nombre', label:'Nombre del documento', required:true, span:'full'},
          {key:'categoria', label:'Categoría', type:'select', options:categoriasDefault},
          {key:'responsable', label:'Responsable'},
          {key:'fecha', label:'Fecha', type:'date'},
          {key:'version', label:'Versión', placeholder:'1.0'},
          {key:'archivo', label:'Nombre de archivo (simulado)', placeholder:'documento.pdf'},
        ], values: editing||{version:'1.0'}, submitLabel:'Guardar',
        onSubmit(vals){
          if(editing) Object.assign(editing, vals); else enc[prop].push({id:uid('doc'), ...vals});
          logAction(editing?'Editó documento de archivo':'Agregó documento a archivo', vals.nombre);
          saveDB(); UI.closeModal(); paint(); toast('Documento guardado.','success');
        }
      });
    }
  };
}
TAB.archivoperm = archivoTabFactory('archivoPermanente', 'Archivo permanente',
  'Escritura, estatutos, registro mercantil, organigrama, contratos, políticas, manuales, actas e información histórica.',
  ['Legal','Estatutos','Registro mercantil','Organigrama','Contratos','Políticas','Manuales','Actas','Fiscal','Histórico']);
TAB.archivocorr = archivoTabFactory('archivoCorriente', 'Archivo corriente',
  'Planificación, riesgos, materialidad, procedimientos, evidencia, papeles de trabajo, hallazgos, ajustes y conclusión del período actual.',
  ['Planificación','Riesgos','Materialidad','Procedimientos','Evidencia','Papeles de trabajo','Hallazgos','Ajustes','Conclusión']);

/* ---------------- TAB: CONFIGURACIÓN DEL ENCARGO ---------------- */
TAB.configenc = function(enc, holder){
  holder.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><h3>Parámetros del encargo</h3></div>
        <div class="card-body">
          <div class="detail-list">
            <div class="dl-row"><div class="dl-key">Plantilla metodológica</div><div class="dl-val">${escapeHtml(enc.configuracion?.plantillaMetodologica||'—')}</div></div>
            <div class="dl-row"><div class="dl-key">Visitas configuradas</div><div class="dl-val">${enc.visitas.length}</div></div>
            <div class="dl-row"><div class="dl-key">Áreas configuradas</div><div class="dl-val">${enc.areas.length}</div></div>
            <div class="dl-row"><div class="dl-key">Parámetros adicionales</div><div class="dl-val">${escapeHtml(enc.configuracion?.parametrosAdicionales||'—')}</div></div>
          </div>
          <button class="btn btn-secondary btn-sm" id="editCfgBtn" style="margin-top:14px;">Editar parámetros</button>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Zona de riesgo</h3></div>
        <div class="card-body">
          <p style="font-size:12.5px;color:var(--text-muted);margin-bottom:14px;">Estas acciones afectan de forma permanente el encargo actual.</p>
          <button class="btn btn-danger-ghost" id="deleteEncBtn" style="border:1px solid var(--danger);">Eliminar este encargo</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('editCfgBtn').addEventListener('click', ()=>{
    UI.formModal({
      title:'Parámetros del encargo', schema:[
        {key:'plantillaMetodologica', label:'Plantilla metodológica'},
        {key:'parametrosAdicionales', label:'Parámetros adicionales', type:'textarea', span:'full'},
      ], values: enc.configuracion||{}, submitLabel:'Guardar',
      onSubmit(vals){ enc.configuracion = vals; saveDB(); UI.closeModal(); toast('Configuración actualizada.','success'); Router.refresh(); }
    });
  });
  document.getElementById('deleteEncBtn').addEventListener('click', ()=>{
    window.confirmDialog('Eliminar encargo', `¿Confirma que desea eliminar permanentemente el encargo <b>${escapeHtml(enc.nombre)}</b>? Se perderá toda la información asociada: áreas, papeles de trabajo, evidencia, hallazgos e informes.`, ()=>{
      const db = DBref();
      db.encargos = db.encargos.filter(x=>x.id!==enc.id);
      logAction('Eliminó encargo', enc.nombre);
      saveDB(); toast('Encargo eliminado.','success'); Router.go('encargos');
    }, {danger:true, confirmLabel:'Eliminar definitivamente'});
  });
};

window.__SIGA_VIEWS_6__ = true;
})();

/* =========================================================================
   PARTE 11 — CONFIGURACIÓN GLOBAL DEL SISTEMA
   (Organización/Identidad, Firmas, Países, Oficinas, Usuarios, Roles, Bitácora)
   ========================================================================= */
(function(){
"use strict";
const C = window.__SIGA_CORE__;
const UI = window.__SIGA_UI__;
const {escapeHtml, fmtDate, fmtDateTime, uid, toast, saveDB, logAction} = C;
const DBref = () => C.DB();
const Views = window.Views;

function configHeader(title, desc){
  return `<div class="page-header"><div><h1>${escapeHtml(title)}</h1><p class="desc">${escapeHtml(desc)}</p></div></div>`;
}
function crumbConfig(label){
  window.setBreadcrumbGlobal([{label:'SIGA', strong:true}, {label:'Configuración'}, {label, strong:true}]);
}

/* ---------------- ORGANIZACIÓN E IDENTIDAD CORPORATIVA ---------------- */
Views['config-organizacion'] = function(){
  crumbConfig('Organización e Identidad');
  const db = DBref();
  mainContentEl.innerHTML = `<div class="page-wrap">
    ${configHeader('Organización e Identidad Corporativa', 'Configuración global de marca, colores, logos y parámetros de la organización. No requiere modificar código: todo es configurable.')}
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><h3>Datos de la organización</h3></div>
        <div class="card-body" id="orgFormWrap"></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Identidad visual</h3><p>Colores corporativos y textos de logo (login y topbar)</p></div>
        <div class="card-body" id="brandFormWrap"></div>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Vista previa del login</h3></div>
      <div class="card-body" style="background:var(--surface-2);">
        <div style="max-width:360px;padding:20px;border-radius:12px;background:linear-gradient(160deg, var(--navy-950), var(--navy-800));color:#fff;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;"><div class="brand-mark" style="width:30px;height:30px;font-size:13px;">${escapeHtml((db.config.nombreOrganizacion||'S').charAt(0))}</div><span style="font-size:13px;color:#a9bcd4;">${escapeHtml(db.firmas[0]?.nombre||'')}</span></div>
          <div style="font-family:var(--font-display);font-size:26px;">SIGA</div>
          <div style="font-size:12px;color:#b7c6da;margin-top:6px;">Sistema Integral de Gestión de Auditorías</div>
        </div>
      </div>
    </div>
  </div>`;

  document.getElementById('orgFormWrap').innerHTML = `
    <div class="field"><label>Nombre de la organización / red</label><input id="orgNombre" value="${escapeHtml(db.config.nombreOrganizacion)}"></div>
    <div class="field"><label>Idioma predeterminado</label><select id="orgIdioma">${C.IDIOMAS.map(i=>`<option ${db.config.idiomaDefault===i?'selected':''}>${i}</option>`).join('')}</select></div>
    <div class="field"><label>Moneda predeterminada</label><select id="orgMoneda">${C.MONEDAS.map(m=>`<option ${db.config.monedaDefault===m?'selected':''}>${m}</option>`).join('')}</select></div>
    <button class="btn btn-gold btn-sm" id="saveOrgBtn">Guardar</button>
  `;
  document.getElementById('saveOrgBtn').addEventListener('click', ()=>{
    db.config.nombreOrganizacion = document.getElementById('orgNombre').value;
    db.config.idiomaDefault = document.getElementById('orgIdioma').value;
    db.config.monedaDefault = document.getElementById('orgMoneda').value;
    logAction('Actualizó configuración de organización');
    saveDB(); toast('Organización actualizada.','success'); Router.refresh();
  });

  document.getElementById('brandFormWrap').innerHTML = `
    <div class="grid-2">
      <div class="field"><label>Color primario (navy)</label><input type="color" id="colorPrim" value="${db.config.colorPrimario}" style="height:40px;padding:4px;"></div>
      <div class="field"><label>Color de acento (gold)</label><input type="color" id="colorAcc" value="${db.config.colorAcento}" style="height:40px;padding:4px;"></div>
    </div>
    <div class="field"><label>Texto "Logo firma" (login)</label><input id="logoFirmaTxt" value="${escapeHtml(db.config.logoFirmaTexto)}"></div>
    <div class="field"><label>Texto "Logo local" (login)</label><input id="logoLocalTxt" value="${escapeHtml(db.config.logoLocalTexto)}"></div>
    <div class="field-hint" style="margin-bottom:10px;">En producción, estos campos aceptarían la carga de archivos de imagen (logo principal, secundario, internacional, favicon, fondo de login) por firma y por país, almacenados en el módulo de Assets sin necesidad de desplegar código nuevo.</div>
    <button class="btn btn-gold btn-sm" id="saveBrandBtn">Guardar identidad</button>
  `;
  document.getElementById('saveBrandBtn').addEventListener('click', ()=>{
    db.config.colorPrimario = document.getElementById('colorPrim').value;
    db.config.colorAcento = document.getElementById('colorAcc').value;
    db.config.logoFirmaTexto = document.getElementById('logoFirmaTxt').value;
    db.config.logoLocalTexto = document.getElementById('logoLocalTxt').value;
    logAction('Actualizó identidad corporativa');
    saveDB(); toast('Identidad corporativa actualizada.','success');
    document.documentElement.style.setProperty('--navy-900', db.config.colorPrimario);
    document.documentElement.style.setProperty('--gold-500', db.config.colorAcento);
    Router.refresh();
  });
};

/* ---------------- Generic simple-catalog manager (Firmas, Países, Oficinas) ---------------- */
function simpleCatalogView({title, desc, collectionKey, schema, columns, emptyIcon, canDelete}){
  return function(){
    crumbConfig(title);
    const db = DBref();
    mainContentEl.innerHTML = `<div class="page-wrap">
      <div class="page-header"><div><h1>${escapeHtml(title)}</h1><p class="desc">${escapeHtml(desc)}</p></div>
        <div class="page-actions"><button class="btn btn-gold" id="addItemBtn">+ Agregar</button></div></div>
      <div class="card"><div class="card-body pad0" id="catTableWrap"></div></div>
    </div>`;
    paint();
    function paint(){
      const rows = db[collectionKey];
      document.getElementById('catTableWrap').innerHTML = UI.renderTable({
        columns, rows,
        actions:(r)=>`<button class="btn btn-ghost btn-sm" data-stop data-edit="${r.id}">Editar</button>${canDelete!==false?` <button class="btn btn-danger-ghost btn-sm" data-stop data-del="${r.id}">Eliminar</button>`:''}`,
        emptyIcon: emptyIcon||'📋', emptyTitle:'Sin registros', emptyDesc:'Agregue el primer registro de este catálogo.'
      });
      document.querySelectorAll('#catTableWrap [data-edit]').forEach(b=>b.addEventListener('click',()=>openForm(b.getAttribute('data-edit'))));
      document.querySelectorAll('#catTableWrap [data-del]').forEach(b=>b.addEventListener('click',()=>{
        const id=b.getAttribute('data-del');
        window.confirmDialog('Eliminar registro', '¿Confirma que desea eliminar este registro del catálogo?', ()=>{
          db[collectionKey] = db[collectionKey].filter(x=>x.id!==id); saveDB(); paint(); toast('Registro eliminado.','success');
        }, {danger:true, confirmLabel:'Eliminar'});
      }));
    }
    document.getElementById('addItemBtn').addEventListener('click', ()=>openForm(null));
    function openForm(id){
      const editing = id? db[collectionKey].find(x=>x.id===id): null;
      UI.formModal({
        title: editing? 'Editar registro':'Nuevo registro',
        schema: typeof schema==='function'? schema(): schema,
        values: editing||{}, submitLabel:'Guardar',
        onSubmit(vals){
          if(editing) Object.assign(editing, vals); else db[collectionKey].push({id:uid('c'), ...vals});
          logAction((editing?'Editó ':'Creó ')+title, vals.nombre);
          saveDB(); UI.closeModal(); paint(); toast('Registro guardado.','success');
        }
      });
    }
  };
}

Views['config-firmas'] = simpleCatalogView({
  title:'Firmas', desc:'Firmas miembro de la red/organización.', collectionKey:'firmas',
  schema:[
    {key:'nombre', label:'Nombre de la firma', required:true, span:'full'},
    {key:'red', label:'Red / Network'},
    {key:'pais', label:'Alcance geográfico', placeholder:'Ej. Regional, Nacional'},
    {key:'estado', label:'Estado', type:'select', options:['Activa','Inactiva']},
  ],
  columns:[
    {label:'Firma', render:r=>`<b>${escapeHtml(r.nombre)}</b>`},
    {label:'Red', key:'red'}, {label:'Alcance', key:'pais'}, {label:'Estado', render:r=>UI.badge(r.estado)},
  ], emptyIcon:'🏛️'
});

Views['config-paises'] = simpleCatalogView({
  title:'Países', desc:'Configuración de jurisdicciones: moneda, idioma, reguladores y calendario fiscal por país.', collectionKey:'paises',
  schema:[
    {key:'nombre', label:'País', required:true},
    {key:'codigo', label:'Código ISO', placeholder:'GT'},
    {key:'moneda', label:'Moneda', type:'select', options:C.MONEDAS},
    {key:'idioma', label:'Idioma', type:'select', options:C.IDIOMAS},
    {key:'regulador', label:'Organismo(s) regulador(es)', span:'full'},
    {key:'calendarioFiscal', label:'Calendario fiscal', placeholder:'Enero–Diciembre'},
  ],
  columns:[
    {label:'País', render:r=>`<b>${escapeHtml(r.nombre)}</b> <span class="tag-mono">${escapeHtml(r.codigo||'')}</span>`},
    {label:'Moneda', key:'moneda'}, {label:'Idioma', key:'idioma'}, {label:'Regulador', key:'regulador'}, {label:'Calendario fiscal', key:'calendarioFiscal'},
  ], emptyIcon:'🌎'
});

Views['config-oficinas'] = simpleCatalogView({
  title:'Oficinas', desc:'Oficinas por país donde opera la firma.', collectionKey:'oficinas',
  schema:()=>[
    {key:'nombre', label:'Nombre de la oficina', required:true, span:'full'},
    {key:'paisId', label:'País', type:'select', required:true, options:()=>DBref().paises.map(p=>({value:p.id,label:p.nombre}))},
    {key:'direccion', label:'Dirección', span:'full'},
    {key:'responsable', label:'Responsable de oficina'},
  ],
  columns:[
    {label:'Oficina', render:r=>`<b>${escapeHtml(r.nombre)}</b>`},
    {label:'País', render:r=>escapeHtml(C.getPaisName(r.paisId))},
    {label:'Dirección', key:'direccion'}, {label:'Responsable', key:'responsable'},
  ], emptyIcon:'🏢'
});

/* ---------------- USUARIOS ---------------- */
Views['config-usuarios'] = function(){
  crumbConfig('Usuarios');
  const db = DBref();
  mainContentEl.innerHTML = `<div class="page-wrap">
    <div class="page-header"><div><h1>Usuarios</h1><p class="desc">Administración de usuarios, roles y asignación a oficinas. Cada usuario visualiza únicamente los encargos que le correspondan según su asignación.</p></div>
      <div class="page-actions"><button class="btn btn-gold" id="addUserBtn">+ Crear usuario</button></div></div>
    <div class="card"><div class="card-body pad0" id="userTableWrap"></div></div>
  </div>`;
  paint();
  function paint(){
    document.getElementById('userTableWrap').innerHTML = UI.renderTable({
      columns:[
        {label:'Usuario', render:r=>`<b>${escapeHtml(r.nombre)}</b><br><span class="tag-mono">${escapeHtml(r.usuario)}</span>`},
        {label:'Correo', key:'email'},
        {label:'Rol', render:r=>escapeHtml(C.getRolName(r.rolId))},
        {label:'Oficina', render:r=>escapeHtml(C.getOficina(r.oficinaId)?.nombre||'—')},
        {label:'Cargo', key:'cargo'},
        {label:'Estado', render:r=>UI.badge(r.estado)},
      ],
      rows: db.usuarios,
      actions:(r)=>`<button class="btn btn-ghost btn-sm" data-stop data-edit="${r.id}">Editar</button> <button class="btn btn-danger-ghost btn-sm" data-stop data-del="${r.id}">Eliminar</button>`,
      emptyIcon:'👤', emptyTitle:'Sin usuarios', emptyDesc:'Cree el primer usuario del sistema.'
    });
    document.querySelectorAll('#userTableWrap [data-edit]').forEach(b=>b.addEventListener('click',()=>openForm(b.getAttribute('data-edit'))));
    document.querySelectorAll('#userTableWrap [data-del]').forEach(b=>b.addEventListener('click',()=>{
      const id=b.getAttribute('data-del');
      if(id===db.session.usuarioId){ toast('No puede eliminar el usuario con el que tiene la sesión activa.','error'); return; }
      window.confirmDialog('Eliminar usuario', '¿Confirma que desea eliminar este usuario del sistema?', ()=>{
        db.usuarios = db.usuarios.filter(x=>x.id!==id); saveDB(); paint(); toast('Usuario eliminado.','success');
      }, {danger:true, confirmLabel:'Eliminar'});
    }));
  }
  document.getElementById('addUserBtn').addEventListener('click', ()=>openForm(null));
  function openForm(id){
    const editing = id? db.usuarios.find(x=>x.id===id): null;
    UI.formModal({
      title: editing?'Editar usuario':'Crear usuario', schema:[
        {key:'nombre', label:'Nombre completo', required:true, span:'full'},
        {key:'usuario', label:'Usuario', required:true},
        {key:'email', label:'Correo electrónico', type:'email', required:true},
        {key:'password', label:'Contraseña', type:'password', required: !editing, hint: editing?'Dejar sin cambios si no desea modificarla':''},
        {key:'rolId', label:'Rol', type:'select', required:true, options:()=>db.roles.map(r=>({value:r.id,label:r.nombre}))},
        {key:'oficinaId', label:'Oficina', type:'select', options:()=>db.oficinas.map(o=>({value:o.id,label:o.nombre}))},
        {key:'cargo', label:'Cargo'},
        {key:'telefono', label:'Teléfono'},
        {key:'estado', label:'Estado', type:'select', options:['Activo','Inactivo']},
      ], values: editing||{estado:'Activo'}, submitLabel:'Guardar',
      onSubmit(vals){
        if(editing){
          if(!vals.password) delete vals.password;
          Object.assign(editing, vals);
        } else {
          db.usuarios.push({id:uid('user'), ...vals});
        }
        logAction(editing?'Editó usuario':'Creó usuario', vals.nombre);
        saveDB(); UI.closeModal(); paint(); toast('Usuario guardado.','success');
      }
    });
  }
};

/* ---------------- ROLES Y PERMISOS ---------------- */
Views['config-roles'] = function(){
  crumbConfig('Roles y Permisos');
  const db = DBref();
  const PERM_KEYS = [
    {k:'organizacion', l:'Organización'}, {k:'firmas', l:'Firmas/Países/Oficinas'}, {k:'usuarios', l:'Usuarios'},
    {k:'clientes', l:'Clientes'}, {k:'encargos', l:'Encargos'}, {k:'normativa', l:'Normativa'}, {k:'auditoriaSistema', l:'Auditoría del sistema'}
  ];
  mainContentEl.innerHTML = `<div class="page-wrap">
    <div class="page-header"><div><h1>Roles y Permisos</h1><p class="desc">Modelo RBAC con extensión ABAC (permisos por tenant, firma, país, cliente, encargo, área, documento y acción).</p></div>
      <div class="page-actions"><button class="btn btn-gold" id="addRoleBtn">+ Nuevo rol</button></div></div>
    <div class="card">
      <div class="card-head"><h3>Matriz de permisos por módulo</h3></div>
      <div class="card-body" style="overflow-x:auto;">
        <table class="perm-matrix" id="permMatrix"></table>
      </div>
    </div>
    <div class="card"><div class="card-head"><h3>Roles definidos</h3></div><div class="card-body pad0" id="rolesTableWrap"></div></div>
  </div>`;
  paintMatrix(); paintTable();

  function paintMatrix(){
    document.getElementById('permMatrix').innerHTML = `
      <tr><th>Rol</th>${PERM_KEYS.map(p=>`<th>${escapeHtml(p.l)}</th>`).join('')}</tr>
      ${db.roles.map(r=>`<tr><td>${escapeHtml(r.nombre)}</td>${PERM_KEYS.map(p=>`<td><input type="checkbox" data-permrole="${r.id}" data-permkey="${p.k}" ${r.permisos?.[p.k]?'checked':''}></td>`).join('')}</tr>`).join('')}
    `;
    document.querySelectorAll('#permMatrix input[type=checkbox]').forEach(cb=>{
      cb.addEventListener('change', ()=>{
        const rol = db.roles.find(x=>x.id===cb.getAttribute('data-permrole'));
        if(!rol.permisos) rol.permisos={};
        rol.permisos[cb.getAttribute('data-permkey')] = cb.checked;
        logAction('Actualizó permisos de rol', rol.nombre);
        saveDB();
      });
    });
  }
  function paintTable(){
    document.getElementById('rolesTableWrap').innerHTML = UI.renderTable({
      columns:[
        {label:'Rol', render:r=>`<b>${escapeHtml(r.nombre)}</b>`},
        {label:'Descripción', key:'descripcion'},
        {label:'Usuarios asignados', render:r=> db.usuarios.filter(u=>u.rolId===r.id).length},
      ],
      rows: db.roles,
      actions:(r)=>`<button class="btn btn-ghost btn-sm" data-stop data-edit="${r.id}">Editar</button>`,
      emptyIcon:'🛡️'
    });
    document.querySelectorAll('#rolesTableWrap [data-edit]').forEach(b=>b.addEventListener('click',()=>openForm(b.getAttribute('data-edit'))));
  }
  document.getElementById('addRoleBtn').addEventListener('click', ()=>openForm(null));
  function openForm(id){
    const editing = id? db.roles.find(x=>x.id===id): null;
    UI.formModal({
      title: editing?'Editar rol':'Nuevo rol', schema:[
        {key:'nombre', label:'Nombre del rol', required:true, span:'full'},
        {key:'descripcion', label:'Descripción', type:'textarea', span:'full'},
      ], values: editing||{}, submitLabel:'Guardar',
      onSubmit(vals){
        if(editing) Object.assign(editing, vals); else db.roles.push({id:uid('rol'), ...vals, permisos:{}});
        logAction(editing?'Editó rol':'Creó rol', vals.nombre);
        saveDB(); UI.closeModal(); paintMatrix(); paintTable(); toast('Rol guardado.','success');
      }
    });
  }
};

/* ---------------- BITÁCORA DEL SISTEMA ---------------- */
Views['config-auditoria'] = function(){
  crumbConfig('Bitácora del Sistema');
  const db = DBref();
  mainContentEl.innerHTML = `<div class="page-wrap">
    ${configHeader('Bitácora y trazabilidad del sistema', 'Registro de auditoría (audit trail) de acciones realizadas en SIGA: quién, qué, cuándo.')}
    <div class="card"><div class="card-body pad0" id="bitTableWrap"></div></div>
  </div>`;
  document.getElementById('bitTableWrap').innerHTML = UI.renderTable({
    columns:[
      {label:'Fecha / Hora', render:r=>fmtDateTime(r.fecha)},
      {label:'Usuario', key:'usuario'},
      {label:'Acción', key:'accion'},
      {label:'Entidad', key:'entidad'},
    ],
    rows: db.bitacora.slice(0,300), actions:()=>'',
    emptyIcon:'🧾', emptyTitle:'Sin actividad registrada', emptyDesc:'La actividad del sistema aparecerá aquí.'
  });
};

window.__SIGA_VIEWS_7__ = true;
})();

/* =========================================================================
   PARTE 12 — MOTOR NORMATIVO GLOBAL (catálogo) + DESPACHADOR DE VISTAS
   ========================================================================= */
(function(){
"use strict";
const C = window.__SIGA_CORE__;
const UI = window.__SIGA_UI__;
const {escapeHtml, fmtDate, uid, toast, saveDB, logAction} = C;
const DBref = () => C.DB();
const Views = window.Views;

/* ---------------- MOTOR NORMATIVO (catálogo global) ---------------- */
Views.normativa = function(){
  window.setBreadcrumbGlobal([{label:'SIGA', strong:true}, {label:'Motor Normativo'}]);
  const db = DBref();
  mainContentEl.innerHTML = `<div class="page-wrap">
    <div class="page-header">
      <div><h1>Motor Normativo</h1><p class="desc">Catálogo configurable de normativa: NIA/ISA, NIIF/IFRS, NIIF para PYMES, ISQM, Código de Ética, legislación local, normativa fiscal y normativa específica de industria. Cada registro define jurisdicción, versión, vigencia, fuente oficial y su relación con los procedimientos de auditoría.</p></div>
      <div class="page-actions"><button class="btn btn-gold" id="addNormBtn">+ Nueva norma</button></div>
    </div>
    <div class="subtabs" id="normFilterTabs">
      ${['Todas', ...C.JURISDICCION_NORMA].map((s,i)=>`<button class="subtab-btn ${i===0?'active':''}" data-filter="${s}">${s}</button>`).join('')}
    </div>
    <div class="card"><div class="card-body pad0" id="normTableWrap"></div></div>

    <div class="card">
      <div class="card-head"><div><h3>Simulador: normativa aplicable</h3><p>Motor Normativo Actualizable — Normativa Global + Normativa País + Normativa Industria + Tipo de Encargo → Normativa aplicable</p></div></div>
      <div class="card-body">
        <div class="form-grid" style="margin-bottom:16px;">
          <div class="field"><label>País</label><select id="simPais"><option value="">Cualquiera</option>${db.paises.map(p=>`<option value="${p.id}">${escapeHtml(p.nombre)}</option>`).join('')}</select></div>
          <div class="field"><label>Industria</label><select id="simIndustria"><option value="">Cualquiera</option>${C.INDUSTRIAS.map(i=>`<option>${i}</option>`).join('')}</select></div>
        </div>
        <button class="btn btn-secondary btn-sm" id="simBtn">Calcular normativa aplicable</button>
        <div id="simResultWrap" style="margin-top:16px;"></div>
      </div>
    </div>
  </div>`;

  let filter='Todas';
  function paint(){
    const rows = db.normativas.filter(n=> filter==='Todas' || n.jurisdiccion===filter);
    document.getElementById('normTableWrap').innerHTML = UI.renderTable({
      columns:[
        {label:'Norma', render:r=>`<b>${escapeHtml(r.norma)}</b>`},
        {label:'Tipo', render:r=>UI.badge(r.tipo)},
        {label:'Jurisdicción', render:r=>`${UI.badge(r.jurisdiccion)} ${r.pais?escapeHtml(r.pais):(r.industria?escapeHtml(r.industria):'')}`},
        {label:'Versión', key:'version'},
        {label:'Vigente desde', render:r=>fmtDate(r.vigenteDesde)},
        {label:'Fuente oficial', key:'fuenteOficial'},
      ],
      rows,
      actions:(r)=>`<button class="btn btn-ghost btn-sm" data-stop data-edit="${r.id}">Editar</button> <button class="btn btn-danger-ghost btn-sm" data-stop data-del="${r.id}">Eliminar</button>`,
      emptyIcon:'⚖️', emptyTitle:'Sin normas registradas', emptyDesc:'Agregue normas al catálogo para que el motor normativo pueda calcular aplicabilidad.'
    });
    document.querySelectorAll('#normTableWrap [data-edit]').forEach(b=>b.addEventListener('click',()=>openForm(b.getAttribute('data-edit'))));
    document.querySelectorAll('#normTableWrap [data-del]').forEach(b=>b.addEventListener('click',()=>{
      const id=b.getAttribute('data-del');
      window.confirmDialog('Eliminar norma', '¿Confirma que desea eliminar esta norma del catálogo? Esto puede afectar el cálculo de normativa aplicable en los encargos.', ()=>{
        db.normativas = db.normativas.filter(x=>x.id!==id); saveDB(); paint(); toast('Norma eliminada.','success');
      }, {danger:true, confirmLabel:'Eliminar'});
    }));
  }
  paint();
  document.getElementById('addNormBtn').addEventListener('click', ()=>openForm(null));
  document.querySelectorAll('#normFilterTabs [data-filter]').forEach(b=>{
    b.addEventListener('click', ()=>{
      document.querySelectorAll('#normFilterTabs .subtab-btn').forEach(x=>x.classList.remove('active'));
      b.classList.add('active'); filter=b.getAttribute('data-filter'); paint();
    });
  });
  document.getElementById('simBtn').addEventListener('click', ()=>{
    const paisId = document.getElementById('simPais').value;
    const industria = document.getElementById('simIndustria').value;
    const res = window.Modules.calcularNormativaAplicable({paisId, industria});
    document.getElementById('simResultWrap').innerHTML = UI.renderTable({
      columns:[{label:'Norma', render:r=>`<b>${escapeHtml(r.norma)}</b>`}, {label:'Jurisdicción', render:r=>UI.badge(r.jurisdiccion)}, {label:'Requisito', key:'requisito'}],
      rows: res, actions:()=>'', emptyIcon:'⚖️', emptyTitle:'Sin coincidencias', emptyDesc:'No hay normativa aplicable con los criterios seleccionados.'
    });
  });

  function openForm(id){
    const editing = id? db.normativas.find(x=>x.id===id): null;
    UI.formModal({
      title: editing?'Editar norma':'Nueva norma', subtitle:'Registro versionado por jurisdicción y vigencia',
      schema:[
        {key:'norma', label:'Norma / Estándar', required:true, span:'full'},
        {key:'tipo', label:'Tipo', type:'select', required:true, options:C.NORMAS_BASE_TIPO},
        {key:'jurisdiccion', label:'Jurisdicción', type:'select', required:true, options:C.JURISDICCION_NORMA},
        {key:'pais', label:'País (si jurisdicción = País)', type:'select', options:()=>db.paises.map(p=>p.nombre)},
        {key:'industria', label:'Industria (si jurisdicción = Industria)', type:'select', options:C.INDUSTRIAS},
        {key:'version', label:'Versión'},
        {key:'vigenteDesde', label:'Fecha de entrada en vigor', type:'date'},
        {key:'fuenteOficial', label:'Fuente oficial', placeholder:'Ej. IFAC/IAASB, IASB, ente regulador local'},
        {key:'requisito', label:'Requisito', type:'textarea', span:'full'},
        {key:'aplicabilidad', label:'Aplicabilidad', type:'textarea', span:'full'},
        {key:'procedimientosRelacionados', label:'Relación con procedimientos de auditoría', span:'full'},
      ], values: editing||{jurisdiccion:'Global'}, submitLabel:'Guardar',
      onSubmit(vals){
        if(editing) Object.assign(editing, vals); else db.normativas.push({id:uid('norm'), ...vals});
        logAction(editing?'Editó norma':'Creó norma', vals.norma);
        saveDB(); UI.closeModal(); paint(); toast('Norma guardada.','success');
      }
    });
  }
};

/* ============================= DESPACHADOR DE VISTAS ============================= */
Views.render = function(view, params){
  if(Views[view]){ Views[view](params); }
  else { window.mainContentEl.innerHTML = '<div class="page-wrap"><div class="empty-state"><h4>Vista no encontrada</h4></div></div>'; }
};

window.__SIGA_VIEWS_FINAL__ = true;
console.log('%cSIGA cargado correctamente','color:#c9a227;font-weight:bold;', '— Prototipo funcional listo.');
})();
