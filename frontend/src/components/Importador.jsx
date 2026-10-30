import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../api';
import { MAX_ELEMENTOS } from '../lib/storage.js';
import { parsearCoordenada, enRangoArgentina } from '../lib/elementos.js';
import {
  CAMPOS_IMPORTACION,
  ETIQUETAS_CAMPO,
  ETIQUETAS_ESTADO,
  MAX_FILAS_BLOQUE,
  MAX_FILAS_IMPORTACION,
  analizarCSV,
  aSolicitud,
  completarConDefectos,
  contarPorEstado,
  contarResueltas,
  coordenadasDeFila,
  crearFilasDesdeDatos,
  datosCrudosDeCSV,
  detectarDuplicados,
  itemParaAgregar,
  marcarBuscando,
  marcarCanceladas,
  marcarError,
  parsearTextoDirecciones,
  pendientesDeGeocodificar,
  seleccionadasParaAgregar,
  validarFila,
  validarFilas,
  aplicarResultados,
} from '../lib/importacion.js';
import { ejecutarLote } from '../lib/lote.js';

const PASOS = {
  ENTRADA: 'entrada',
  REVISION: 'revision',
  PROCESO: 'proceso',
  RESULTADOS: 'resultados',
};

const CAMPOS_EDITABLES = CAMPOS_IMPORTACION;
const MARCA_DUPLICADO = {
  texto: 'misma dirección que',
  coordenadas: 'coordenadas a menos de 5 m de',
};

function leerArchivoComoTexto(archivo) {
  if (archivo && typeof archivo.text === 'function') return archivo.text();
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result || ''));
    lector.onerror = () => reject(lector.error || new Error('No se pudo leer el archivo'));
    lector.readAsText(archivo, 'UTF-8');
  });
}

