import React, { useEffect, useRef } from 'react';
import { Map as MapLibreMap, Marker, Popup, NavigationControl, Source, Layer, useMap } from '@vis.gl/react-maplibre';
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { colorSeguro } from '../lib/storage.js';
import { offsetsPorCoordenada } from '../lib/marcadores.js';
import { ajustarVista } from '../lib/vista.js';
import { boundsDeRuta, formatearDistancia, pinturaTramo, tramosDeRuta, TRAMOS_RUTA } from '../lib/ruta.js';
import IconHuella from './IconHuella.jsx';

setWorkerUrl(workerUrl);

const ARGENTINA_CENTER = [-38.4161, -63.6167];
const MAP_STYLE = import.meta.env.VITE_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/dark';
const MAX_ZOOM = 20;

function Pin({ color, variant = 'element', selected = false, label }) {
  const classes = ['map-pin', `map-pin--${variant}`, selected ? 'is-selected' : ''].filter(Boolean).join(' ');
  return (
    <span className={classes} style={{ '--pin': colorSeguro(color) }} title={label}>
      <IconHuella size={variant === 'element' ? 18 : 16} />
    </span>
  );
}

function PlacePin({ numero, nombre, activo, onClick }) {
  return (
    <button
      type="button"
      className={`map-place${activo ? ' is-active' : ''}`}
      aria-label={`Ver ${nombre} en el mapa`}
      title={`${nombre} · ${numero}`}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <span aria-hidden="true">{numero}</span>
      <span className="map-place-label" aria-hidden="true">{nombre}</span>
    </button>
  );
}

function ControlVista({ foco, fitAll, elementos }) {
  const maps = useMap();
  const map = maps?.current;
  const doneRef = useRef(false);

  useEffect(() => {
    if (!map || !foco) return;
    map.flyTo({
      center: [foco[1], foco[0]],
      zoom: Math.max(map.getZoom(), 13),
      duration: 750,
    });
  }, [foco, map]);

  useEffect(() => {
    if (!map || fitAll <= 0 || elementos.length === 0) return;
    ajustarVista(map, elementos, { animar: true });
  }, [fitAll, elementos, map]);

  useEffect(() => {
    if (!map || doneRef.current || elementos.length === 0) return;
    ajustarVista(map, elementos, { animar: false });
    doneRef.current = true;
  }, [elementos, map]);

  return null;
}

function ControlImagenesEstilo() {
  const maps = useMap();
  const mapRef = maps?.current;
  const map = mapRef?.getMap?.() || mapRef;

  useEffect(() => {
    if (!map?.setMissingStyleImageResolver) return undefined;

    map.setMissingStyleImageResolver((id) => {
      if (id !== 'circle-11' || map.hasImage(id)) return;
      const size = 22;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.beginPath();
      context.arc(size / 2, size / 2, 7, 0, Math.PI * 2);
      context.fillStyle = '#d7d4cc';
      context.fill();
      context.lineWidth = 1.5;
      context.strokeStyle = '#77736a';
      context.stroke();
      map.addImage(id, context.getImageData(0, 0, size, size));
    });

    return () => map.setMissingStyleImageResolver(null);
  }, [map]);

  return null;
}

function ControlLugares({ origen, lugares }) {
  const maps = useMap();
  const map = maps?.current;

  useEffect(() => {
    if (!map || !origen || !Array.isArray(lugares) || lugares.length === 0) return;
    ajustarVista(map, [origen, ...lugares], { animar: true, padding: 80, maxZoom: 17, zoomUnico: 17 });
  }, [map, origen, lugares]);

  return null;
}

function ControlRuta({ ruta, fitRuta }) {
  const maps = useMap();
  const map = maps?.current;

  useEffect(() => {
    if (!map || !ruta) return;
    const bounds = boundsDeRuta(ruta);
    if (!bounds) return;
    const [[minLng, minLat], [maxLng, maxLat]] = bounds;
    if (minLng === maxLng && minLat === maxLat) {
      map.flyTo({ center: [minLng, minLat], zoom: 16, duration: 800 });
      return;
    }
    map.fitBounds(bounds, {
      padding: { top: 90, bottom: 90, left: 90, right: 90 },
      maxZoom: 16,
      duration: 800,
    });
  }, [fitRuta, map, ruta]);

  return null;
}

