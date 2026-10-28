import React, { useEffect, useRef } from 'react';
import { Map as MapLibreMap, Marker, Popup, NavigationControl, useMap } from '@vis.gl/react-maplibre';
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { colorSeguro } from '../lib/storage.js';
import { offsetsPorCoordenada } from '../lib/marcadores.js';
import { ajustarVista } from '../lib/vista.js';

setWorkerUrl(workerUrl);

const ARGENTINA_CENTER = [-38.4161, -63.6167];
const MAP_STYLE = import.meta.env.VITE_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/dark';
const MAX_ZOOM = 20;

function Pin({ color, variant = 'element', selected = false, label }) {
  const classes = ['map-pin', `map-pin--${variant}`, selected ? 'is-selected' : ''].filter(Boolean).join(' ');
  return <span className={classes} style={{ '--pin': colorSeguro(color) }} title={label} />;
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
  onToggleSeleccionado,
  onToggleSugerencia,
  onFoco,
}) {
  const elementOffsets = offsetsPorCoordenada(elementos);
  const candidateOffsets = offsetsPorCoordenada(candidatos);
  const suggestionOffsets = offsetsPorCoordenada(sugerencias);

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
      <ControlVista foco={foco} fitAll={fitAll} elementos={elementos} />

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
          onClose={() => setPopup(null)}
        >
          <div className="pin-card">
            <strong>{popup.titulo}</strong>
            <span>{popup.direccion || 'Sin dirección disponible'}</span>
            <small>{popup.lat.toFixed(6)}, {popup.lng.toFixed(6)}</small>
          </div>
        </Popup>
      )}
    </MapLibreMap>
  );
}