function Campo({ id, etiqueta, valor, onChange, error, provincias, tipo = 'text', ...resto }) {
  const idError = error ? `${id}-error` : undefined;
  const clases = `form-control ${error ? 'is-invalid' : ''}`;
  return (
    <div className="importador-campo">
      <label className="field-label" htmlFor={id}>{etiqueta}</label>
      {tipo === 'provincia' && provincias.length > 0 ? (
        <select
          id={id}
          className={`form-select ${error ? 'is-invalid' : ''}`}
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={idError}
        >
          <option value="">Elegir provincia</option>
          {provincias.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      ) : (
        <input
          id={id}
          className={clases}
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={idError}
          {...resto}
        />
      )}
      {error && <span className="field-error" id={idError} role="alert">{error}</span>}
    </div>
  );
}

export default function Importador({
  abierto = false,
  onCerrar = () => {},
  provincias = [],
  elementos = [],
  onAgregar = () => ({ agregados: 0, noAgregados: 0 }),
}) {
  const [paso, setPaso] = useState(PASOS.ENTRADA);
  const [modo, setModo] = useState('texto');
  const [textoPegado, setTextoPegado] = useState('');
  const [csvTexto, setCsvTexto] = useState('');
  const [csvNombre, setCsvNombre] = useState('');
  const [mapeo, setMapeo] = useState(null);
  const [defCiudad, setDefCiudad] = useState('');
  const [defProvincia, setDefProvincia] = useState('');
  const [filas, setFilas] = useState([]);
  const [errorEntrada, setErrorEntrada] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [error, setError] = useState(null);
  const [progreso, setProgreso] = useState({ resueltas: 0, total: 0, bloques: 0, enviados: 0 });
  const [cancelando, setCancelando] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  const [manuales, setManuales] = useState({});
  const [enviando, setEnviando] = useState(false);
  const [confirmacion, setConfirmacion] = useState(null);
  const abortRef = useRef(null);
  // Una sola tanda en vuelo: nunca dos lotes en paralelo desde la interfaz.
  const enProcesoRef = useRef(false);

  const analisisCsv = useMemo(
    () => (String(csvTexto || '').trim() ? analizarCSV(csvTexto) : null),
    [csvTexto],
  );

  const lineasTexto = useMemo(
    () => (String(textoPegado || '').trim()
      ? parsearTextoDirecciones(textoPegado, { provincias })
      : []),
    [textoPegado, provincias],
  );

  useEffect(() => {
    if (!analisisCsv) {
      setMapeo(null);
      return;
    }
    setMapeo(analisisCsv.mapeo);
  }, [analisisCsv]);

  useEffect(() => {
    if (!abierto) return undefined;
    const alTeclear = (evento) => {
      if (evento.key !== 'Escape') return;
      if (enProcesoRef.current) {
        setCancelando(true);
        abortRef.current?.abort();
      } else {
        onCerrar();
      }
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [abierto, onCerrar]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const duplicados = useMemo(
    () => (paso === PASOS.RESULTADOS ? detectarDuplicados(filas, elementos) : new Map()),
    [paso, filas, elementos],
  );

  const seleccionables = useMemo(
    () => (paso === PASOS.RESULTADOS ? seleccionadasParaAgregar(filas, duplicados) : []),
    [paso, filas, duplicados],
  );

  const conteoEstados = useMemo(() => contarPorEstado(filas), [filas]);
  const resueltas = contarResueltas(filas);
  const pendientes = pendientesDeGeocodificar(filas);

  function reiniciar() {
    setPaso(PASOS.ENTRADA);
    setModo('texto');
    setTextoPegado('');
    setCsvTexto('');
    setCsvNombre('');
    setMapeo(null);
    setDefCiudad('');
    setDefProvincia('');
    setFilas([]);
    setErrorEntrada(null);
    setAviso(null);
    setError(null);
    setProgreso({ resueltas: 0, total: 0, bloques: 0, enviados: 0 });
    setCancelando(false);
    setEditandoId(null);
    setManuales({});
    setConfirmacion(null);
    setEnviando(false);
  }

  function cerrar() {
    // No desmontar el diálogo antes de que el lote actual termine de aplicar
    // su respuesta/AbortError y actualice el estado visible de las filas.
    if (enProcesoRef.current) {
      setCancelando(true);
      abortRef.current?.abort();
      return;
    }
    if (filas.length === 0) reiniciar();
    onCerrar();
  }

  /* ---------------- entrada ---------------- */

  async function seleccionarArchivo(evento) {
    const archivo = evento.target.files?.[0];
    if (!archivo) return;
    setErrorEntrada(null);
    setConfirmacion(null);
    try {
      const texto = await leerArchivoComoTexto(archivo);
      setCsvTexto(texto);
      setCsvNombre(archivo.name || 'CSV');
      setModo('csv');
    } catch {
      setErrorEntrada('No se pudo leer el archivo. Probá de nuevo o pegá el CSV como texto.');
    }
  }

  function cambiarMapeo(campo, indice) {
    setMapeo((prev) => ({ ...(prev || {}), [campo]: Number(indice) }));
  }

  function irARevision() {
    setErrorEntrada(null);
    setAviso(null);
    setConfirmacion(null);

    let datos = [];
    if (modo === 'texto') {
      datos = parsearTextoDirecciones(textoPegado, { provincias });
      if (datos.length === 0) {
        setErrorEntrada('No encontramos direcciones para importar. Pegá una dirección por línea.');
        return;
      }
    } else {
      if (!analisisCsv) {
        setErrorEntrada('Subí un archivo CSV o pegá su contenido.');
        return;
      }
      const mapeoUsado = mapeo || analisisCsv.mapeo;
      if (!mapeoUsado || mapeoUsado.calle === undefined || mapeoUsado.calle < 0) {
        setErrorEntrada('Asigná al menos la columna de calle.');
        return;
      }
      const conDatos = (datosCrudosDeCSV(analisisCsv, mapeoUsado) || []).filter(
        (dato) => CAMPOS_EDITABLES.some((campo) => String(dato[campo] || '').trim()),
      );
      datos = conDatos;
      if (datos.length === 0) {
        setErrorEntrada('El CSV no tiene filas con datos.');
        return;
      }
    }

    if (datos.length > MAX_FILAS_IMPORTACION) {
      setErrorEntrada(`El máximo es ${MAX_FILAS_IMPORTACION} filas por importación y encontramos ${datos.length}.`);
      return;
    }

    const nuevas = crearFilasDesdeDatos(datos, {
      ciudadDefecto: defCiudad,
      provinciaDefecto: defProvincia,
    });
    setFilas(nuevas);
    setPaso(PASOS.REVISION);
  }

  /* ---------------- filas ---------------- */

  function actualizarFila(id, campo, valor) {
    setFilas((prev) => prev.map((fila) => {
      if (fila.id !== id) return fila;
      const siguiente = { ...fila, [campo]: valor };
      const errores = { ...fila.errores };
      delete errores[campo];
      siguiente.errores = errores;
      // Editar una fila ya resuelta invalida su resultado anterior.
      if (fila.estado !== 'pendiente' && fila.estado !== 'cancelada') {
        siguiente.estado = 'pendiente';
        siguiente.candidatos = [];
        siguiente.candidatoElegido = null;
        siguiente.coordsManuales = null;
        siguiente.mensaje = null;
        siguiente.seleccionada = false;
      }
      return siguiente;
    }));
  }

  function quitarFila(id) {
    setFilas((prev) => prev.filter((fila) => fila.id !== id));
  }

  function validarTodas() {
    const { valido, erroresPorId, invalidas } = validarFilas(filas, { provincias });
    setFilas((prev) => prev.map((fila) => (
      erroresPorId[fila.id] ? { ...fila, errores: erroresPorId[fila.id] } : fila
    )));
    if (!valido) {
      setError(`Revisá ${invalidas === 1 ? 'la fila marcada' : `las ${invalidas} filas marcadas`} antes de geocodificar.`);
      return false;
    }
    setError(null);
    return true;
  }

  function aplicarDefectos() {
    setFilas((prev) => prev.map((fila) => {
      const completos = completarConDefectos(fila, {
        ciudadDefecto: defCiudad,
        provinciaDefecto: defProvincia,
      });
      return { ...fila, ...completos, errores: validarFila({ ...fila, ...completos }, { provincias }) };
    }));
  }

  /* ---------------- proceso ---------------- */

  async function ejecutarProceso(objetivo) {
    if (!Array.isArray(objetivo) || objetivo.length === 0) return;
    if (enProcesoRef.current) return;
    enProcesoRef.current = true;
    const control = new AbortController();
    abortRef.current = control;
    setPaso(PASOS.PROCESO);
    setError(null);
    setAviso(null);
    setCancelando(false);
    setConfirmacion(null);
    setEditandoId(null);

    const bloques = Math.ceil(objetivo.length / MAX_FILAS_BLOQUE);
    setProgreso({ resueltas: 0, total: objetivo.length, bloques, enviados: 0 });

    const resultado = await ejecutarLote({
      filas: objetivo,
      tamano: MAX_FILAS_BLOQUE,
      control,
      debeCancelar: () => control.signal.aborted,
      enviarBloque: (bloque) => api.geocodificarLote(bloque.map(aSolicitud), { signal: control.signal }),
      alEnviar: (ids) => {
        setFilas((prev) => marcarBuscando(prev, ids));
        setProgreso((p) => ({ ...p, enviados: p.enviados + 1 }));
      },
      alResolver: (resultados, bloque) => {
        const completos = bloque.map((fila, indice) => {
          const crudo = resultados?.[indice];
          const conId = crudo && typeof crudo.id === 'string' && crudo.id ? crudo : { ...(crudo || {}), id: fila.id };
          return conId;
        });
        setFilas((prev) => aplicarResultados(prev, completos));
        setProgreso((p) => ({ ...p, resueltas: p.resueltas + bloque.length }));
      },
      alFallar: (ids, err) => {
        setFilas((prev) => marcarError(prev, ids, err));
        setProgreso((p) => ({ ...p, resueltas: p.resueltas + ids.length }));
      },
    });

    abortRef.current = null;
    enProcesoRef.current = false;
    setCancelando(false);

    if (resultado.cancelado) {
      setFilas((prev) => marcarCanceladas(prev));
      setAviso('Cancelaste la importación. Se conservaron las filas ya resueltas; el resto quedó en Pendiente/Cancelada.');
    } else if (resultado.detenido) {
      setFilas((prev) => marcarCanceladas(prev));
      setAviso('Se detuvo el proceso por un problema de conexión. Reintentá las filas pendientes.');
    }
    setPaso(PASOS.RESULTADOS);
  }

  function iniciarProceso() {
    if (!validarTodas()) return;
    const objetivo = filas
      .filter((fila) => !fila.descartada && fila.estado === 'pendiente')
      .map((fila) => ({ ...fila }));
    ejecutarProceso(objetivo);
  }

  function cancelarProceso() {
    setCancelando(true);
    abortRef.current?.abort();
  }

  function reintentarTodo() {
    const objetivo = pendientesDeGeocodificar(filas).map((fila) => ({
      ...fila,
      estado: 'pendiente',
      mensaje: null,
      errores: {},
    }));
    if (objetivo.length === 0) return;
    ejecutarProceso(objetivo);
  }

  function reintentarFila(id) {
    const fila = filas.find((f) => f.id === id);
    if (!fila) return;
    const errores = validarFila(fila, { provincias });
    if (Object.keys(errores).length > 0) {
      setFilas((prev) => prev.map((f) => (f.id === id ? { ...f, errores } : f)));
      setError('Completá los datos de la fila antes de reintentar.');
      return;
    }
    ejecutarProceso([{ ...fila, estado: 'pendiente', mensaje: null, errores: {} }]);
  }

  /* ---------------- selección / resultados ---------------- */

  function alternarSeleccion(id) {
    const duplicado = duplicados.get(id);
    setFilas((prev) => prev.map((fila) => {
      if (fila.id !== id) return fila;
      // Un duplicado arranca fuera de la selección: incluirlo es explícito.
      const marcada = fila.seleccionada && (!duplicado || fila.incluirDuplicado);
      return marcada
        ? { ...fila, seleccionada: false, incluirDuplicado: false }
        : { ...fila, seleccionada: true, incluirDuplicado: Boolean(duplicado) };
    }));
  }

  function elegirCandidato(id, indice) {
    setFilas((prev) => prev.map((fila) => (
      fila.id === id
        ? { ...fila, candidatoElegido: indice, coordsManuales: null, seleccionada: true }
        : fila
    )));
  }

  function alternarDescarte(id) {
    setFilas((prev) => prev.map((fila) => (
      fila.id === id
        ? { ...fila, descartada: !fila.descartada, seleccionada: fila.descartada ? fila.seleccionada : false }
        : fila
    )));
  }

  function actualizarManual(id, campo, valor) {
    setManuales((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || { lat: '', lng: '', error: null, abierto: false }), [campo]: valor, error: null },
    }));
  }

  function abrirManual(id) {
    setManuales((prev) => ({
      ...prev,
      [id]: { lat: '', lng: '', error: null, abierto: !(prev[id]?.abierto) },
    }));
  }

  function aplicarManual(id) {
    const estado = manuales[id] || {};
    const lat = parsearCoordenada(estado.lat);
    const lng = parsearCoordenada(estado.lng);
    if (lat === null || lng === null) {
      setManuales((prev) => ({ ...prev, [id]: { ...estado, error: 'Ingresá latitud y longitud numéricas.' } }));
      return;
    }
    if (!enRangoArgentina(lat, lng)) {
      setManuales((prev) => ({ ...prev, [id]: { ...estado, error: 'Las coordenadas deben estar dentro de Argentina.' } }));
      return;
    }
    setFilas((prev) => prev.map((fila) => (
      fila.id === id
        ? {
          ...fila,
          estado: 'encontrada',
          candidatos: [],
          candidatoElegido: null,
          coordsManuales: { lat, lng },
          mensaje: 'Coordenadas ingresadas manualmente.',
          seleccionada: true,
          errores: {},
        }
        : fila
    )));
    setManuales((prev) => ({ ...prev, [id]: { lat: '', lng: '', error: null, abierto: false } }));
  }

  function confirmarAgregado() {
    if (enviando) return;
    const lista = seleccionadasParaAgregar(filas, duplicados);
    if (lista.length === 0) return;
    const items = lista.map(itemParaAgregar).filter(Boolean);
    if (items.length === 0) return;

    setEnviando(true);
    const resultado = onAgregar(items) || { agregados: 0, noAgregados: 0 };
    const ids = new Set(lista.map((fila) => fila.id));
    setFilas((prev) => prev.filter((fila) => !ids.has(fila.id)));
    setConfirmacion(resultado);
    setError(resultado.noAgregados > 0
      ? `Se agregaron ${resultado.agregados} de ${items.length}. El límite es ${MAX_ELEMENTOS} huellas.`
      : null);
    setEnviando(false);
  }

  /* ---------------- render por paso ---------------- */

  function renderEntrada() {
    const cantidadCsv = analisisCsv?.filas?.length || 0;
    const columnas = analisisCsv?.encabezados || [];
    return (
      <div className="importador-cuerpo">
        <div className="segmented" role="tablist" aria-label="Origen de la importación">
          <button
            type="button"
            role="tab"
            aria-selected={modo === 'texto'}
            className={modo === 'texto' ? 'is-active' : ''}
            onClick={() => setModo('texto')}
          >
            Pegar texto
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={modo === 'csv'}
            className={modo === 'csv' ? 'is-active' : ''}
            onClick={() => setModo('csv')}
          >
            Subir CSV
          </button>
        </div>

        {modo === 'texto' && (
          <div role="tabpanel" aria-label="Pegar texto">
            <div className="importador-campo">
              <label className="field-label" htmlFor="importarTexto">Una dirección por línea</label>
              <textarea
                id="importarTexto"
                className="form-control importador-textarea"
                rows={6}
                value={textoPegado}
                onChange={(e) => { setTextoPegado(e.target.value); setErrorEntrada(null); }}
                placeholder={'Perú 781, Santiago del Estero\nAv. Libertad 640, Santiago del Estero\nnombre: Casa de Ana | Perú 781, Santiago del Estero'}
              />
              <p className="importador-ayuda">
                Detectamos calle, altura, ciudad y provincia por separado. Si falta algún dato, corregilo en la revisión:
                no inventamos la provincia. Podés anteponer el nombre como <code>[Casa]</code> o <code>nombre: Casa |</code>.
              </p>
            </div>
            <p className="importador-contador" aria-live="polite">
              {lineasTexto.length} {lineasTexto.length === 1 ? 'dirección detectada' : 'direcciones detectadas'}
            </p>
          </div>
        )}

        {modo === 'csv' && (
          <div role="tabpanel" aria-label="Subir CSV">
            <div className="importador-campo">
              <label className="field-label" htmlFor="importarArchivo">Archivo CSV</label>
              <input
                id="importarArchivo"
                type="file"
                className="form-control importador-archivo"
                accept=".csv,text/csv,text/plain"
                onChange={seleccionarArchivo}
              />
              <p className="importador-ayuda">
                UTF-8 con o sin BOM, coma o punto y coma, campos entre comillas y saltos CRLF/LF.
                {csvNombre ? ` Archivo: ${csvNombre}.` : ''}
              </p>
            </div>

            <div className="importador-campo">
              <label className="field-label" htmlFor="importarCsvTexto">O pegá el CSV</label>
              <textarea
                id="importarCsvTexto"
                className="form-control importador-textarea"
                rows={4}
                value={csvTexto}
                onChange={(e) => { setCsvTexto(e.target.value); setCsvNombre(''); setErrorEntrada(null); }}
                placeholder={'nombre,calle,altura,ciudad,provincia\nCasa,Perú,781,Santiago del Estero,Santiago del Estero'}
              />
            </div>

            {analisisCsv && (
              <section className="importador-mapeo" aria-label="Mapeo de columnas">
                <div className="importador-mapeo-head">
                  <h3>Columnas</h3>
                  <span className="count-chip">{cantidadCsv}</span>
                </div>
                <p className="importador-ayuda">
                  {analisisCsv.tieneEncabezado
                    ? 'Detectamos encabezados. Podés corregir el mapeo.'
                    : 'El CSV no trae encabezados reconocibles: asigná las columnas.'}
                  {' '}Delimitador: {analisisCsv.delimitador === ';' ? 'punto y coma' : 'coma'}.
                  {analisisCsv.comillasSinCerrar ? ' Atención: hay comillas sin cerrar.' : ''}
                </p>
                <div className="importador-mapeo-grid">
                  {CAMPOS_EDITABLES.map((campo) => (
                    <div className="importador-mapeo-campo" key={campo}>
                      <label className="field-label" htmlFor={`mapeo-${campo}`}>{ETIQUETAS_CAMPO[campo]}</label>
                      <select
                        id={`mapeo-${campo}`}
                        className="form-select"
                        value={mapeo?.[campo] ?? -1}
                        onChange={(e) => cambiarMapeo(campo, e.target.value)}
                      >
                        <option value={-1}>Sin asignar</option>
                        {columnas.map((encabezado, indice) => (
                          <option key={`${encabezado}-${indice}`} value={indice}>{encabezado}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        <section className="importador-defectos" aria-label="Valores por defecto">
          <h3>Valores por defecto</h3>
          <p className="importador-ayuda">
            Se aplican solo a filas que llegan sin ciudad o provincia. Son explícitos: si no los elegís, la fila queda incompleta.
          </p>
          <div className="field-row">
            <Campo
              id="importarDefCiudad"
              etiqueta="Ciudad por defecto"
              valor={defCiudad}
              onChange={setDefCiudad}
              provincias={provincias}
              maxLength={80}
            />
            <Campo
              id="importarDefProvincia"
              etiqueta="Provincia por defecto"
              valor={defProvincia}
              onChange={setDefProvincia}
              provincias={provincias}
              tipo="provincia"
            />
          </div>
        </section>

        {errorEntrada && (
          <div className="notice notice-error" role="alert">
            <span>{errorEntrada}</span>
            <button type="button" className="notice-close" aria-label="Cerrar aviso" onClick={() => setErrorEntrada(null)}>×</button>
          </div>
        )}

        <div className="importador-pie">
          <span className="importador-limite">Máximo {MAX_FILAS_IMPORTACION} filas</span>
          <button type="button" className="btn btn-primary" onClick={irARevision}>
            Revisar direcciones
          </button>
        </div>
      </div>
    );
  }

  function renderCamposEdicion(fila, indice) {
    return (
      <div className="importador-edicion">
        <Campo
          id={`${fila.id}-calle`}
          etiqueta="Calle"
          valor={fila.calle}
          onChange={(v) => actualizarFila(fila.id, 'calle', v)}
          error={fila.errores?.calle}
          provincias={provincias}
          maxLength={120}
          placeholder={`Calle de la fila ${indice + 1}`}
        />
        <Campo
          id={`${fila.id}-altura`}
          etiqueta="Altura"
          valor={fila.altura}
          onChange={(v) => actualizarFila(fila.id, 'altura', v)}
          error={fila.errores?.altura}
          provincias={provincias}
          inputMode="numeric"
          maxLength={6}
        />
        <Campo
          id={`${fila.id}-ciudad`}
          etiqueta="Ciudad"
          valor={fila.ciudad}
          onChange={(v) => actualizarFila(fila.id, 'ciudad', v)}
          error={fila.errores?.ciudad}
          provincias={provincias}
          maxLength={80}
        />
        <Campo
          id={`${fila.id}-provincia`}
          etiqueta="Provincia"
          valor={fila.provincia}
          onChange={(v) => actualizarFila(fila.id, 'provincia', v)}
          error={fila.errores?.provincia}
          provincias={provincias}
          tipo="provincia"
        />
        <Campo
          id={`${fila.id}-nombre`}
          etiqueta="Nombre (opcional)"
          valor={fila.nombre}
          onChange={(v) => actualizarFila(fila.id, 'nombre', v)}
          error={fila.errores?.nombre}
          provincias={provincias}
          maxLength={80}
        />
      </div>
    );
  }

  function renderFilaResumen(fila) {
    const partes = [fila.calle && `${fila.calle} ${fila.altura}`.trim(), fila.ciudad, fila.provincia]
      .filter((parte) => parte && String(parte).trim());
    return partes.join(' · ') || 'Sin datos';
  }

  function renderRevision() {
    const invalidas = filas.filter((fila) => Object.keys(validarFila(fila, { provincias })).length > 0).length;
    return (
      <div className="importador-cuerpo">
        <div className="importador-resumen" aria-live="polite">
          <span><b>{filas.length}</b> filas</span>
          <span className={invalidas > 0 ? 'importador-alerta' : ''}>
            {invalidas > 0 ? `${invalidas} con datos faltantes` : 'Todas listas'}
          </span>
        </div>

        <div className="importador-lista">
          {filas.map((fila, indice) => (
            <div className={`importador-fila ${fila.errores && Object.keys(fila.errores).length ? 'is-invalid' : ''}`} key={fila.id}>
              <div className="importador-fila-head">
                <span className="importador-num" aria-hidden="true">{indice + 1}</span>
                <span className="importador-fila-titulo">{renderFilaResumen(fila)}</span>
                <button
                  type="button"
                  className="icon-delete"
                  onClick={() => quitarFila(fila.id)}
                  aria-label={`Quitar fila ${indice + 1}`}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              {renderCamposEdicion(fila, indice)}
            </div>
          ))}
        </div>

        {error && (
          <div className="notice notice-error" role="alert">
            <span>{error}</span>
            <button type="button" className="notice-close" aria-label="Cerrar aviso" onClick={() => setError(null)}>×</button>
          </div>
        )}

        <div className="importador-pie importador-pie--stack">
          <div className="importador-pie-acciones">
            <button type="button" className="btn btn-soft" onClick={() => setPaso(PASOS.ENTRADA)}>
              Volver
            </button>
            <button
              type="button"
              className="btn btn-soft"
              onClick={aplicarDefectos}
              disabled={!defCiudad && !defProvincia}
            >
              Aplicar valores por defecto
            </button>
          </div>
          <button type="button" className="btn btn-primary w-100" onClick={iniciarProceso}>
            Geocodificar {filas.length} {filas.length === 1 ? 'dirección' : 'direcciones'}
          </button>
          <p className="importador-ayuda">
            Se consultan bloques de hasta {MAX_FILAS_BLOQUE} filas, uno por vez. Podés cancelar entre bloques.
          </p>
        </div>
      </div>
    );
  }

  function renderProceso() {
    const porcentaje = progreso.total > 0 ? Math.round((progreso.resueltas / progreso.total) * 100) : 0;
    return (
      <div className="importador-cuerpo">
        <div className="importador-progreso" aria-live="polite">
          <div className="importador-progreso-head">
            <strong>{progreso.resueltas} / {progreso.total}</strong>
            <span>bloque {Math.min(progreso.enviados, progreso.bloques)} de {progreso.bloques}</span>
          </div>
          <div
            className="importador-barra"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progreso.total}
            aria-valuenow={progreso.resueltas}
            aria-label="Progreso de la geocodificación"
          >
            <span style={{ width: `${porcentaje}%` }} />
          </div>
          <p className="importador-ayuda">Consultando bloques secuenciales de hasta {MAX_FILAS_BLOQUE} direcciones.</p>
        </div>

        <div className="importador-lista importador-lista--compacta">
          {filas.map((fila, indice) => (
            <div className="importador-fila importador-fila--compacta" key={fila.id}>
              <span className="importador-num" aria-hidden="true">{indice + 1}</span>
              <span className="importador-fila-titulo">{renderFilaResumen(fila)}</span>
              <span className={`importador-estado estado-${fila.estado}`}>{ETIQUETAS_ESTADO[fila.estado] || fila.estado}</span>
            </div>
          ))}
        </div>

        <div className="importador-pie">
          <span className="importador-limite">{resueltas} resueltas de {filas.length}</span>
          <button type="button" className="btn btn-quiet-danger" onClick={cancelarProceso} disabled={cancelando}>
            {cancelando ? 'Cancelando…' : 'Cancelar'}
          </button>
        </div>
      </div>
    );
  }

  function renderCandidatos(fila) {
    if (!fila.candidatos || fila.candidatos.length === 0) return null;
    return (
      <div className="importador-candidatos" role="group" aria-label={`Candidatos para ${renderFilaResumen(fila)}`}>
        {fila.candidatos.map((candidato, indice) => (
          <label
            key={`${candidato.lat}-${candidato.lng}-${indice}`}
            className={`importador-candidato ${fila.candidatoElegido === indice ? 'is-selected' : ''}`}
          >
            <input
              type="radio"
              name={`candidato-${fila.id}`}
              checked={fila.candidatoElegido === indice}
              onChange={() => elegirCandidato(fila.id, indice)}
            />
            <span className="importador-candidato-texto">
              <span className="importador-candidato-dir">{candidato.direccion || 'Sin dirección'}</span>
              <span className="importador-candidato-meta">
                {candidato.lat.toFixed(6)}, {candidato.lng.toFixed(6)}
                {candidato.proveedor ? ` · ${candidato.proveedor}` : ''}
              </span>
              {candidato.aproximada && <span className="near-badge">Aproximada</span>}
            </span>
          </label>
        ))}
      </div>
    );
  }

  function renderResultados() {
    const paraAgregar = seleccionables.length;
    const lugar = Math.max(0, MAX_ELEMENTOS - elementos.length);
    const manual = manuales;
    return (
      <div className="importador-cuerpo">
        {aviso && (
          <div className="notice notice-info" role="status">
            <span>{aviso}</span>
            <button type="button" className="notice-close" aria-label="Cerrar aviso" onClick={() => setAviso(null)}>×</button>
          </div>
        )}
        {error && (
          <div className="notice notice-error" role="alert">
            <span>{error}</span>
            <button type="button" className="notice-close" aria-label="Cerrar aviso" onClick={() => setError(null)}>×</button>
          </div>
        )}
        {confirmacion && (
          <div className="notice notice-info" role="status">
            <span>
              Se agregaron {confirmacion.agregados} {confirmacion.agregados === 1 ? 'huella' : 'huellas'} al mapa.
              {confirmacion.noAgregados > 0 ? ` No entraron ${confirmacion.noAgregados}: el límite es ${MAX_ELEMENTOS}.` : ''}
            </span>
          </div>
        )}

        <div className="importador-resumen" aria-live="polite">
          <span><b>{filas.length}</b> filas</span>
          <span><b>{resueltas}</b> resueltas</span>
          <span><b>{paraAgregar}</b> seleccionadas</span>
        </div>

        <div className="importador-chips">
          {Object.entries(conteoEstados).map(([estado, cantidad]) => (
            <span key={estado} className={`importador-chip estado-${estado}`}>
              {ETIQUETAS_ESTADO[estado] || estado}: {cantidad}
            </span>
          ))}
        </div>

        {pendientes.length > 0 && (
          <button type="button" className="btn btn-soft w-100 mb-2" onClick={reintentarTodo}>
            Reintentar pendientes ({pendientes.length})
          </button>
        )}

        <div className="importador-lista">
          {filas.map((fila, indice) => {
            const duplicado = duplicados.get(fila.id);
            const coords = coordenadasDeFila(fila);
            const puedeSeleccionar = Boolean(coords) && fila.estado !== 'descartada';
            const editando = editandoId === fila.id;
            return (
              <div
                className={`importador-fila ${duplicado ? 'is-duplicado' : ''} ${fila.descartada ? 'is-descartada' : ''}`}
                key={fila.id}
              >
                <div className="importador-fila-head">
                  <span className="importador-num" aria-hidden="true">{indice + 1}</span>
                  <span className={`importador-estado estado-${fila.estado}`}>
                    {fila.descartada ? ETIQUETAS_ESTADO.descartada : (ETIQUETAS_ESTADO[fila.estado] || fila.estado)}
                  </span>
                  <span className="importador-fila-titulo">{renderFilaResumen(fila)}</span>
                </div>

                {fila.mensaje && <p className="importador-mensaje">{fila.mensaje}</p>}

                {duplicado && !fila.descartada && (
                  <p className="importador-duplicado" role="status">
                    Duplicado: {MARCA_DUPLICADO[duplicado.motivo] || 'coincide con'} «{duplicado.contra}».
                  </p>
                )}

                {editando && renderCamposEdicion(fila, indice)}

                {renderCandidatos(fila)}

                {manual[fila.id]?.abierto && (
                  <div className="importador-manual">
                    <Campo
                      id={`${fila.id}-lat`}
                      etiqueta="Latitud"
                      valor={manual[fila.id]?.lat || ''}
                      onChange={(v) => actualizarManual(fila.id, 'lat', v)}
                      provincias={provincias}
                      placeholder="-27,7951"
                    />
                    <Campo
                      id={`${fila.id}-lng`}
                      etiqueta="Longitud"
                      valor={manual[fila.id]?.lng || ''}
                      onChange={(v) => actualizarManual(fila.id, 'lng', v)}
                      provincias={provincias}
                      placeholder="-64,2615"
                    />
                    <button type="button" className="btn btn-soft btn-sm" onClick={() => aplicarManual(fila.id)}>
                      Usar coordenadas
                    </button>
                    {manual[fila.id]?.error && (
                      <span className="field-error" role="alert">{manual[fila.id].error}</span>
                    )}
                  </div>
                )}

                <div className="importador-fila-acciones">
                  <label className={`importador-seleccion ${!puedeSeleccionar ? 'is-disabled' : ''}`}>
                    <input
                      type="checkbox"
                      checked={Boolean(fila.seleccionada) && puedeSeleccionar && (!duplicado || fila.incluirDuplicado)}
                      onChange={() => alternarSeleccion(fila.id)}
                      disabled={!puedeSeleccionar}
                      aria-label={`Agregar la fila ${indice + 1} al mapa`}
                    />
                    <span>{duplicado ? 'Agregar igual' : 'Agregar'}</span>
                  </label>
                  <button
                    type="button"
                    className="btn btn-soft btn-xs"
                    onClick={() => setEditandoId(editando ? null : fila.id)}
                    aria-expanded={editando}
                  >
                    {editando ? 'Listo' : 'Editar'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-soft btn-xs"
                    onClick={() => reintentarFila(fila.id)}
                    disabled={fila.estado === 'buscando' || (enProcesoRef.current && !pendientes.some((pendiente) => pendiente.id === fila.id))}
                  >
                    Reintentar
                  </button>
                  <button type="button" className="btn btn-soft btn-xs" onClick={() => abrirManual(fila.id)}>
                    Coordenadas
                  </button>
                  <button type="button" className="btn btn-soft btn-xs" onClick={() => alternarDescarte(fila.id)}>
                    {fila.descartada ? 'Restaurar' : 'Descartar'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="importador-pie importador-pie--stack">
          {lugar < paraAgregar && (
            <p className="importador-ayuda importador-alerta">
              Solo caben {lugar} huellas más (límite {MAX_ELEMENTOS}). Destildá algunas filas.
            </p>
          )}
          <button
            type="button"
            className="btn btn-primary w-100"
            onClick={confirmarAgregado}
            disabled={paraAgregar === 0 || enviando}
          >
            Agregar {paraAgregar} {paraAgregar === 1 ? 'huella' : 'huellas'} al mapa
          </button>
          <div className="importador-pie-acciones">
            <button type="button" className="btn btn-soft" onClick={reiniciar}>
              Nueva importación
            </button>
            <button type="button" className="btn btn-soft" onClick={cerrar}>
              Cerrar
            </button>
          </div>
          <p className="importador-ayuda">
            Nada se guarda hasta confirmar. Las filas agregadas se quitan de esta lista para evitar duplicados.
          </p>
        </div>
      </div>
    );
  }

  if (!abierto) return null;

  return (
    <section className="importador" role="dialog" aria-modal="false" aria-labelledby="importador-titulo" aria-describedby="importador-descripcion">
      <header className="importador-head">
        <div>
          <span className="eyebrow" id="importador-descripcion">Importación masiva, máximo {MAX_FILAS_IMPORTACION} direcciones</span>
          <h2 id="importador-titulo">Importar direcciones</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={cerrar}
          aria-label="Cerrar importación"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      {paso === PASOS.ENTRADA && renderEntrada()}
      {paso === PASOS.REVISION && renderRevision()}
      {paso === PASOS.PROCESO && renderProceso()}
      {paso === PASOS.RESULTADOS && renderResultados()}
    </section>
  );
}
