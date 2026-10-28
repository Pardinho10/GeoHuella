import React, { Suspense, useEffect, useState } from 'react';
import { cargarElementos, guardarElementos, cargarContador, guardarContador, colorSeguro } from './lib/storage.js';
import { agregarCandidatos, parsearCoordenada, parsearParPegado, enRangoArgentina } from './lib/elementos.js';
import { obtenerProvincias, geocodificar, ubicarCoordenadas } from './api';

const Mapa = React.lazy(() => import('./components/Mapa.jsx'));

const MAX_SUGERENCIAS = 5;

function IconPin({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="12" cy="10" r="2.4" fill="currentColor" />
    </svg>
  );
}

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

  useEffect(() => { guardarElementos(elementos); }, [elementos]);
  useEffect(() => { guardarContador(contador); }, [contador]);

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
          <IconPin size={19} />
        </button>
      )}

      {panelAbierto && (
        <aside className="panel-flotante" aria-label="Panel del mapa">
          <header className="panel-header">
            <div className="brand-row">
              <div className="brand">
                <span className="brand-mark" aria-hidden="true"><IconPin size={18} /></span>
                <div>
                  <span className="eyebrow">Piloto Georef</span>
                  <h1>Atlas Argentino</h1>
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
            <p className="panel-subtitle">Encontrá una dirección, compará coincidencias y guardá tus puntos.</p>
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

              {elementos.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-icon" aria-hidden="true"><IconPin size={20} /></span>
                  <p>Todavía no hay puntos.</p>
                  <span>Buscá una dirección o ingresá coordenadas para empezar.</span>
                </div>
              ) : (
                <div className="element-list">
                  {elementos.map((el) => (
                    <div className="element-row" key={el.id}>
                      <button
                        type="button"
                        className="element-main"
                        onClick={() => seleccionarElemento(el)}
                        aria-label={`Centrar mapa en ${el.nombre}`}
                      >
                        <span className="element-headline">
                          <span className="element-dot" style={{ color: colorSeguro(el.color), background: colorSeguro(el.color) }} />
                          <span className="element-name">{el.nombre}</span>
                        </span>
                        <span className="element-sub">{el.direccion || 'Sin dirección disponible'}</span>
                      </button>
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
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </aside>
      )}
    </div>
  );
}
