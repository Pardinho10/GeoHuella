import React, { Suspense, useEffect, useState } from 'react';
import { cargarElementos, guardarElementos, cargarContador, guardarContador, colorSeguro } from './lib/storage.js';
import { agregarCandidatos, parsearCoordenada, parsearParPegado, enRangoArgentina, normalizarTexto } from './lib/elementos.js';
import { obtenerProvincias, geocodificar, ubicarCoordenadas, calcularRuta, buscarLugaresCercanos } from './api';
import IconHuella from './components/IconHuella.jsx';
import { MAX_PUNTOS_RUTA, PERFILES_RUTA, etiquetaPerfil, formatearDistancia, formatearDuracion } from './lib/ruta.js';

const Mapa = React.lazy(() => import('./components/Mapa.jsx'));

const MAX_SUGERENCIAS = 5;

function IconChevron({ open }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={open ? 'chevron is-open' : 'chevron'}>
      <path d="m15 6-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FieldError({ children }) {
  if (!children) return null;
  return <span className="field-error" role="alert">{children}</span>;
}

export default function App() {
  const [elementos, setElementos] = useState(() => cargarElementos());
  const [contador, setContador] = useState(() => cargarContador());
  const [provincias, setProvincias] = useState([]);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [cargandoProvincias, setCargandoProvincias] = useState(true);
  const [provinciasIntento, setProvinciasIntento] = useState(0);
  const [panelAbierto, setPanelAbierto] = useState(true);
  const [tabActiva, setTabActiva] = useState('direccion');

  // Dirección
  const [nombreDir, setNombreDir] = useState('');
  const [calle, setCalle] = useState('');
  const [numero, setNumero] = useState('');
  const [ciudad, setCiudad] = useState('');
  const [provincia, setProvincia] = useState('');
  const [erroresCampo, setErroresCampo] = useState({});
  const [candidatos, setCandidatos] = useState([]);
  const [seleccionados, setSeleccionados] = useState(new Set());
  const [sugerencias, setSugerencias] = useState([]);
  const [sugerenciasSeleccionadas, setSugerenciasSeleccionadas] = useState(new Set());
  const [buscando, setBuscando] = useState(false);

  // Coordenadas
  const [nombreCoord, setNombreCoord] = useState('');
  const [latTexto, setLatTexto] = useState('');
  const [lngTexto, setLngTexto] = useState('');
  const [parPegado, setParPegado] = useState('');
  const [erroresCoord, setErroresCoord] = useState({});
  const [guardandoCoord, setGuardandoCoord] = useState(false);

  const [foco, setFoco] = useState(null);
  const [fitAll, setFitAll] = useState(0);
  const [popup, setPopup] = useState(null);

  // Ruta
  const [modoRuta, setModoRuta] = useState(false);
  const [seleccionRuta, setSeleccionRuta] = useState(new Set());
  const [perfilRuta, setPerfilRuta] = useState('walking');
  const [volverInicio, setVolverInicio] = useState(false);
  const [optimizarRuta, setOptimizarRuta] = useState(false);
  const [inicioRutaId, setInicioRutaId] = useState(null);
  const [finRutaId, setFinRutaId] = useState(null);
  const [ruta, setRuta] = useState(null);
  const [calculandoRuta, setCalculandoRuta] = useState(false);
  const [errorRuta, setErrorRuta] = useState(null);
  const [fitRuta, setFitRuta] = useState(0);

  // Lugares cercanos a una huella.
  const [alrededorId, setAlrededorId] = useState(null);
  const [lugaresAlrededor, setLugaresAlrededor] = useState([]);
  const [cargandoLugares, setCargandoLugares] = useState(false);
  const [errorLugares, setErrorLugares] = useState(null);

  // Edición, orden y filtro de la lista.
  const [filtroElementos, setFiltroElementos] = useState('');
  const [editandoId, setEditandoId] = useState(null);
  const [nombreEdit, setNombreEdit] = useState('');
  const [errorEdicion, setErrorEdicion] = useState(null);

  useEffect(() => { guardarElementos(elementos); }, [elementos]);
  useEffect(() => { guardarContador(contador); }, [contador]);

  useEffect(() => {
    setSeleccionRuta((prev) => {
      if (prev.size === 0) return prev;
      const ids = new Set(elementos.map((e) => e.id));
      let cambio = false;
      const next = new Set();
      prev.forEach((id) => {
        if (ids.has(id)) next.add(id);
        else cambio = true;
      });
      return cambio ? next : prev;
    });
  }, [elementos]);

  useEffect(() => {
    if (!ruta) return;
    const ids = new Set(elementos.map((e) => e.id));
    if (ruta.ids.some((id) => !ids.has(id))) {
      setRuta(null);
      setErrorRuta(null);
    }
  }, [elementos, ruta]);

  useEffect(() => {
    if (alrededorId && !elementos.some((el) => el.id === alrededorId)) {
      setAlrededorId(null);
      setLugaresAlrededor([]);
      setErrorLugares(null);
    }
  }, [alrededorId, elementos]);

  useEffect(() => {
    if (editandoId && !elementos.some((el) => el.id === editandoId)) {
      setEditandoId(null);
      setNombreEdit('');
      setErrorEdicion(null);
    }
  }, [editandoId, elementos]);

  useEffect(() => {
    if (seleccionRuta.size === 0) {
      if (inicioRutaId !== null) setInicioRutaId(null);
      return;
    }
    if (!inicioRutaId || !seleccionRuta.has(inicioRutaId)) {
      const primero = elementos.find((el) => seleccionRuta.has(el.id));
      setInicioRutaId(primero?.id || null);
    }
  }, [elementos, inicioRutaId, seleccionRuta]);

  useEffect(() => {
    if (volverInicio) {
      if (finRutaId !== null) setFinRutaId(null);
      return;
    }
    if (finRutaId && (!seleccionRuta.has(finRutaId) || finRutaId === inicioRutaId)) {
      setFinRutaId(null);
    }
  }, [finRutaId, inicioRutaId, seleccionRuta, volverInicio]);

  useEffect(() => {
    let activo = true;
    setCargandoProvincias(true);
    setError(null);
    obtenerProvincias()
      .then((ps) => {
        if (!activo) return;
        setProvincias(ps);
        if (ps.length === 0) setError('No se pudieron cargar las provincias.');
      })
      .catch((e) => {
        if (activo) setError(e?.message || 'No se pudo conectar con el servidor');
      })
      .finally(() => { if (activo) setCargandoProvincias(false); });
    return () => { activo = false; };
  }, [provinciasIntento]);

  function mostrarError(e) {
    setError(e?.message || 'No se pudo conectar con el servidor');
  }

  function limpiarErrorCampo(campo) {
    setErroresCampo((prev) => (prev[campo] ? { ...prev, [campo]: undefined } : prev));
  }

  function limpiarErrorCoord(campo) {
    setErroresCoord((prev) => (prev[campo] ? { ...prev, [campo]: undefined } : prev));
  }

  function validarDireccion() {
    const next = {};
    const calleTrim = calle.trim();
    const numeroTrim = numero.trim();
    const ciudadTrim = ciudad.trim();

    if (!calleTrim) next.calle = 'Ingresá la calle.';
    else if (calleTrim.length > 120) next.calle = 'Usá hasta 120 caracteres.';

    if (!numeroTrim) next.numero = 'Ingresá la altura.';
    else if (!/^\d+$/.test(numeroTrim)) next.numero = 'La altura debe contener solo números.';
    else if (numeroTrim.length > 6) next.numero = 'Usá hasta 6 dígitos.';

    if (!ciudadTrim) next.ciudad = 'Ingresá la ciudad.';
    else if (ciudadTrim.length > 80) next.ciudad = 'Usá hasta 80 caracteres.';

    if (!provincia) next.provincia = 'Elegí una provincia.';

    setErroresCampo(next);
    return Object.keys(next).length === 0;
  }

  async function buscarDireccion(event) {
    event.preventDefault();
    setError(null);
    setAviso(null);
    setCandidatos([]);
    setSeleccionados(new Set());
    setSugerencias([]);
    setSugerenciasSeleccionadas(new Set());

    if (!validarDireccion()) return;

    setBuscando(true);
    try {
      const res = await geocodificar({
        calle: calle.trim(),
        numero: numero.trim(),
        ciudad: ciudad.trim(),
        provincia,
      });
      setCandidatos(res);
      if (res.length === 0) {
        setAviso('No encontramos coincidencias para esa dirección.');
      } else if (res[0]) {
        setFoco([res[0].lat, res[0].lng]);
      }
    } catch (err) {
      if (err?.codigo === 'no_encontrada') {
        const cercanas = Array.isArray(err.sugerencias) ? err.sugerencias.slice(0, MAX_SUGERENCIAS) : [];
        setSugerencias(cercanas);
        if (cercanas.length > 0) {
          setAviso('No encontramos esa altura exacta. Probá con una ubicación cercana de la misma calle.');
          setFoco([cercanas[0].lat, cercanas[0].lng]);
        } else {
          setError(err.message || 'No se pudo ubicar la dirección. Revisá la calle, el número y la ciudad.');
        }
      } else {
        mostrarError(err);
      }
    } finally {
      setBuscando(false);
    }
  }

  function agregarElementos(elegidos, nombre = nombreDir) {
    const { agregados, noAgregados, elementos: nuevos, contador: nuevoContador } = agregarCandidatos(
      elegidos,
      nombre,
      elementos,
      contador
    );
    setElementos(nuevos);
    setContador(nuevoContador);
    if (noAgregados > 0) {
      setError(`No hay espacio para todos: se agregaron ${agregados.length} de ${elegidos.length}. El límite es 200.`);
    }
    if (agregados.length > 0) setFoco([agregados[0].lat, agregados[0].lng]);
    return agregados.length;
  }

  function toggleSeleccionado(index) {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
    if (candidatos[index]) setFoco([candidatos[index].lat, candidatos[index].lng]);
  }

  function confirmarCandidatos() {
    const elegidos = candidatos.filter((_, i) => seleccionados.has(i));
    if (elegidos.length === 0) return;
    agregarElementos(elegidos.map((c) => ({ ...c, origen: 'direccion' })));
    setCandidatos([]);
    setSeleccionados(new Set());
    setNombreDir('');
    setCalle('');
    setNumero('');
    setCiudad('');
    setErroresCampo({});
  }

  function toggleSugerencia(index) {
    setSugerenciasSeleccionadas((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
    if (sugerencias[index]) setFoco([sugerencias[index].lat, sugerencias[index].lng]);
  }

  function confirmarSugerencias() {
    const elegidas = sugerencias.filter((_, i) => sugerenciasSeleccionadas.has(i));
    if (elegidas.length === 0) return;
    agregarElementos(elegidas.map((c) => ({ ...c, origen: 'direccion' })));
    setSugerencias([]);
    setSugerenciasSeleccionadas(new Set());
    setAviso(null);
    setNombreDir('');
    setCalle('');
    setNumero('');
    setCiudad('');
  }

  function aplicarParPegado() {
    const parsed = parsearParPegado(parPegado);
    if (parsed) {
      setLatTexto(String(parsed.lat));
      setLngTexto(String(parsed.lng));
      setErroresCoord({});
      setError(null);
    } else if (parPegado.trim()) {
      setErroresCoord({ parPegado: 'Usá “lat, lng” con punto decimal o “lat; lng” con coma decimal.' });
    }
  }

  async function guardarCoordenada(event) {
    event.preventDefault();
    setError(null);
    setErroresCoord({});
    const lat = parsearCoordenada(latTexto);
    const lng = parsearCoordenada(lngTexto);
    const next = {};

    if (lat === null) next.lat = 'Ingresá una latitud numérica.';
    if (lng === null) next.lng = 'Ingresá una longitud numérica.';
    if (lat !== null && lng !== null && !enRangoArgentina(lat, lng)) {
      next.lat = 'Fuera del área de Argentina.';
      next.lng = 'Fuera del área de Argentina.';
    }
    if (Object.keys(next).length > 0) {
      setErroresCoord(next);
      return;
    }

    setGuardandoCoord(true);
    try {
      const info = await ubicarCoordenadas(lat, lng);
      const direccion = info?.direccion ?? 'Sin dirección disponible';
      agregarElementos([{ lat, lng, direccion, origen: 'coordenadas' }], nombreCoord);
      setNombreCoord('');
      setLatTexto('');
      setLngTexto('');
      setParPegado('');
    } catch (err) {
      mostrarError(err);
    } finally {
      setGuardandoCoord(false);
    }
  }

  function eliminar(id) {
    setElementos((prev) => prev.filter((e) => e.id !== id));
  }

  function quitarTodos() {
    if (window.confirm('¿Quitar todos los elementos?')) setElementos([]);
  }

  function seleccionarElemento(el) {
    setFoco([el.lat, el.lng]);
  }

  async function verAlrededor(el) {
    setAlrededorId(el.id);
    setLugaresAlrededor([]);
    setErrorLugares(null);
    setCargandoLugares(true);
    setFoco([el.lat, el.lng]);
    try {
      const lugares = await buscarLugaresCercanos(el.lat, el.lng, 5);
      setLugaresAlrededor(lugares);
    } catch (err) {
      setErrorLugares(err?.message || 'No se pudieron consultar los lugares cercanos.');
    } finally {
      setCargandoLugares(false);
    }
  }

  function cerrarAlrededor() {
    setAlrededorId(null);
    setLugaresAlrededor([]);
    setErrorLugares(null);
  }

  function empezarEdicion(el) {
    setEditandoId(el.id);
    setNombreEdit(el.nombre);
    setErrorEdicion(null);
  }

  function cancelarEdicion() {
    setEditandoId(null);
    setNombreEdit('');
    setErrorEdicion(null);
  }

  function guardarNombre(event) {
    event.preventDefault();
    const nombre = nombreEdit.trim();
    if (!nombre) {
      setErrorEdicion('El nombre no puede estar vacío.');
      return;
    }
    if (nombre.length > 80) {
      setErrorEdicion('El nombre no puede superar los 80 caracteres.');
      return;
    }
    setElementos((prev) => prev.map((el) => (
      el.id === editandoId ? { ...el, nombre } : el
    )));
    cancelarEdicion();
  }

  function moverElemento(id, delta) {
    setElementos((prev) => {
      const indice = prev.findIndex((el) => el.id === id);
      const destino = indice + delta;
      if (indice < 0 || destino < 0 || destino >= prev.length) return prev;
      const next = [...prev];
      [next[indice], next[destino]] = [next[destino], next[indice]];
      return next;
    });
  }

  function abrirRuta() {
    cancelarEdicion();
    if (ruta) {
      setSeleccionRuta(new Set(ruta.ids));
      setPerfilRuta(ruta.perfil || 'walking');
      setVolverInicio(Boolean(ruta.volverInicio));
      setOptimizarRuta(Boolean(ruta.optimizar));
      setInicioRutaId(ruta.inicioId || ruta.ids[0] || null);
      setFinRutaId(ruta.finId || null);
    } else {
      setSeleccionRuta(new Set());
      setInicioRutaId(null);
      setFinRutaId(null);
    }
    setModoRuta(true);
    setRuta(null);
    setErrorRuta(null);
  }

  function cerrarRuta() {
    setModoRuta(false);
    setErrorRuta(null);
  }

  function toggleRutaElemento(id) {
    setErrorRuta(null);
    setRuta(null);
    setSeleccionRuta((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < MAX_PUNTOS_RUTA) {
        next.add(id);
      }
      return next;
    });
  }

  function cambiarPerfilRuta(perfil) {
    setPerfilRuta(perfil);
    setRuta(null);
    setErrorRuta(null);
  }

  function cambiarVolverInicio() {
    const siguiente = !volverInicio;
    setVolverInicio(siguiente);
    if (siguiente) setFinRutaId(null);
    setRuta(null);
    setErrorRuta(null);
  }

  function cambiarOptimizarRuta() {
    setOptimizarRuta((v) => !v);
    setRuta(null);
    setErrorRuta(null);
  }

  function cambiarInicioRuta(id) {
    setInicioRutaId(id);
    setRuta(null);
    setErrorRuta(null);
  }

  function cambiarFinRuta(id) {
    setFinRutaId(id || null);
    if (id) setVolverInicio(false);
    setRuta(null);
    setErrorRuta(null);
  }

  function limpiarRuta() {
    setRuta(null);
    setErrorRuta(null);
  }

  async function trazarRuta() {
    const elegidos = elementos.filter((el) => seleccionRuta.has(el.id));
    if (elegidos.length < 2) {
      setErrorRuta('Elegí al menos 2 huellas para armar la ruta.');
      return;
    }
    const inicio = elegidos.find((el) => el.id === inicioRutaId) || elegidos[0];
    const fin = elegidos.find((el) => el.id === finRutaId && el.id !== inicio.id) || null;
    const intermedios = elegidos.filter((el) => el.id !== inicio.id && el.id !== fin?.id);
    const ordenados = [inicio, ...intermedios, ...(fin ? [fin] : [])];
    const indiceFin = fin ? ordenados.length - 1 : null;
    setCalculandoRuta(true);
    setErrorRuta(null);
    try {
      const data = await calcularRuta({
        puntos: ordenados.map(({ lat, lng }) => ({ lat, lng })),
        perfil: perfilRuta,
        volver_al_inicio: volverInicio,
        optimizar: optimizarRuta,
        ...(indiceFin === null ? {} : { fin: indiceFin }),
      });
      setRuta({
        ...data,
        ids: ordenados.map((el) => el.id),
        inicioId: inicio.id,
        finId: fin?.id || null,
        perfil: perfilRuta,
        volverInicio,
        optimizar: optimizarRuta,
      });
      setFitRuta((v) => v + 1);
      setModoRuta(false);
    } catch (err) {
      setErrorRuta(err?.message || 'No se pudo calcular la ruta.');
    } finally {
      setCalculandoRuta(false);
    }
  }

  const elegidosRuta = elementos.filter((el) => seleccionRuta.has(el.id));
  const nombreInicio = ruta ? elementos.find((el) => el.id === ruta.inicioId)?.nombre : null;
  const nombreFin = ruta ? elementos.find((el) => el.id === ruta.finId)?.nombre : null;
  const puntoAlrededor = elementos.find((el) => el.id === alrededorId) || null;
  const consultaFiltro = normalizarTexto(filtroElementos);
  const filtroActivo = consultaFiltro.length > 0;
  const elementosVisibles = filtroActivo
    ? elementos.filter((el) => normalizarTexto(`${el.nombre} ${el.direccion || ''}`).includes(consultaFiltro))
    : elementos;

  return (
    <div className={`app-shell ${panelAbierto ? 'panel-abierto' : 'panel-cerrado'}`}>
      <Suspense fallback={<div className="mapa-cargando" role="status">Cargando mapa…</div>}>
        <Mapa
          elementos={elementos}
          candidatos={candidatos}
          sugerencias={sugerencias}
          seleccionados={seleccionados}
          sugerenciasSeleccionadas={sugerenciasSeleccionadas}
          popup={popup}
          setPopup={setPopup}
          foco={foco}
          fitAll={fitAll}
          ruta={ruta}
          fitRuta={fitRuta}
          onToggleSeleccionado={toggleSeleccionado}
          onToggleSugerencia={toggleSugerencia}
          onFoco={setFoco}
        />
      </Suspense>

      <div className="map-vignette" aria-hidden="true" />

      {!panelAbierto && (
        <button
          type="button"
          className="map-toggle"
          onClick={() => setPanelAbierto(true)}
          aria-label="Expandir panel"
          aria-expanded="false"
        >
          <IconHuella size={19} />
        </button>
      )}

      {panelAbierto && (
        <aside className="panel-flotante" aria-label="Panel del mapa">
          <header className="panel-header">
            <div className="brand-row">
              <div className="brand">
                <span className="brand-mark" aria-hidden="true"><IconHuella size={20} /></span>
                <div>
                  <span className="eyebrow">Cada lugar deja una huella</span>
                  <h1>GeoHuella</h1>
                </div>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setPanelAbierto(false)}
                aria-label="Colapsar panel"
                aria-expanded="true"
              >
                <IconChevron open />
              </button>
            </div>
            <p className="panel-subtitle">Encontrá una dirección, compará coincidencias y guardá tus lugares.</p>
            <div className="stats" aria-label="Resumen">
              <span className="stat"><b>{elementos.length}</b> {elementos.length === 1 ? 'punto de 200' : 'puntos de 200'}</span>
              <span className="stat"><b>{contador}</b> {contador === 1 ? 'nombre usado' : 'nombres usados'}</span>
            </div>
          </header>

          <div className="panel-scroll">
            <div className="segmented" role="tablist" aria-label="Tipo de búsqueda">
              <button
                type="button"
                role="tab"
                aria-selected={tabActiva === 'direccion'}
                className={tabActiva === 'direccion' ? 'is-active' : ''}
                onClick={() => setTabActiva('direccion')}
              >
                Dirección
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tabActiva === 'coordenadas'}
                className={tabActiva === 'coordenadas' ? 'is-active' : ''}
                onClick={() => setTabActiva('coordenadas')}
              >
                Coordenadas
              </button>
            </div>

            {error && (
              <div className="notice notice-error" role="alert">
                <span>{error}</span>
                <button type="button" className="notice-close" aria-label="Cerrar aviso" onClick={() => setError(null)}>×</button>
              </div>
            )}
            {aviso && (
              <div className="notice notice-info" role="status">
                <span>{aviso}</span>
                <button type="button" className="notice-close" aria-label="Cerrar aviso" onClick={() => setAviso(null)}>×</button>
              </div>
            )}

            {tabActiva === 'direccion' && (
              <div role="tabpanel" aria-label="Dirección" className="tab-panel">
                <form onSubmit={buscarDireccion} noValidate>
                  <div className="form-field">
                    <label className="field-label" htmlFor="nombreDir">Nombre <span>opcional</span></label>
                    <input
                      id="nombreDir"
                      className="form-control"
                      value={nombreDir}
                      onChange={(e) => setNombreDir(e.target.value)}
                      placeholder="Ej. Casa de Ana"
                      maxLength={80}
                    />
                  </div>

                  <div className="form-field">
                    <label className="field-label" htmlFor="calle">Calle</label>
                    <input
                      id="calle"
                      className={`form-control ${erroresCampo.calle ? 'is-invalid' : ''}`}
                      value={calle}
                      onChange={(e) => { setCalle(e.target.value); limpiarErrorCampo('calle'); }}
                      placeholder="Ej. Avenida Corrientes"
                      maxLength={120}
                      aria-invalid={Boolean(erroresCampo.calle)}
                    />
                    <FieldError>{erroresCampo.calle}</FieldError>
                  </div>

                  <div className="field-row">
                    <div className="form-field">
                      <label className="field-label" htmlFor="numero">Altura</label>
                      <input
                        id="numero"
                        className={`form-control ${erroresCampo.numero ? 'is-invalid' : ''}`}
                        value={numero}
                        onChange={(e) => { setNumero(e.target.value); limpiarErrorCampo('numero'); }}
                        placeholder="1000"
                        inputMode="numeric"
                        maxLength={6}
                        aria-invalid={Boolean(erroresCampo.numero)}
                      />
                      <FieldError>{erroresCampo.numero}</FieldError>
                    </div>
                    <div className="form-field">
                      <label className="field-label" htmlFor="ciudad">Ciudad</label>
                      <input
                        id="ciudad"
                        className={`form-control ${erroresCampo.ciudad ? 'is-invalid' : ''}`}
                        value={ciudad}
                        onChange={(e) => { setCiudad(e.target.value); limpiarErrorCampo('ciudad'); }}
                        placeholder="Ciudad o localidad"
                        maxLength={80}
                        aria-invalid={Boolean(erroresCampo.ciudad)}
                      />
                      <FieldError>{erroresCampo.ciudad}</FieldError>
                    </div>
                  </div>

                  <div className="form-field">
                    <label className="field-label" htmlFor="provincia">Provincia</label>
                    {provincias.length > 0 ? (
                      <select
                        id="provincia"
                        className={`form-select ${erroresCampo.provincia ? 'is-invalid' : ''}`}
                        value={provincia}
                        onChange={(e) => { setProvincia(e.target.value); limpiarErrorCampo('provincia'); }}
                        disabled={cargandoProvincias}
                        aria-invalid={Boolean(erroresCampo.provincia)}
                      >
                        <option value="">Elegir provincia</option>
                        {provincias.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    ) : (
                      <button
                        type="button"
                        id="provincia"
                        className={`form-select provincia-estado text-start ${erroresCampo.provincia ? 'is-invalid' : ''}`}
                        onClick={() => setProvinciasIntento((n) => n + 1)}
                        disabled={cargandoProvincias}
                        aria-busy={cargandoProvincias}
                      >
                        {cargandoProvincias ? 'Cargando provincias…' : 'No se pudieron cargar. Reintentar'}
                      </button>
                    )}
                    <FieldError>{erroresCampo.provincia}</FieldError>
                  </div>

                  <button type="submit" className="btn btn-primary w-100" disabled={buscando}>
                    {buscando ? <span className="loading">Buscando…</span> : 'Buscar'}
                  </button>

                  <p className="source-note">
                    Buscamos en Georef y, si no hay coordenadas, en OpenStreetMap y HERE.
                  </p>
                </form>

                {candidatos.length > 0 && (
                  <section className="results">
                    <div className="section-head">
                      <h2>Coincidencias</h2>
                      <span className="count-chip">{candidatos.length}</span>
                    </div>
                    <div className="result-list">
                      {candidatos.map((c, i) => (
                        <label
                          key={i}
                          className={`result-card ${seleccionados.has(i) ? 'is-selected' : ''}`}
                        >
                          <input
                            type="checkbox"
                            className="result-check"
                            checked={seleccionados.has(i)}
                            onChange={() => toggleSeleccionado(i)}
                          />
                          <span className="result-text">
                            <span className="result-title">{c.direccion}</span>
                            <span className="result-meta">{c.lat.toFixed(6)}, {c.lng.toFixed(6)}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary w-100 mt-2"
                      onClick={confirmarCandidatos}
                      disabled={seleccionados.size === 0}
                    >
                      Agregar seleccionados
                    </button>
                  </section>
                )}

                {sugerencias.length > 0 && (
                  <section className="results results-near">
                    <div className="section-head">
                      <h2>Ubicaciones cercanas</h2>
                      <span className="count-chip count-chip--warm">{sugerencias.length}</span>
                    </div>
                    <p className="section-note">
                      No encontramos esa altura exacta. Estas alternativas están en la misma calle: verificá antes de agregar.
                    </p>
                    <div className="result-list">
                      {sugerencias.map((c, i) => (
                        <label
                          key={i}
                          className={`result-card result-card--near ${sugerenciasSeleccionadas.has(i) ? 'is-selected' : ''}`}
                        >
                          <input
                            type="checkbox"
                            className="result-check"
                            checked={sugerenciasSeleccionadas.has(i)}
                            onChange={() => toggleSugerencia(i)}
                          />
                          <span className="result-text">
                            <span className="near-badge">Cercana</span>
                            <span className="result-title">{c.direccion}</span>
                            <span className="result-meta">{c.lat.toFixed(6)}, {c.lng.toFixed(6)}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="btn btn-accent w-100 mt-2"
                      onClick={confirmarSugerencias}
                      disabled={sugerenciasSeleccionadas.size === 0}
                    >
                      Agregar sugerencias
                    </button>
                  </section>
                )}
              </div>
            )}

            {tabActiva === 'coordenadas' && (
              <div role="tabpanel" aria-label="Coordenadas" className="tab-panel">
                <form onSubmit={guardarCoordenada} noValidate>
                  <div className="form-field">
                    <label className="field-label" htmlFor="nombreCoord">Nombre <span>opcional</span></label>
                    <input
                      id="nombreCoord"
                      className="form-control"
                      value={nombreCoord}
                      onChange={(e) => setNombreCoord(e.target.value)}
                      placeholder="Ej. Punto de encuentro"
                      maxLength={80}
                    />
                  </div>

                  <div className="form-field">
                    <label className="field-label" htmlFor="parPegado">Pegar un par</label>
                    <div className="input-action">
                      <input
                        id="parPegado"
                        className={`form-control ${erroresCoord.parPegado ? 'is-invalid' : ''}`}
                        value={parPegado}
                        onChange={(e) => { setParPegado(e.target.value); limpiarErrorCoord('parPegado'); }}
                        placeholder="-27.7951, -64.2615"
                        aria-invalid={Boolean(erroresCoord.parPegado)}
                      />
                      <button type="button" className="btn btn-soft" onClick={aplicarParPegado}>Pegar</button>
                    </div>
                    <FieldError>{erroresCoord.parPegado}</FieldError>
                  </div>

                  <div className="field-row">
                    <div className="form-field">
                      <label className="field-label" htmlFor="latitud">Latitud</label>
                      <input
                        id="latitud"
                        className={`form-control ${erroresCoord.lat ? 'is-invalid' : ''}`}
                        value={latTexto}
                        onChange={(e) => { setLatTexto(e.target.value); limpiarErrorCoord('lat'); }}
                        placeholder="-27,7951"
                        inputMode="decimal"
                        aria-invalid={Boolean(erroresCoord.lat)}
                      />
                      <FieldError>{erroresCoord.lat}</FieldError>
                    </div>
                    <div className="form-field">
                      <label className="field-label" htmlFor="longitud">Longitud</label>
                      <input
                        id="longitud"
                        className={`form-control ${erroresCoord.lng ? 'is-invalid' : ''}`}
                        value={lngTexto}
                        onChange={(e) => { setLngTexto(e.target.value); limpiarErrorCoord('lng'); }}
                        placeholder="-64,2615"
                        inputMode="decimal"
                        aria-invalid={Boolean(erroresCoord.lng)}
                      />
                      <FieldError>{erroresCoord.lng}</FieldError>
                    </div>
                  </div>

                  <button type="submit" className="btn btn-primary w-100" disabled={guardandoCoord}>
                    {guardandoCoord ? <span className="loading">Guardando…</span> : 'Agregar punto'}
                  </button>
                  <p className="source-note">Acepta punto o coma decimal. También podés pegar “lat, lng”.</p>
                </form>
              </div>
            )}

            <section className="elements">
              <div className="section-head">
                <h2>Tus puntos</h2>
                <div className="section-actions">
                  <button
                    type="button"
                    className="btn btn-soft btn-sm"
                    onClick={abrirRuta}
                    disabled={elementos.length < 2}
                    aria-label="Armar ruta entre huellas"
                  >
                    Ruta
                  </button>
                  <button
                    type="button"
                    className="btn btn-soft btn-sm"
                    onClick={() => setFitAll((v) => v + 1)}
                    disabled={elementos.length === 0}
                  >
                    Ver todos
                  </button>
                  <button
                    type="button"
                    className="btn btn-quiet-danger btn-sm"
                    onClick={quitarTodos}
                    disabled={elementos.length === 0}
                  >
                    Quitar todos
                  </button>
                </div>
              </div>

              {elementos.length > 0 && (
                <div className="element-filter">
                  <input
                    type="search"
                    className="form-control"
                    value={filtroElementos}
                    onChange={(e) => setFiltroElementos(e.target.value)}
                    placeholder="Filtrar por nombre o dirección"
                    aria-label="Filtrar huellas"
                  />
                  {filtroActivo && (
                    <button
                      type="button"
                      className="element-filter-clear"
                      onClick={() => setFiltroElementos('')}
                      aria-label="Limpiar filtro"
                    >
                      Limpiar
                    </button>
                  )}
                </div>
              )}
              {filtroActivo && (
                <p className="element-filter-count">{elementosVisibles.length} de {elementos.length} huellas</p>
              )}

              {modoRuta && (
                <section className="ruta-panel" aria-label="Armar ruta entre huellas">
                  <div className="ruta-panel-head">
                    <div>
                      <h3>Armar paseo</h3>
                      <p>Elegí entre 2 y {MAX_PUNTOS_RUTA} huellas para unirlas por calles.</p>
                    </div>
                    <button type="button" className="btn btn-soft btn-sm" onClick={cerrarRuta}>
                      Cancelar
                    </button>
                  </div>

                  <div className="ruta-perfiles" role="group" aria-label="Medio de transporte">
                    {PERFILES_RUTA.map((perfil) => (
                      <button
                        key={perfil.id}
                        type="button"
                        className={perfilRuta === perfil.id ? 'is-active' : ''}
                        aria-pressed={perfilRuta === perfil.id}
                        onClick={() => cambiarPerfilRuta(perfil.id)}
                      >
                        {perfil.etiqueta}
                      </button>
                    ))}
                  </div>

                  <label className="ruta-opcion">
                    <input
                      type="checkbox"
                      checked={optimizarRuta}
                      onChange={cambiarOptimizarRuta}
                    />
                    <span>Optimizar orden</span>
                  </label>

                  <label className="ruta-opcion">
                    <input
                      type="checkbox"
                      checked={volverInicio}
                      onChange={cambiarVolverInicio}
                    />
                    <span>Volver al inicio</span>
                  </label>

                  {elegidosRuta.length > 0 && (
                    <label className="ruta-selector">
                      <span>Punto de inicio</span>
                      <select
                        value={inicioRutaId || ''}
                        onChange={(e) => cambiarInicioRuta(e.target.value)}
                      >
                        {elegidosRuta.map((el) => (
                          <option key={el.id} value={el.id}>{el.nombre}</option>
                        ))}
                      </select>
                    </label>
                  )}

                  {elegidosRuta.length > 1 && !volverInicio && (
                    <label className="ruta-selector">
                      <span>Punto final</span>
                      <select
                        value={finRutaId || ''}
                        onChange={(e) => cambiarFinRuta(e.target.value)}
                      >
                        <option value="">Donde termine</option>
                        {elegidosRuta
                          .filter((el) => el.id !== inicioRutaId)
                          .map((el) => (
                            <option key={el.id} value={el.id}>{el.nombre}</option>
                          ))}
                      </select>
                    </label>
                  )}

                  <p className="ruta-nota">El recorrido empieza en el punto de inicio elegido; con optimización, VROOM ordena el resto.</p>

                  <div className="ruta-panel-foot">
                    <span className="ruta-count">{seleccionRuta.size} de {MAX_PUNTOS_RUTA}</span>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={trazarRuta}
                      disabled={calculandoRuta || seleccionRuta.size < 2}
                    >
                      {calculandoRuta ? <span className="loading">Calculando…</span> : 'Trazar ruta'}
                    </button>
                  </div>
                  {errorRuta && <p className="ruta-error" role="alert">{errorRuta}</p>}
                </section>
              )}

              {puntoAlrededor && (
                <section className="alrededor" aria-live="polite">
                  <div className="alrededor-head">
                    <div>
                      <span className="ruta-kicker">Alrededor de</span>
                      <h3>{puntoAlrededor.nombre}</h3>
                    </div>
                    <button
                      type="button"
                      className="icon-delete"
                      onClick={cerrarAlrededor}
                      aria-label="Cerrar lugares cercanos"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                  {cargandoLugares && <p className="alrededor-estado">Buscando lugares cerca…</p>}
                  {errorLugares && <p className="ruta-error" role="alert">{errorLugares}</p>}
                  {!cargandoLugares && !errorLugares && lugaresAlrededor.length === 0 && (
                    <p className="alrededor-estado">No encontramos lugares cerca de esta huella.</p>
                  )}
                  {lugaresAlrededor.length > 0 && (
                    <div className="alrededor-lista">
                      {lugaresAlrededor.map((lugar, i) => (
                        <button
                          key={lugar.id || `${lugar.lat}-${lugar.lng}-${i}`}
                          type="button"
                          className="alrededor-item"
                          onClick={() => setFoco([lugar.lat, lugar.lng])}
                        >
                          <span className="alrededor-item-head">
                            <strong>{lugar.nombre}</strong>
                            <span>{formatearDistancia(lugar.distancia_metros)}</span>
                          </span>
                          <span className="alrededor-categoria">{lugar.categoria || 'Lugar'}</span>
                          {lugar.direccion && <span className="alrededor-direccion">{lugar.direccion}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="alrededor-nota">Datos de HERE. Se consultan al momento y no se guardan.</p>
                </section>
              )}

              {!modoRuta && ruta && (
                <section className="ruta-resumen" aria-live="polite">
                  <div className="ruta-resumen-head">
                    <div>
                      <span className="ruta-kicker">Ruta activa · {etiquetaPerfil(ruta.perfil)}</span>
                      <strong>{formatearDistancia(ruta.distancia_metros)}</strong>
                    </div>
                    <button
                      type="button"
                      className="icon-delete"
                      onClick={limpiarRuta}
                      aria-label="Quitar ruta"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                  <p className="ruta-resumen-meta">
                    {formatearDuracion(ruta.duracion_segundos)} · {ruta.ids.length} huellas
                    {nombreInicio ? ` · inicio: ${nombreInicio}` : ''}
                    {nombreFin ? ` · fin: ${nombreFin}` : ''}
                    {ruta.optimizar ? ' · orden optimizado' : ''}
                    {ruta.volverInicio ? ' · ida y vuelta' : ''}
                  </p>
                  {ruta.volverInicio && (
                    <div className="ruta-leyenda" aria-label="Tramos de la ruta">
                      <span><i className="ruta-trazo ruta-trazo--ida" aria-hidden="true" />Ida</span>
                      <span><i className="ruta-trazo ruta-trazo--regreso" aria-hidden="true" />Regreso</span>
                    </div>
                  )}
                  <div className="ruta-resumen-actions">
                    <button
                      type="button"
                      className="btn btn-soft btn-sm"
                      onClick={() => setFitRuta((v) => v + 1)}
                    >
                      Ver ruta
                    </button>
                    <button type="button" className="btn btn-soft btn-sm" onClick={abrirRuta}>
                      Editar ruta
                    </button>
                  </div>
                </section>
              )}

              {elementos.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-icon" aria-hidden="true"><IconHuella size={20} /></span>
                  <p>Todavía no hay puntos.</p>
                  <span>Buscá una dirección o ingresá coordenadas para empezar.</span>
                </div>
              ) : elementosVisibles.length === 0 ? (
                <div className="empty-state">
                  <p>No hay huellas que coincidan.</p>
                  <span>Probá con otro nombre o dirección.</span>
                </div>
              ) : (
                <div className="element-list">
                  {elementosVisibles.map((el) => {
                    const indice = elementos.findIndex((item) => item.id === el.id);
                    const enRuta = seleccionRuta.has(el.id);
                    const editando = editandoId === el.id;
                    return (
                      <div className={`element-row ${enRuta ? 'is-ruta' : ''} ${editando ? 'is-editing' : ''}`} key={el.id}>
                        {editando ? (
                          <form className="element-edit-form" onSubmit={guardarNombre}>
                            <input
                              className="form-control element-edit-input"
                              value={nombreEdit}
                              onChange={(e) => { setNombreEdit(e.target.value); setErrorEdicion(null); }}
                              onKeyDown={(e) => { if (e.key === 'Escape') cancelarEdicion(); }}
                              aria-label={`Nombre de ${el.nombre}`}
                              aria-invalid={Boolean(errorEdicion)}
                              maxLength={80}
                              autoFocus
                            />
                            <div className="element-edit-actions">
                              <button type="submit" className="btn btn-primary btn-xs">Guardar</button>
                              <button type="button" className="btn btn-soft btn-xs" onClick={cancelarEdicion}>
                                Cancelar
                              </button>
                            </div>
                            {errorEdicion && <span className="element-edit-error" role="alert">{errorEdicion}</span>}
                          </form>
                        ) : (
                          <>
                            {modoRuta && (
                              <input
                                type="checkbox"
                                className="ruta-check"
                                checked={enRuta}
                                onChange={() => toggleRutaElemento(el.id)}
                                disabled={!enRuta && seleccionRuta.size >= MAX_PUNTOS_RUTA}
                                aria-label={`Incluir ${el.nombre} en la ruta`}
                              />
                            )}
                            <button
                              type="button"
                              className="element-main"
                              onClick={() => (modoRuta ? toggleRutaElemento(el.id) : seleccionarElemento(el))}
                              aria-label={modoRuta ? `Seleccionar ${el.nombre} para la ruta` : `Centrar mapa en ${el.nombre}`}
                            >
                              <span className="element-headline">
                                <span className="element-dot" style={{ color: colorSeguro(el.color), background: colorSeguro(el.color) }} />
                                <span className="element-name">{el.nombre}</span>
                              </span>
                              <span className="element-sub">{el.direccion || 'Sin dirección disponible'}</span>
                            </button>
                            {!modoRuta && (
                              <>
                                <button
                                  type="button"
                                  className="element-nearby"
                                  onClick={() => verAlrededor(el)}
                                  aria-label={`Ver lugares cerca de ${el.nombre}`}
                                >
                                  Cerca
                                </button>
                                <button
                                  type="button"
                                  className="icon-edit"
                                  onClick={() => empezarEdicion(el)}
                                  aria-label={`Editar ${el.nombre}`}
                                >
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                    <path d="M4 20h4l10-10-4-4L4 16v4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                                    <path d="m13.5 6.5 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                                  </svg>
                                </button>
                                {!filtroActivo && (
                                  <div className="element-reorder" role="group" aria-label={`Orden de ${el.nombre}`}>
                                    <button
                                      type="button"
                                      onClick={() => moverElemento(el.id, -1)}
                                      disabled={indice === 0}
                                      aria-label={`Subir ${el.nombre}`}
                                    >
                                      ↑
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => moverElemento(el.id, 1)}
                                      disabled={indice === elementos.length - 1}
                                      aria-label={`Bajar ${el.nombre}`}
                                    >
                                      ↓
                                    </button>
                                  </div>
                                )}
                              </>
                            )}
                            <button
                              type="button"
                              className="icon-delete"
                              onClick={() => eliminar(el.id)}
                              aria-label={`Eliminar ${el.nombre}`}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                              </svg>
                            </button>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </aside>
      )}
    </div>
  );
}