export default function Mapa({
  elementos,
  candidatos,
  sugerencias,
  seleccionados,
  sugerenciasSeleccionadas,
  popup,
  setPopup,
  foco,
  fitAll,
  ruta,
  fitRuta,
  lugares = [],
  origenLugares,
  lugarActivo,
  onSeleccionarLugar,
  onToggleSeleccionado,
  onToggleSugerencia,
  onFoco,
}) {
  const elementOffsets = offsetsPorCoordenada(elementos);
  const candidateOffsets = offsetsPorCoordenada(candidatos);
  const suggestionOffsets = offsetsPorCoordenada(sugerencias);
  const tramos = tramosDeRuta(ruta);

  return (
    <MapLibreMap
      id="mapa"
      mapStyle={MAP_STYLE}
      initialViewState={{ longitude: ARGENTINA_CENTER[1], latitude: ARGENTINA_CENTER[0], zoom: 4 }}
      minZoom={3}
      maxZoom={MAX_ZOOM}
      maxPitch={0}
      dragRotate={false}
      pitchWithRotate={false}
      touchPitch={false}
      attributionControl
      reuseMaps
      style={{ width: '100%', height: '100%' }}
    >
      <NavigationControl position="bottom-right" showCompass={false} />
      <ControlImagenesEstilo />
      <ControlVista foco={foco} fitAll={fitAll} elementos={elementos} />
      <ControlLugares origen={origenLugares} lugares={lugares} />
      <ControlRuta ruta={ruta} fitRuta={fitRuta} />

      {tramos.ida && (
        <Source id="ruta-ida-geojson" type="geojson" data={tramos.ida}>
          <Layer
            id="ruta-ida-borde"
            type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={pinturaTramo(TRAMOS_RUTA.ida, { borde: true })}
          />
          <Layer
            id="ruta-ida"
            type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={pinturaTramo(TRAMOS_RUTA.ida)}
          />
        </Source>
      )}

      {tramos.regreso && (
        <Source id="ruta-regreso-geojson" type="geojson" data={tramos.regreso}>
          <Layer
            id="ruta-regreso-borde"
            type="line"
            layout={{ 'line-cap': 'butt', 'line-join': 'round' }}
            paint={pinturaTramo(TRAMOS_RUTA.regreso, { borde: true })}
          />
          <Layer
            id="ruta-regreso"
            type="line"
            layout={{ 'line-cap': 'butt', 'line-join': 'round' }}
            paint={pinturaTramo(TRAMOS_RUTA.regreso)}
          />
        </Source>
      )}

      {elementos.map((el, index) => {
        const offset = elementOffsets.get(index) || { x: 0, y: 0 };
        return (
          <Marker
            key={el.id}
            longitude={el.lng}
            latitude={el.lat}
            anchor="center"
            offset={[offset.x, offset.y]}
            onClick={() => {
              onFoco([el.lat, el.lng]);
              setPopup({ titulo: el.nombre, direccion: el.direccion, lat: el.lat, lng: el.lng });
            }}
          >
            <Pin color={el.color} label={el.nombre} />
          </Marker>
        );
      })}

      {lugares.map((lugar, i) => (
        <Marker
          key={lugar.id || `lugar-${lugar.lat}-${lugar.lng}-${i}`}
          longitude={lugar.lng}
          latitude={lugar.lat}
          anchor="center"
        >
          <PlacePin numero={i + 1} nombre={lugar.nombre} activo={lugarActivo === lugar} onClick={() => onSeleccionarLugar(lugar)} />
        </Marker>
      ))}

      {candidatos.map((c, i) => {
        const offset = candidateOffsets.get(i) || { x: 0, y: 0 };
        return (
          <Marker
            key={`cand-${i}`}
            longitude={c.lng}
            latitude={c.lat}
            anchor="center"
            offset={[offset.x, offset.y]}
            onClick={() => {
              onToggleSeleccionado(i);
              setPopup({ titulo: 'Coincidencia', direccion: c.direccion, lat: c.lat, lng: c.lng });
            }}
          >
            <Pin color="#9cafb7" variant="preview" selected={seleccionados.has(i)} label={c.direccion} />
          </Marker>
        );
      })}

      {sugerencias.map((c, i) => {
        const offset = suggestionOffsets.get(i) || { x: 0, y: 0 };
        return (
          <Marker
            key={`sug-${i}`}
            longitude={c.lng}
            latitude={c.lat}
            anchor="center"
            offset={[offset.x, offset.y]}
            onClick={() => {
              onToggleSugerencia(i);
              setPopup({ titulo: 'Ubicación cercana', direccion: c.direccion, lat: c.lat, lng: c.lng });
            }}
          >
            <Pin color="#f1ab86" variant="suggestion" selected={sugerenciasSeleccionadas.has(i)} label={c.direccion} />
          </Marker>
        );
      })}

      {popup && (
        <Popup
          longitude={popup.lng}
          latitude={popup.lat}
          anchor="bottom"
          closeButton
          closeOnClick={false}
          onClose={() => setPopup(null)}
        >
          <div className="pin-card">
            {popup.categoria && <span className="pin-card-kicker">Lugar cercano</span>}
            <strong>{popup.titulo}</strong>
            {popup.categoria && (
              <span className="pin-card-meta">
                {popup.categoria}
                {Number.isFinite(popup.distancia_metros) ? ` · ${formatearDistancia(popup.distancia_metros)}` : ''}
              </span>
            )}
            <span>{popup.direccion || 'Sin dirección disponible'}</span>
            <small>{popup.lat.toFixed(6)}, {popup.lng.toFixed(6)}</small>
          </div>
        </Popup>
      )}
    </MapLibreMap>
  );
}
