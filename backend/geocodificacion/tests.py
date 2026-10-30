from unittest.mock import patch, MagicMock

import pytest
from django.core.cache import cache
from django.test import Client

from config.version import VERSION


@pytest.fixture(autouse=True)
def _clear_cache(monkeypatch):
    monkeypatch.setattr("geocodificacion.services.nominatim.RATE_LIMIT_SECONDS", 0.0)
    monkeypatch.setattr("django.conf.settings.HERE_ENABLED", False)
    monkeypatch.setattr("django.conf.settings.HERE_API_KEY", "")
    monkeypatch.setattr("django.conf.settings.ROUTING_ENABLED", False)
    monkeypatch.setattr("django.conf.settings.ROUTING_API_KEY", "")
    monkeypatch.setattr("django.conf.settings.HERE_PLACES_ENABLED", False)
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def client():
    return Client()


def test_salud_ok(client):
    res = client.get("/api/salud/")
    assert res.status_code == 200
    assert res.json() == {"estado": "ok", "version": VERSION}


def _mock_provincias_response(items):
    mock = MagicMock()
    mock.status_code = 200
    mock.json.return_value = {"provincias": items}
    return mock


def test_provincias_ok_sorted(client):
    items = [{"nombre": "Córdoba"}, {"nombre": "Buenos Aires"}, {"nombre": "Chaco"}]
    with patch("geocodificacion.services.georef.requests.get", return_value=_mock_provincias_response(items)):
        res = client.get("/api/provincias/")
    assert res.status_code == 200
    assert res.json() == {"provincias": ["Buenos Aires", "Chaco", "Córdoba"]}


def test_provincias_cached(client):
    items = [{"nombre": "Buenos Aires"}]
    with patch("geocodificacion.services.georef.requests.get", return_value=_mock_provincias_response(items)) as mock_get:
        client.get("/api/provincias/")
        client.get("/api/provincias/")
    assert mock_get.call_count == 1


def test_provincias_georef_error(client, caplog):
    import logging
    caplog.set_level(logging.WARNING, logger="geocodificacion.services.georef")
    secret_marker = "SECRET-BODY-MARKER-123"
    mock = MagicMock()
    mock.status_code = 500
    mock.text = secret_marker
    with patch("geocodificacion.services.georef.requests.get", return_value=mock):
        res = client.get("/api/provincias/")
    assert res.status_code == 502
    body = res.json()
    assert body["error"]["codigo"] == "servicio_no_disponible"
    assert secret_marker not in caplog.text


def test_provincias_sends_user_agent(client):
    items = [{"nombre": "Buenos Aires"}]
    mock = MagicMock()
    mock.status_code = 200
    mock.json.return_value = {"provincias": items}
    with patch("geocodificacion.services.georef.requests.get", return_value=mock) as mock_get:
        client.get("/api/provincias/")
    assert mock_get.call_count == 1
    headers = mock_get.call_args.kwargs.get("headers", {})
    assert "User-Agent" in headers
    assert "piloto-mapa" in headers["User-Agent"]


def test_provincias_network_error(client):
    import requests as req
    with patch("geocodificacion.services.georef.requests.get", side_effect=req.ConnectionError("down")):
        res = client.get("/api/provincias/")
    assert res.status_code == 502
    assert res.json()["error"]["codigo"] == "servicio_no_disponible"


def test_provincias_invalid_json(client):
    mock = MagicMock()
    mock.status_code = 200
    mock.json.side_effect = ValueError("bad")
    with patch("geocodificacion.services.georef.requests.get", return_value=mock):
        res = client.get("/api/provincias/")
    assert res.status_code == 502


def test_salud_method_not_allowed(client):
    res = client.post("/api/salud/")
    assert res.status_code == 405


def test_settings_defaults():
    from django.conf import settings
    assert settings.CORS_ALLOW_ALL_ORIGINS is False
    assert settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]["anon"] == "30/min"


def _mock_response(payload, status_code=200):
    m = MagicMock()
    m.status_code = status_code
    m.json.return_value = payload
    m.text = ""
    return m


GEOCOD_PAYLOAD = {
    "direcciones": [
        {
            "nomenclatura": "AV CORRIENTES 1000, San Nicolás, Comuna 1, Ciudad Autónoma de Buenos Aires",
            "ubicacion": {"lat": -34.603669473, "lon": -58.380975283},
            "provincia": {"nombre": "Ciudad Autónoma de Buenos Aires"},
            "localidad_censal": {"nombre": "CABA - Comuna 1"},
            "departamento": {"nombre": "Comuna 1"},
        },
        {
            "nomenclatura": "AV CORRIENTES 1000, Balvanera, Comuna 3, Ciudad Autónoma de Buenos Aires",
            "ubicacion": {"lat": None, "lon": None},
            "provincia": {"nombre": "Ciudad Autónoma de Buenos Aires"},
            "localidad_censal": {"nombre": "CABA - Comuna 3"},
            "departamento": {"nombre": "Comuna 3"},
        },
    ]
}


def test_geocodificar_success_filters_null(client):
    provs = [{"nombre": "Ciudad Autónoma de Buenos Aires"}]
    # First call provincias (for validation), then direcciones
    responses = [_mock_response({"provincias": provs}), _mock_response(GEOCOD_PAYLOAD)]
    with patch("geocodificacion.services.georef.requests.get", side_effect=responses):
        res = client.post("/api/geocodificar/", {
            "calle": "Avenida Corrientes",
            "numero": "1000",
            "ciudad": "Ciudad Autónoma de Buenos Aires",
            "provincia": "Ciudad Autónoma de Buenos Aires",
        }, content_type="application/json")
    assert res.status_code == 200
    body = res.json()
    assert len(body["resultados"]) == 1
    r = body["resultados"][0]
    assert r["lat"] == -34.603669473
    assert r["lng"] == -58.380975283
    assert r["aproximada"] is True
    assert r["localidad"] == "CABA - Comuna 1"


def test_geocodificar_no_encontrada(client):
    provs = [{"nombre": "Santiago del Estero"}]
    payload = {"direcciones": [
        {"nomenclatura": "X", "ubicacion": {"lat": None, "lon": None},
         "provincia": {"nombre": "Santiago del Estero"},
         "localidad_censal": {"nombre": "Y"}, "departamento": {"nombre": "Z"}},
    ]}
    responses = [_mock_response({"provincias": provs}), _mock_response(payload)]
    with patch("geocodificacion.services.georef.requests.get", side_effect=responses), patch(
        "geocodificacion.services.nominatim.NominatimClient.search_exact", return_value=[]
    ), patch(
        "geocodificacion.services.nominatim.NominatimClient.search_nearby", return_value=[]
    ):
        res = client.post("/api/geocodificar/", {
            "calle": "Avenida Belgrano",
            "numero": "1200",
            "ciudad": "Santiago del Estero",
            "provincia": "Santiago del Estero",
        }, content_type="application/json")
    assert res.status_code == 404
    assert res.json()["error"]["codigo"] == "no_encontrada"
    assert "sugerencias" not in res.json()["error"]


def test_geocodificar_validacion(client):
    res = client.post("/api/geocodificar/", {
        "calle": "",
        "numero": "abc",
        "ciudad": "",
        "provincia": "X",
    }, content_type="application/json")
    assert res.status_code == 400
    assert res.json()["error"]["codigo"] == "solicitud_invalida"
    assert "campos" in res.json()["error"]


def test_geocodificar_provincia_invalida(client):
    provs = [{"nombre": "Buenos Aires"}]
    with patch("geocodificacion.services.georef.requests.get", return_value=_mock_response({"provincias": provs})):
        res = client.post("/api/geocodificar/", {
            "calle": "Calle",
            "numero": "1",
            "ciudad": "Ciudad",
            "provincia": "Inexistente",
        }, content_type="application/json")
    assert res.status_code == 400
    assert "provincia" in res.json()["error"].get("campos", {})


def test_geocodificar_network_error(client):
    provs = [{"nombre": "Buenos Aires"}]
    responses = [_mock_response({"provincias": provs}), Exception("boom")]
    # requests.get side_effect for second call: ConnectionError
    import requests as req
    responses = [_mock_response({"provincias": provs}), req.ConnectionError("down")]
    with patch("geocodificacion.services.georef.requests.get", side_effect=responses):
        res = client.post("/api/geocodificar/", {
            "calle": "Calle",
            "numero": "1",
            "ciudad": "Ciudad",
            "provincia": "Buenos Aires",
        }, content_type="application/json")
    assert res.status_code == 502


def test_geocodificar_payload_raro(client):
    provs = [{"nombre": "Buenos Aires"}]
    responses = [_mock_response({"provincias": provs}), _mock_response({"foo": "bar"})]
    with patch("geocodificacion.services.georef.requests.get", side_effect=responses):
        res = client.post("/api/geocodificar/", {
            "calle": "Calle",
            "numero": "1",
            "ciudad": "Ciudad",
            "provincia": "Buenos Aires",
        }, content_type="application/json")
    assert res.status_code == 502


def test_geocodificar_malformed_item_is_502(client):
    provs = [{"nombre": "Buenos Aires"}]
    payload = {"direcciones": ["no es un objeto"]}
    responses = [_mock_response({"provincias": provs}), _mock_response(payload)]
    with patch("geocodificacion.services.georef.requests.get", side_effect=responses):
        res = client.post("/api/geocodificar/", {
            "calle": "Calle", "numero": "1", "ciudad": "Ciudad", "provincia": "Buenos Aires",
        }, content_type="application/json")
    assert res.status_code == 502
    assert res.json()["error"]["codigo"] == "servicio_no_disponible"


def test_geocodificar_malformed_nested_entity_is_502(client):
    provs = [{"nombre": "Buenos Aires"}]
    payload = {"direcciones": [{
        "nomenclatura": "CALLE 1",
        "ubicacion": {"lat": -34.0, "lon": -58.0},
        "provincia": "Buenos Aires",
    }]}
    responses = [_mock_response({"provincias": provs}), _mock_response(payload)]
    with patch("geocodificacion.services.georef.requests.get", side_effect=responses):
        res = client.post("/api/geocodificar/", {
            "calle": "Calle", "numero": "1", "ciudad": "Ciudad", "provincia": "Buenos Aires",
        }, content_type="application/json")
    assert res.status_code == 502
    assert res.json()["error"]["codigo"] == "servicio_no_disponible"


def test_geocodificar_cache(client):
    provs = [{"nombre": "Buenos Aires"}]
    payload = {"direcciones": [
        {"nomenclatura": "CALLE 1", "ubicacion": {"lat": -34.0, "lon": -58.0},
         "provincia": {"nombre": "Buenos Aires"}, "localidad_censal": {"nombre": "Loc"},
         "departamento": {"nombre": "Dep"}},
    ]}
    responses = [_mock_response({"provincias": provs}), _mock_response(payload)]
    with patch("geocodificacion.services.georef.requests.get", side_effect=responses) as mock_get:
        client.post("/api/geocodificar/", {
            "calle": "Calle", "numero": "1", "ciudad": "Ciudad", "provincia": "Buenos Aires",
        }, content_type="application/json")
        client.post("/api/geocodificar/", {
            "calle": "Calle", "numero": "1", "ciudad": "Ciudad", "provincia": "Buenos Aires",
        }, content_type="application/json")
    # provincias cached + direcciones cached => only 2 calls total
    assert mock_get.call_count == 2


UBIC_PAYLOAD = {
    "ubicacion": {
        "departamento": {"nombre": "Capital"},
        "provincia": {"nombre": "Santiago del Estero"},
        "gobierno_local": {"nombre": "Santiago del Estero"},
    }
}


def test_ubicar_valido(client):
    with patch("geocodificacion.services.georef.requests.get", return_value=_mock_response(UBIC_PAYLOAD)):
        res = client.post("/api/ubicar-coordenadas/", {"lat": -27.7951, "lng": -64.2615}, content_type="application/json")
    assert res.status_code == 200
    body = res.json()
    assert body["lat"] == -27.7951
    assert body["lng"] == -64.2615
    assert body["provincia"] == "Santiago del Estero"
    assert body["departamento"] == "Capital"
    assert body["direccion"] == "Santiago del Estero, Santiago del Estero"


def test_ubicar_fuera_rango(client):
    res = client.post("/api/ubicar-coordenadas/", {"lat": 0.0, "lng": -64.0}, content_type="application/json")
    assert res.status_code == 422
    assert res.json()["error"]["codigo"] == "fuera_de_rango"


def test_ubicar_no_territorio(client):
    with patch("geocodificacion.services.georef.requests.get", return_value=_mock_response({"ubicacion": None})):
        res = client.post("/api/ubicar-coordenadas/", {"lat": -27.7951, "lng": -64.2615}, content_type="application/json")
    assert res.status_code == 200
    body = res.json()
    assert body["direccion"] is None
    assert body["provincia"] is None
    assert body["departamento"] is None


def test_ubicar_error(client):
    import requests as req
    with patch("geocodificacion.services.georef.requests.get", side_effect=req.Timeout("t")):
        res = client.post("/api/ubicar-coordenadas/", {"lat": -27.7951, "lng": -64.2615}, content_type="application/json")
    assert res.status_code == 502


def test_ubicar_payload_raro(client):
    with patch("geocodificacion.services.georef.requests.get", return_value=_mock_response({"ubicacion": "bad"})):
        res = client.post("/api/ubicar-coordenadas/", {"lat": -27.7951, "lng": -64.2615}, content_type="application/json")
    assert res.status_code == 502


def test_ubicar_validacion(client):
    res = client.post("/api/ubicar-coordenadas/", {"lat": "x", "lng": -64.0}, content_type="application/json")
    assert res.status_code == 400


def test_geocodificar_provincia_service_error_502(client):
    import requests as req
    # provincias call fails
    with patch("geocodificacion.services.georef.requests.get", side_effect=req.ConnectionError("down")):
        res = client.post("/api/geocodificar/", {
            "calle": "Calle",
            "numero": "1",
            "ciudad": "Ciudad",
            "provincia": "Buenos Aires",
        }, content_type="application/json")
    assert res.status_code == 502
    assert res.json()["error"]["codigo"] == "servicio_no_disponible"


def test_ubicar_bool_rejected(client):
    res = client.post("/api/ubicar-coordenadas/", {"lat": True, "lng": -64.0}, content_type="application/json")
    assert res.status_code == 400


def test_ubicar_missing_ubicacion_key_502(client):
    payload = {"parametros": {}}
    with patch("geocodificacion.services.georef.requests.get", return_value=_mock_response(payload)):
        res = client.post("/api/ubicar-coordenadas/", {"lat": -27.7951, "lng": -64.2615}, content_type="application/json")
    assert res.status_code == 502
    assert res.json()["error"]["codigo"] == "servicio_no_disponible"


def test_ubicar_unexpected_ubicacion_type_502(client):
    payload = {"ubicacion": "bad"}
    with patch("geocodificacion.services.georef.requests.get", return_value=_mock_response(payload)):
        res = client.post("/api/ubicar-coordenadas/", {"lat": -27.7951, "lng": -64.2615}, content_type="application/json")
    assert res.status_code == 502


def test_ubicar_malformed_nested_entity_502(client):
    payload = {"ubicacion": {"provincia": "Santiago del Estero"}}
    with patch("geocodificacion.services.georef.requests.get", return_value=_mock_response(payload)):
        res = client.post("/api/ubicar-coordenadas/", {"lat": -27.7951, "lng": -64.2615}, content_type="application/json")
    assert res.status_code == 502
    assert res.json()["error"]["codigo"] == "servicio_no_disponible"


def _fallback_candidate(number, street="Avenida Libertad", city="Ciudad Autónoma de Buenos Aires", state="Ciudad Autónoma de Buenos Aires"):
    return {
        "lat": -34.6 - number / 100000,
        "lng": -58.4,
        "direccion": f"{street} {number}, {city}, {state}",
        "provincia": state,
        "localidad": city,
        "departamento": None,
        "aproximada": True,
    }


def test_geocodificar_usa_fallback_exacto_de_nominatim(client):
    provs = [{"nombre": "Ciudad Autónoma de Buenos Aires"}]
    georef_payload = {"direcciones": [
        {"nomenclatura": "AV LIBERTAD 640", "ubicacion": {"lat": None, "lon": None},
         "provincia": {"nombre": "Ciudad Autónoma de Buenos Aires"},
         "localidad_censal": {"nombre": "CABA"}, "departamento": {"nombre": "Comuna 1"}},
    ]}
    responses = [_mock_response({"provincias": provs}), _mock_response(georef_payload)]
    exacto = _fallback_candidate(640)
    with patch("geocodificacion.services.georef.requests.get", side_effect=responses), patch(
        "geocodificacion.services.nominatim.NominatimClient.search_exact", return_value=[exacto]
    ) as buscar_exacto, patch(
        "geocodificacion.services.nominatim.NominatimClient.search_nearby"
    ) as buscar_cercanos:
        res = client.post("/api/geocodificar/", {
            "calle": "Calle Libertad",
            "numero": "640",
            "ciudad": "Ciudad Autónoma de Buenos Aires",
            "provincia": "Ciudad Autónoma de Buenos Aires",
        }, content_type="application/json")
    assert res.status_code == 200
    assert res.json()["resultados"][0]["lat"] == exacto["lat"]
    buscar_exacto.assert_called_once()
    buscar_cercanos.assert_not_called()


def test_geocodificar_sugerencias_cercanas(client):
    provs = [{"nombre": "Santiago del Estero"}]
    georef_payload = {"direcciones": [
        {"nomenclatura": "X", "ubicacion": {"lat": None, "lon": None},
         "provincia": {"nombre": "Santiago del Estero"},
         "localidad_censal": {"nombre": "Santiago del Estero"},
         "departamento": {"nombre": "Capital"}},
    ]}
    responses = [_mock_response({"provincias": provs}), _mock_response(georef_payload)]
    cercanas = [_fallback_candidate(626, city="Santiago del Estero", state="Santiago del Estero"),
                _fallback_candidate(650, city="Santiago del Estero", state="Santiago del Estero")]
    with patch("geocodificacion.services.georef.requests.get", side_effect=responses), patch(
        "geocodificacion.services.nominatim.NominatimClient.search_exact", return_value=[]
    ), patch(
        "geocodificacion.services.nominatim.NominatimClient.search_nearby", return_value=cercanas
    ):
        res = client.post("/api/geocodificar/", {
            "calle": "Calle Libertad",
            "numero": "640",
            "ciudad": "Santiago del Estero",
            "provincia": "Santiago del Estero",
        }, content_type="application/json")
    assert res.status_code == 404
    body = res.json()["error"]
    assert body["codigo"] == "no_encontrada"
    assert len(body["sugerencias"]) == 2
    assert all(s["aproximada"] is True for s in body["sugerencias"])
    assert body["sugerencias"][0]["direccion"].startswith("Avenida Libertad 626")


def test_nominatim_exact_normaliza_prefijo_y_alias_caba():
    from geocodificacion.services.nominatim import NominatimClient

    response = MagicMock()
    response.status_code = 200
    response.json.return_value = [{
        "lat": "-34.603669473",
        "lon": "-58.380975283",
        "display_name": "1000, Avenida Corrientes, San Nicolás, Buenos Aires, Argentina",
        "address": {
            "road": "Avenida Corrientes",
            "house_number": "1000",
            "city": "Buenos Aires",
            "state": "Ciudad Autónoma de Buenos Aires",
        },
    }]
    with patch("geocodificacion.services.nominatim.requests.get", return_value=response) as get:
        result = NominatimClient().search_exact(
            "Avenida Corrientes", "1000",
            "Ciudad Autónoma de Buenos Aires", "Ciudad Autónoma de Buenos Aires"
        )
    assert len(result) == 1
    assert result[0]["lat"] == -34.603669473
    assert get.call_args.kwargs["params"]["street"] == "1000 Corrientes"


def test_nominatim_street_normalization():
    from geocodificacion.services.nominatim import NominatimClient

    assert NominatimClient._road_ok("Avenida Libertad", "Calle Libertad")
    assert NominatimClient._road_ok("Av. Corrientes", "Avenida Corrientes")
    assert NominatimClient._road_ok("Avenida General San Martín", "Avenida General San Martin")
    assert not NominatimClient._road_ok("Bateria Libertad", "Calle Libertad")


def test_nominatim_nearby_prueba_alturas_vecinas_y_excluye_la_pedida(monkeypatch):
    from geocodificacion.services.nominatim import NominatimClient

    client = NominatimClient()
    calls = []
    disponibles = {"639", "641", "638", "642", "630"}
    monkeypatch.setattr(client, "search_exact", lambda calle, numero, ciudad, provincia: (
        calls.append(numero) or ([{
            "lat": -27.7885,
            "lng": -64.2620,
            "direccion": f"Avenida Libertad {numero}, Santiago del Estero, Santiago del Estero",
            "provincia": "Santiago del Estero",
            "localidad": "Santiago del Estero",
            "departamento": None,
            "aproximada": True,
        }] if numero in disponibles else [])
    ))

    result = client.search_nearby("Calle Libertad", "640", "Santiago del Estero", "Santiago del Estero")

    assert [item["direccion"].split()[2].rstrip(",") for item in result] == ["639", "641", "638", "642", "630"]
    assert calls == ["639", "641", "638", "642", "630"]
    assert "640" not in calls
    assert all(item["provincia"] == "Santiago del Estero" for item in result)


def test_nominatim_rate_limit_compartido_entre_clientes(monkeypatch, tmp_path):
    from geocodificacion.services import nominatim as mod

    monkeypatch.setattr(mod, "RATE_LIMIT_SECONDS", 1.0)
    monkeypatch.setattr(
        mod.settings, "NOMINATIM_RATE_LOCK_FILE", str(tmp_path / "nominatim.lock"), raising=False
    )
    ahora = [1000.0]
    sleeps = []
    monkeypatch.setattr(mod.time, "time", lambda: ahora[0])
    monkeypatch.setattr(mod.time, "sleep", lambda seconds: sleeps.append(seconds))

    primero = mod.NominatimClient()
    segundo = mod.NominatimClient()
    primero._respect_rate_limit()
    ahora[0] = 1000.2
    segundo._respect_rate_limit()

    assert len(sleeps) == 1
    assert 0.7 <= sleeps[0] <= 0.9


def test_nominatim_nearby_respeta_presupuesto(monkeypatch):
    from geocodificacion.services import nominatim as mod

    client = mod.NominatimClient()
    llamadas = []
    monkeypatch.setattr(
        client,
        "search_exact",
        lambda calle, numero, ciudad, provincia: (llamadas.append(numero) or []),
    )
    monkeypatch.setattr(mod.settings, "NOMINATIM_NEARBY_BUDGET_SECONDS", 1.0, raising=False)
    tiempos = iter([0.0, 0.5, 1.5])
    monkeypatch.setattr(mod.time, "monotonic", lambda: next(tiempos))

    resultado = client.search_nearby(
        "Calle Libertad", "640", "Santiago del Estero", "Santiago del Estero"
    )

    assert llamadas == ["639"]
    assert resultado == []


def test_nominatim_exact_reintenta_sin_filtros_y_valida_territorio():
    from geocodificacion.services.nominatim import NominatimClient

    vacio = MagicMock()
    vacio.status_code = 200
    vacio.json.return_value = []

    nacional = MagicMock()
    nacional.status_code = 200
    nacional.json.return_value = [
        {
            "lat": "-27.7776389",
            "lon": "-64.2651711",
            "display_name": "781, Perú, Santiago del Estero, Santiago del Estero, Argentina",
            "address": {
                "road": "Perú",
                "house_number": "781",
                "city": "Santiago del Estero",
                "state": "Santiago del Estero",
            },
        },
        {
            "lat": "-34.6169452",
            "lon": "-58.3745265",
            "display_name": "781, Perú, San Telmo, Buenos Aires, Argentina",
            "address": {
                "road": "Perú",
                "house_number": "781",
                "city": "Buenos Aires",
                "state": "Ciudad Autónoma de Buenos Aires",
            },
        },
    ]

    with patch(
        "geocodificacion.services.nominatim.requests.get", side_effect=[vacio, nacional]
    ) as get:
        result = NominatimClient().search_exact(
            "Perú", "781", "Santiago del Estero", "Santiago del Estero"
        )

    assert len(result) == 1
    assert result[0]["lat"] == -27.7776389
    assert get.call_count == 2
    assert get.call_args_list[1].kwargs["params"]["limit"] == 40
    assert "city" not in get.call_args_list[1].kwargs["params"]


def _here_item(house_number="781", house_number_type="interpolated", state="Santiago del Estero"):
    return {
        "title": f"Perú {house_number}, G4200 Santiago del Estero, Argentina",
        "resultType": "houseNumber",
        "houseNumberType": house_number_type,
        "address": {
            "label": f"Perú {house_number}, G4200 Santiago del Estero, Argentina",
            "countryCode": "ARG",
            "state": state,
            "county": "Santiago del Estero",
            "city": "Santiago del Estero",
            "street": "Perú",
            "houseNumber": str(house_number),
        },
        "position": {"lat": -27.77751, "lng": -64.26501},
        "scoring": {"queryScore": 1.0},
    }


def _mock_here_429(retry_after=None):
    mock = MagicMock()
    mock.status_code = 429
    mock.text = ""
    mock.headers = {} if retry_after is None else {"Retry-After": str(retry_after)}
    return mock


def _here_candidate(interpolada=True):
    return {
        "lat": -27.77751,
        "lng": -64.26501,
        "direccion": "Perú 781, G4200 Santiago del Estero, Argentina",
        "provincia": "Santiago del Estero",
        "localidad": "Santiago del Estero",
        "departamento": "Santiago del Estero",
        "aproximada": True,
        "_numero": 781,
        "_interpolada": interpolada,
    }


def test_here_client_interpolado(monkeypatch):
    from geocodificacion.services.here import HereClient

    monkeypatch.setattr("django.conf.settings.HERE_ENABLED", True)
    monkeypatch.setattr("django.conf.settings.HERE_API_KEY", "test-key")
    response = _mock_response({"items": [_here_item()]})
    with patch("geocodificacion.services.here.requests.get", return_value=response) as get:
        result = HereClient().search_exact(
            "Perú", "781", "Santiago del Estero", "Santiago del Estero"
        )
    assert len(result) == 1
    assert result[0]["_interpolada"] is True
    assert result[0]["_numero"] == 781
    assert result[0]["aproximada"] is True
    params = get.call_args.kwargs["params"]
    assert params["apiKey"] == "test-key"
    assert "781" in params["q"]


def test_here_client_pa_es_exacto(monkeypatch):
    from geocodificacion.services.here import HereClient

    monkeypatch.setattr("django.conf.settings.HERE_ENABLED", True)
    monkeypatch.setattr("django.conf.settings.HERE_API_KEY", "test-key")
    response = _mock_response({"items": [_here_item(house_number_type="PA")]})
    with patch("geocodificacion.services.here.requests.get", return_value=response):
        result = HereClient().search_exact(
            "Perú", "781", "Santiago del Estero", "Santiago del Estero"
        )
    assert len(result) == 1
    assert result[0]["_interpolada"] is False


def test_here_client_rechaza_otra_provincia_u_otro_numero(monkeypatch):
    from geocodificacion.services.here import HereClient

    monkeypatch.setattr("django.conf.settings.HERE_ENABLED", True)
    monkeypatch.setattr("django.conf.settings.HERE_API_KEY", "test-key")
    response = _mock_response({"items": [
        _here_item(house_number="781", state="Córdoba"),
        _here_item(house_number="780"),
    ]})
    with patch("geocodificacion.services.here.requests.get", return_value=response):
        result = HereClient().search_exact(
            "Perú", "781", "Santiago del Estero", "Santiago del Estero"
        )
    assert result == []


def test_here_client_deshabilitado_no_consulta(monkeypatch):
    from geocodificacion.services.here import HereClient

    monkeypatch.setattr("django.conf.settings.HERE_ENABLED", False)
    with patch("geocodificacion.services.here.requests.get") as get:
        result = HereClient().search_exact(
            "Perú", "781", "Santiago del Estero", "Santiago del Estero"
        )
    assert result == []
    get.assert_not_called()


def test_here_client_reintenta_429(monkeypatch):
    from geocodificacion.services.here import HereClient

    monkeypatch.setattr("django.conf.settings.HERE_ENABLED", True)
    monkeypatch.setattr("django.conf.settings.HERE_API_KEY", "test-key")
    monkeypatch.setattr("django.conf.settings.HERE_MAX_RETRIES", 1)
    monkeypatch.setattr("django.conf.settings.HERE_RETRY_DELAY", 0.0)
    with patch(
        "geocodificacion.services.here.requests.get",
        side_effect=[_mock_here_429(retry_after=0), _mock_response({"items": [_here_item()]})],
    ) as get:
        result = HereClient().search_exact(
            "Perú", "781", "Santiago del Estero", "Santiago del Estero"
        )
    assert len(result) == 1
    assert result[0]["_interpolada"] is True
    assert get.call_count == 2


def test_here_client_429_persistente(monkeypatch):
    from geocodificacion.services.here import HereClient, HereServiceError

    monkeypatch.setattr("django.conf.settings.HERE_ENABLED", True)
    monkeypatch.setattr("django.conf.settings.HERE_API_KEY", "test-key")
    monkeypatch.setattr("django.conf.settings.HERE_MAX_RETRIES", 1)
    monkeypatch.setattr("django.conf.settings.HERE_RETRY_DELAY", 0.0)
    with patch(
        "geocodificacion.services.here.requests.get",
        side_effect=[_mock_here_429(retry_after=0), _mock_here_429(retry_after=0)],
    ):
        with pytest.raises(HereServiceError):
            HereClient().search_exact(
                "Perú", "781", "Santiago del Estero", "Santiago del Estero"
            )


def test_geocodificar_usa_here_exacto(client):
    with patch("geocodificacion.services.georef.GeorefClient.provincias", return_value=["Santiago del Estero"]), \
         patch("geocodificacion.services.georef.GeorefClient.geocodificar", return_value=[]), \
         patch("geocodificacion.services.nominatim.NominatimClient.search_exact", return_value=[]), \
         patch("geocodificacion.services.here.HereClient.search_exact", return_value=[_here_candidate(False)]), \
         patch("geocodificacion.services.nominatim.NominatimClient.search_nearby") as nearby:
        res = client.post("/api/geocodificar/", {
            "calle": "Perú", "numero": "781",
            "ciudad": "Santiago del Estero", "provincia": "Santiago del Estero",
        }, content_type="application/json")
    assert res.status_code == 200
    assert res.json()["resultados"][0]["lat"] == -27.77751
    assert "_interpolada" not in res.json()["resultados"][0]
    nearby.assert_not_called()


def test_geocodificar_here_interpolado_es_sugerencia(client):
    with patch("geocodificacion.services.georef.GeorefClient.provincias", return_value=["Santiago del Estero"]), \
         patch("geocodificacion.services.georef.GeorefClient.geocodificar", return_value=[]), \
         patch("geocodificacion.services.nominatim.NominatimClient.search_exact", return_value=[]), \
         patch("geocodificacion.services.here.HereClient.search_exact", return_value=[_here_candidate(True)]), \
         patch("geocodificacion.services.nominatim.NominatimClient.search_nearby", return_value=[
             {"lat": -27.7776466, "lng": -64.265164, "direccion": "780, Perú, Santiago del Estero",
              "provincia": "Santiago del Estero", "localidad": "Santiago del Estero",
              "departamento": "Capital", "aproximada": True},
         ]):
        res = client.post("/api/geocodificar/", {
            "calle": "Perú", "numero": "781",
            "ciudad": "Santiago del Estero", "provincia": "Santiago del Estero",
        }, content_type="application/json")
    assert res.status_code == 404
    sugerencias = res.json()["error"]["sugerencias"]
    assert len(sugerencias) == 2
    assert sugerencias[0]["direccion"].startswith("Perú 781")
    assert "_interpolada" not in sugerencias[0]


def test_geocodificar_here_error_no_rompe(client):
    from geocodificacion.services.here import HereServiceError

    with patch("geocodificacion.services.georef.GeorefClient.provincias", return_value=["Santiago del Estero"]), \
         patch("geocodificacion.services.georef.GeorefClient.geocodificar", return_value=[]), \
         patch("geocodificacion.services.nominatim.NominatimClient.search_exact", return_value=[]), \
         patch("geocodificacion.services.here.HereClient.search_exact", side_effect=HereServiceError("down")), \
         patch("geocodificacion.services.nominatim.NominatimClient.search_nearby", return_value=[
             {"lat": -27.7776466, "lng": -64.265164, "direccion": "780, Perú, Santiago del Estero",
              "provincia": "Santiago del Estero", "localidad": "Santiago del Estero",
              "departamento": "Capital", "aproximada": True},
         ]):
        res = client.post("/api/geocodificar/", {
            "calle": "Perú", "numero": "781",
            "ciudad": "Santiago del Estero", "provincia": "Santiago del Estero",
        }, content_type="application/json")
    assert res.status_code == 404
    assert res.json()["error"]["sugerencias"][0]["direccion"].startswith("780")


def _puntos_ruta():
    return [
        {"lat": -27.784, "lng": -64.267},
        {"lat": -27.782, "lng": -64.265},
    ]


def _puntos_ruta_3():
    return [
        {"lat": -27.784, "lng": -64.267},
        {"lat": -27.782, "lng": -64.265},
        {"lat": -27.780, "lng": -64.270},
    ]


def _puntos_ruta_4():
    return [
        {"lat": -27.784, "lng": -64.267},
        {"lat": -27.782, "lng": -64.265},
        {"lat": -27.780, "lng": -64.270},
        {"lat": -27.775, "lng": -64.260},
    ]


def _vroom_payload(jobs=(1, 2), unassigned=0):
    steps = [{"type": "start", "location": [-64.267, -27.784]}]
    for job in jobs:
        steps.append({"type": "job", "job": job, "location": [-64.265, -27.782]})
    steps.append({"type": "end", "location": [-64.265, -27.782]})
    return {
        "code": 0,
        "summary": {"unassigned": unassigned, "routes": 1},
        "routes": [{"steps": steps}],
    }


def _route_payload():
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "summary": {"distance": 2450.4, "duration": 1800},
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[-64.267, -27.784], [-64.265, -27.782]],
                },
            }
        ],
    }


def _mock_route_response(payload=None, status_code=200):
    mock = MagicMock()
    mock.status_code = status_code
    mock.json.return_value = payload if payload is not None else _route_payload()
    mock.text = "SECRET-PROVIDER-BODY"
    return mock


def test_ruta_ok(client, monkeypatch):
    monkeypatch.setattr("django.conf.settings.ROUTING_ENABLED", True)
    monkeypatch.setattr("django.conf.settings.ROUTING_API_KEY", "test-key")
    with patch("geocodificacion.services.routing.requests.post",
               return_value=_mock_route_response()) as post:
        res = client.post("/api/ruta/", {
            "puntos": _puntos_ruta(),
            "perfil": "walking",
        }, content_type="application/json")
    assert res.status_code == 200
    body = res.json()
    assert body["distancia_metros"] == 2450.4
    assert body["duracion_segundos"] == 1800
    assert body["orden"] == [0, 1]
    assert body["ruta"]["features"][0]["geometry"]["type"] == "LineString"
    args, kwargs = post.call_args
    assert args[0].endswith("/foot-walking/geojson")
    assert kwargs["headers"]["Authorization"] == "test-key"
    assert kwargs["json"]["coordinates"] == [[-64.267, -27.784], [-64.265, -27.782]]


def test_ruta_usa_perfil_driving(client, monkeypatch):
    monkeypatch.setattr("django.conf.settings.ROUTING_ENABLED", True)
    monkeypatch.setattr("django.conf.settings.ROUTING_API_KEY", "test-key")
    with patch("geocodificacion.services.routing.requests.post",
               return_value=_mock_route_response()) as post:
        res = client.post("/api/ruta/", {
            "puntos": _puntos_ruta(),
            "perfil": "driving",
        }, content_type="application/json")
    assert res.status_code == 200
    assert post.call_args.args[0].endswith("/driving-car/geojson")


def test_ruta_cachea_la_misma_consulta(client, monkeypatch):
    monkeypatch.setattr("django.conf.settings.ROUTING_ENABLED", True)
    monkeypatch.setattr("django.conf.settings.ROUTING_API_KEY", "test-key")
    with patch("geocodificacion.services.routing.requests.post",
               return_value=_mock_route_response()) as post:
        client.post("/api/ruta/", {"puntos": _puntos_ruta()}, content_type="application/json")
        client.post("/api/ruta/", {"puntos": _puntos_ruta()}, content_type="application/json")
    assert post.call_count == 1


def test_ruta_volver_al_inicio(client, monkeypatch):
    monkeypatch.setattr("django.conf.settings.ROUTING_ENABLED", True)
    monkeypatch.setattr("django.conf.settings.ROUTING_API_KEY", "test-key")
    with patch("geocodificacion.services.routing.requests.post",
               return_value=_mock_route_response()) as post:
        res = client.post("/api/ruta/", {
            "puntos": _puntos_ruta(),
            "volver_al_inicio": True,
        }, content_type="application/json")
    assert res.status_code == 200
    assert res.json()["orden"] == [0, 1, 0]
    coords = post.call_args.kwargs["json"]["coordinates"]
    assert coords == [[-64.267, -27.784], [-64.265, -27.782], [-64.267, -27.784]]


def test_ruta_optimizar_ok(client, monkeypatch):
    monkeypatch.setattr("django.conf.settings.ROUTING_ENABLED", True)
    monkeypatch.setattr("django.conf.settings.ROUTING_API_KEY", "test-key")
    with patch(
        "geocodificacion.services.routing.requests.post",
        side_effect=[
            _mock_route_response(_vroom_payload((2, 1))),
            _mock_route_response(),
        ],
    ) as post:
        res = client.post("/api/ruta/", {
            "puntos": _puntos_ruta_3(),
            "optimizar": True,
        }, content_type="application/json")
    assert res.status_code == 200
    assert res.json()["orden"] == [0, 2, 1]
    llamadas = post.call_args_list
    assert llamadas[0].args[0].endswith("/vroom/v0")
    assert llamadas[0].kwargs["json"]["vehicles"][0] == {
        "id": 0, "profile": "foot-walking", "start": [-64.267, -27.784],
    }
    assert [j["id"] for j in llamadas[0].kwargs["json"]["jobs"]] == [1, 2]
    assert llamadas[1].args[0].endswith("/foot-walking/geojson")
    assert llamadas[1].kwargs["json"]["coordinates"] == [
        [-64.267, -27.784], [-64.27, -27.78], [-64.265, -27.782],
    ]


def test_ruta_orden_fijo_con_fin(client, monkeypatch):
    monkeypatch.setattr("django.conf.settings.ROUTING_ENABLED", True)
    monkeypatch.setattr("django.conf.settings.ROUTING_API_KEY", "test-key")
    with patch("geocodificacion.services.routing.requests.post",
               return_value=_mock_route_response()) as post:
        res = client.post("/api/ruta/", {
            "puntos": _puntos_ruta_3(),
            "fin": 1,
        }, content_type="application/json")
    assert res.status_code == 200
    assert res.json()["orden"] == [0, 2, 1]
    assert post.call_args.kwargs["json"]["coordinates"] == [
        [-64.267, -27.784], [-64.27, -27.78], [-64.265, -27.782],
    ]


def test_ruta_optimizar_con_fin(client, monkeypatch):
    monkeypatch.setattr("django.conf.settings.ROUTING_ENABLED", True)
    monkeypatch.setattr("django.conf.settings.ROUTING_API_KEY", "test-key")
    with patch(
        "geocodificacion.services.routing.requests.post",
        side_effect=[
            _mock_route_response(_vroom_payload((2, 1))),
            _mock_route_response(),
        ],
    ) as post:
        res = client.post("/api/ruta/", {
            "puntos": _puntos_ruta_4(),
            "optimizar": True,
            "fin": 3,
        }, content_type="application/json")
    assert res.status_code == 200
    assert res.json()["orden"] == [0, 2, 1, 3]
    vehiculo = post.call_args_list[0].kwargs["json"]["vehicles"][0]
    assert vehiculo["end"] == [-64.26, -27.775]
    assert [j["id"] for j in post.call_args_list[0].kwargs["json"]["jobs"]] == [1, 2]
    assert post.call_args_list[1].kwargs["json"]["coordinates"] == [
        [-64.267, -27.784], [-64.27, -27.78], [-64.265, -27.782], [-64.26, -27.775],
    ]


def test_ruta_optimizar_con_fin_y_sin_intermedios(client, monkeypatch):
    monkeypatch.setattr("django.conf.settings.ROUTING_ENABLED", True)
    monkeypatch.setattr("django.conf.settings.ROUTING_API_KEY", "test-key")
    with patch("geocodificacion.services.routing.requests.post",
               return_value=_mock_route_response()) as post:
        res = client.post("/api/ruta/", {
            "puntos": _puntos_ruta(),
            "optimizar": True,
            "fin": 1,
        }, content_type="application/json")
    assert res.status_code == 200
    assert res.json()["orden"] == [0, 1]
    assert post.call_count == 1
    assert post.call_args.args[0].endswith("/foot-walking/geojson")


def test_ruta_fin_invalido(client, monkeypatch):
    monkeypatch.setattr("django.conf.settings.ROUTING_ENABLED", True)
    monkeypatch.setattr("django.conf.settings.ROUTING_API_KEY", "test-key")
    for body in (
        {"puntos": _puntos_ruta_3(), "fin": 0},
        {"puntos": _puntos_ruta_3(), "fin": 3},
        {"puntos": _puntos_ruta_3(), "fin": 1, "volver_al_inicio": True},
    ):
        res = client.post("/api/ruta/", body, content_type="application/json")
        assert res.status_code == 400
        assert "fin" in res.json()["error"]["campos"]


def test_ruta_optimizar_volver_al_inicio(client, monkeypatch):
    monkeypatch.setattr("django.conf.settings.ROUTING_ENABLED", True)
    monkeypatch.setattr("django.conf.settings.ROUTING_API_KEY", "test-key")
    with patch(
        "geocodificacion.services.routing.requests.post",
        side_effect=[
            _mock_route_response(_vroom_payload((2, 1))),
            _mock_route_response(),
        ],
    ) as post:
        res = client.post("/api/ruta/", {
            "puntos": _puntos_ruta_3(),
            "optimizar": True,
            "volver_al_inicio": True,
        }, content_type="application/json")
    assert res.status_code == 200
    assert res.json()["orden"] == [0, 2, 1, 0]
    vehiculo = post.call_args_list[0].kwargs["json"]["vehicles"][0]
    assert vehiculo["end"] == vehiculo["start"]
    coords = post.call_args_list[1].kwargs["json"]["coordinates"]
    assert coords[-1] == coords[0]


def test_ruta_optimizar_cachea_orden_y_ruta(client, monkeypatch):
    monkeypatch.setattr("django.conf.settings.ROUTING_ENABLED", True)
    monkeypatch.setattr("django.conf.settings.ROUTING_API_KEY", "test-key")
    with patch(
        "geocodificacion.services.routing.requests.post",
        side_effect=[
            _mock_route_response(_vroom_payload((2, 1))),
            _mock_route_response(),
        ],
    ) as post:
        client.post("/api/ruta/", {"puntos": _puntos_ruta_3(), "optimizar": True}, content_type="application/json")
        client.post("/api/ruta/", {"puntos": _puntos_ruta_3(), "optimizar": True}, content_type="application/json")
    assert post.call_count == 2


def test_ruta_optimizar_deja_puntos_sin_asignar(client, monkeypatch):
    monkeypatch.setattr("django.conf.settings.ROUTING_ENABLED", True)
    monkeypatch.setattr("django.conf.settings.ROUTING_API_KEY", "test-key")
    with patch(
        "geocodificacion.services.routing.requests.post",
        return_value=_mock_route_response(_vroom_payload((2, 1), unassigned=1)),
    ):
        res = client.post("/api/ruta/", {
            "puntos": _puntos_ruta_3(),
            "optimizar": True,
        }, content_type="application/json")
    assert res.status_code == 502
    assert res.json()["error"]["codigo"] == "routing_no_disponible"


def test_ruta_optimizar_no_incluye_todas_las_huellas(client, monkeypatch):
    monkeypatch.setattr("django.conf.settings.ROUTING_ENABLED", True)
    monkeypatch.setattr("django.conf.settings.ROUTING_API_KEY", "test-key")
    with patch(
        "geocodificacion.services.routing.requests.post",
        return_value=_mock_route_response(_vroom_payload((1,))),
    ):
        res = client.post("/api/ruta/", {
            "puntos": _puntos_ruta_3(),
            "optimizar": True,
        }, content_type="application/json")
    assert res.status_code == 502


def test_ruta_sin_configurar(client):
    with patch("geocodificacion.services.routing.requests.post") as post:
        res = client.post("/api/ruta/", {"puntos": _puntos_ruta()}, content_type="application/json")
    assert res.status_code == 503
    assert res.json()["error"]["codigo"] == "routing_no_configurado"
    post.assert_not_called()


def test_ruta_sin_api_key(client, monkeypatch):
    monkeypatch.setattr("django.conf.settings.ROUTING_ENABLED", True)
    with patch("geocodificacion.services.routing.requests.post") as post:
        res = client.post("/api/ruta/", {"puntos": _puntos_ruta()}, content_type="application/json")
    assert res.status_code == 503
    post.assert_not_called()


def test_ruta_perfil_invalido(client, monkeypatch):
    monkeypatch.setattr("django.conf.settings.ROUTING_ENABLED", True)
    monkeypatch.setattr("django.conf.settings.ROUTING_API_KEY", "test-key")
    with patch("geocodificacion.services.routing.requests.post") as post:
        res = client.post("/api/ruta/", {
            "puntos": _puntos_ruta(),
            "perfil": "flying",
        }, content_type="application/json")
    assert res.status_code == 400
    assert "perfil" in res.json()["error"]["campos"]
    post.assert_not_called()


def test_ruta_pocos_puntos(client, monkeypatch):
    monkeypatch.setattr("django.conf.settings.ROUTING_ENABLED", True)
    monkeypatch.setattr("django.conf.settings.ROUTING_API_KEY", "test-key")
    res = client.post("/api/ruta/", {
        "puntos": [{"lat": -27.78, "lng": -64.26}],
    }, content_type="application/json")
    assert res.status_code == 400


def test_ruta_demasiados_puntos(client, monkeypatch):
    monkeypatch.setattr("django.conf.settings.ROUTING_ENABLED", True)
    monkeypatch.setattr("django.conf.settings.ROUTING_API_KEY", "test-key")
    puntos = [{"lat": -27.78, "lng": -64.26} for _ in range(21)]
    res = client.post("/api/ruta/", {"puntos": puntos}, content_type="application/json")
    assert res.status_code == 400


def test_ruta_punto_fuera_de_argentina(client, monkeypatch):
    monkeypatch.setattr("django.conf.settings.ROUTING_ENABLED", True)
    monkeypatch.setattr("django.conf.settings.ROUTING_API_KEY", "test-key")
    res = client.post("/api/ruta/", {
        "puntos": [{"lat": 0, "lng": 0}, {"lat": -27.78, "lng": -64.26}],
    }, content_type="application/json")
    assert res.status_code == 400
    assert "puntos" in res.json()["error"]["campos"]


def test_ruta_proveedor_http_error(client, monkeypatch, caplog):
    import logging
    caplog.set_level(logging.WARNING, logger="geocodificacion.services.routing")
    monkeypatch.setattr("django.conf.settings.ROUTING_ENABLED", True)
    monkeypatch.setattr("django.conf.settings.ROUTING_API_KEY", "test-key")
    with patch("geocodificacion.services.routing.requests.post",
               return_value=_mock_route_response(status_code=500)):
        res = client.post("/api/ruta/", {"puntos": _puntos_ruta()}, content_type="application/json")
    assert res.status_code == 502
    assert res.json()["error"]["codigo"] == "routing_no_disponible"
    assert "SECRET-PROVIDER-BODY" not in caplog.text


def test_ruta_proveedor_json_invalido(client, monkeypatch):
    monkeypatch.setattr("django.conf.settings.ROUTING_ENABLED", True)
    monkeypatch.setattr("django.conf.settings.ROUTING_API_KEY", "test-key")
    mock = _mock_route_response()
    mock.json.side_effect = ValueError("bad json")
    with patch("geocodificacion.services.routing.requests.post", return_value=mock):
        res = client.post("/api/ruta/", {"puntos": _puntos_ruta()}, content_type="application/json")
    assert res.status_code == 502


def test_ruta_proveedor_sin_linea(client, monkeypatch):
    monkeypatch.setattr("django.conf.settings.ROUTING_ENABLED", True)
    monkeypatch.setattr("django.conf.settings.ROUTING_API_KEY", "test-key")
    with patch("geocodificacion.services.routing.requests.post",
               return_value=_mock_route_response({"features": []})):
        res = client.post("/api/ruta/", {"puntos": _puntos_ruta()}, content_type="application/json")
    assert res.status_code == 502


def test_ruta_suma_segmentos_si_falta_summary(client, monkeypatch):
    monkeypatch.setattr("django.conf.settings.ROUTING_ENABLED", True)
    monkeypatch.setattr("django.conf.settings.ROUTING_API_KEY", "test-key")
    payload = _route_payload()
    payload["features"][0]["properties"] = {
        "segments": [
            {"distance": 100.5, "duration": 10},
            {"distance": 200.5, "duration": 20},
        ]
    }
    with patch("geocodificacion.services.routing.requests.post",
               return_value=_mock_route_response(payload)):
        res = client.post("/api/ruta/", {"puntos": _puntos_ruta()}, content_type="application/json")
    assert res.status_code == 200
    assert res.json()["distancia_metros"] == 301.0
    assert res.json()["duracion_segundos"] == 30


def test_ruta_proveedor_timeout(client, monkeypatch):
    import requests as req
    monkeypatch.setattr("django.conf.settings.ROUTING_ENABLED", True)
    monkeypatch.setattr("django.conf.settings.ROUTING_API_KEY", "test-key")
    with patch("geocodificacion.services.routing.requests.post",
               side_effect=req.Timeout("timeout")):
        res = client.post("/api/ruta/", {"puntos": _puntos_ruta()}, content_type="application/json")
    assert res.status_code == 502


def _places_item(title="Ibra Bar", category="Bar o pub", distance=31, lat=-27.7774, lng=-64.2649):
    return {
        "id": f"place:{title}",
        "title": title,
        "resultType": "place",
        "distance": distance,
        "position": {"lat": lat, "lng": lng},
        "address": {"label": f"{title}, Santiago del Estero, Argentina"},
        "categories": [{"id": "100", "name": category, "primary": True}],
    }


def _places_payload(items=None):
    return {"items": items if items is not None else [_places_item()]}


def test_lugares_cercanos_ok(client, monkeypatch):
    monkeypatch.setattr("django.conf.settings.HERE_PLACES_ENABLED", True)
    monkeypatch.setattr("django.conf.settings.HERE_API_KEY", "test-key")
    with patch("geocodificacion.services.places.requests.get",
               return_value=_mock_response(_places_payload())) as get:
        res = client.get("/api/lugares-cercanos/", {
            "lat": "-27.77751", "lng": "-64.26501", "limit": 5,
        })
    assert res.status_code == 200
    lugares = res.json()["lugares"]
    assert lugares == [{
        "id": "place:Ibra Bar",
        "nombre": "Ibra Bar",
        "categoria": "Bar o pub",
        "distancia_metros": 31.0,
        "direccion": "Ibra Bar, Santiago del Estero, Argentina",
        "lat": -27.7774,
        "lng": -64.2649,
    }]
    params = get.call_args.kwargs["params"]
    assert params["apiKey"] == "test-key"
    assert params["at"] == "-27.77751,-64.26501"
    assert params["limit"] == 5


def test_lugares_cercanos_cachea(client, monkeypatch):
    monkeypatch.setattr("django.conf.settings.HERE_PLACES_ENABLED", True)
    monkeypatch.setattr("django.conf.settings.HERE_API_KEY", "test-key")
    with patch("geocodificacion.services.places.requests.get",
               return_value=_mock_response(_places_payload())) as get:
        client.get("/api/lugares-cercanos/", {"lat": "-27.77751", "lng": "-64.26501"})
        client.get("/api/lugares-cercanos/", {"lat": "-27.77751", "lng": "-64.26501"})
    assert get.call_count == 1


def test_lugares_cercanos_sin_configurar(client):
    with patch("geocodificacion.services.places.requests.get") as get:
        res = client.get("/api/lugares-cercanos/", {"lat": "-27.77751", "lng": "-64.26501"})
    assert res.status_code == 503
    assert res.json()["error"]["codigo"] == "lugares_no_configurado"
    get.assert_not_called()


def test_lugares_cercanos_fuera_de_rango(client, monkeypatch):
    monkeypatch.setattr("django.conf.settings.HERE_PLACES_ENABLED", True)
    monkeypatch.setattr("django.conf.settings.HERE_API_KEY", "test-key")
    res = client.get("/api/lugares-cercanos/", {"lat": "0", "lng": "0"})
    assert res.status_code == 400


def test_lugares_cercanos_proveedor_error(client, monkeypatch, caplog):
    import logging
    caplog.set_level(logging.WARNING, logger="geocodificacion.services.places")
    monkeypatch.setattr("django.conf.settings.HERE_PLACES_ENABLED", True)
    monkeypatch.setattr("django.conf.settings.HERE_API_KEY", "test-key")
    mock = MagicMock()
    mock.status_code = 500
    mock.text = "SECRET-PLACES-BODY"
    mock.headers = {}
    with patch("geocodificacion.services.places.requests.get", return_value=mock):
        res = client.get("/api/lugares-cercanos/", {"lat": "-27.77751", "lng": "-64.26501"})
    assert res.status_code == 502
    assert res.json()["error"]["codigo"] == "lugares_no_disponible"
    assert "SECRET-PLACES-BODY" not in caplog.text


# ---------------------------------------------------------------------------
# Geocodificación en lote — POST /api/geocodificar-lote/ (v0.2.0, B1.1–B1.5)
# ---------------------------------------------------------------------------

LOTE_PROVINCIAS = ["Santiago del Estero", "Buenos Aires", "Córdoba"]


def _fila(indice, calle="Perú", altura="781", ciudad="Santiago del Estero",
          provincia="Santiago del Estero", id_=None):
    return {
        "id": id_ if id_ is not None else f"fila-{indice}",
        "calle": calle,
        "altura": altura,
        "ciudad": ciudad,
        "provincia": provincia,
    }


def _georef_candidato(lat, lng, nomenclatura=None, localidad="Santiago del Estero"):
    return {
        "lat": lat,
        "lng": lng,
        "direccion": nomenclatura,
        "provincia": "Santiago del Estero",
        "localidad": localidad,
        "departamento": "Capital",
        "aproximada": True,
    }


def _mock_servicio(valor, error=None):
    """MagicMock para un método de servicio: callable -> side_effect."""
    if error is not None:
        return MagicMock(side_effect=error)
    if callable(valor):
        return MagicMock(side_effect=valor)
    return MagicMock(return_value=list(valor or []))


def _entorno_lote(geocodificar=None, provincias=None, nominatim_exact=None,
                  nominatim_nearby=None, here=None, geocodificar_error=None,
                  provincias_error=None, nominatim_exact_error=None,
                  nominatim_nearby_error=None, here_error=None):
    """Patchea Georef/Nominatim/HERE para ejercitar el endpoint de lote."""
    from contextlib import ExitStack

    stack = ExitStack()
    calls = {
        "provincias": stack.enter_context(patch(
            "geocodificacion.services.georef.GeorefClient.provincias",
            _mock_servicio(LOTE_PROVINCIAS if provincias is None else provincias,
                           provincias_error),
        )),
        "geocodificar": stack.enter_context(patch(
            "geocodificacion.services.georef.GeorefClient.geocodificar",
            _mock_servicio(geocodificar, geocodificar_error),
        )),
        "nominatim_exact": stack.enter_context(patch(
            "geocodificacion.services.nominatim.NominatimClient.search_exact",
            _mock_servicio(nominatim_exact, nominatim_exact_error),
        )),
        "nominatim_nearby": stack.enter_context(patch(
            "geocodificacion.services.nominatim.NominatimClient.search_nearby",
            _mock_servicio(nominatim_nearby, nominatim_nearby_error),
        )),
        "here": stack.enter_context(patch(
            "geocodificacion.services.here.HereClient.search_exact",
            _mock_servicio(here, here_error),
        )),
    }
    return stack, calls


def _post_lote(client, filas):
    return client.post(
        "/api/geocodificar-lote/", {"filas": filas}, content_type="application/json"
    )


def test_settings_lote_defaults():
    from django.conf import settings
    assert settings.IMPORT_MAX_FILAS == 100
    assert settings.GEOCODIFICAR_LOTE_MAX == 10


def test_env_example_documenta_topes_de_lote():
    from pathlib import Path
    env = Path(__file__).resolve().parent.parent / ".env.example"
    texto = env.read_text(encoding="utf-8")
    assert "IMPORT_MAX_FILAS=100" in texto
    assert "GEOCODIFICAR_LOTE_MAX=10" in texto


def test_lote_fila_no_objeto_rechaza_sin_consultar_provincias(client):
    from geocodificacion.services.georef import GeorefServiceError

    stack, calls = _entorno_lote(
        provincias_error=GeorefServiceError("no debería consultar Georef")
    )
    with stack:
        res = _post_lote(client, [None])

    assert res.status_code == 400
    assert res.json()["error"]["codigo"] == "solicitud_invalida"
    calls["provincias"].assert_not_called()
    calls["geocodificar"].assert_not_called()


def test_lote_validacion_local_precede_falla_de_georef(client):
    from geocodificacion.services.georef import GeorefServiceError

    stack, calls = _entorno_lote(
        provincias_error=GeorefServiceError("Georef no disponible")
    )
    with stack:
        res = _post_lote(client, [dict(_fila(1), altura="78²")])

    assert res.status_code == 400
    assert "filas[0].altura" in res.json()["error"]["campos"]
    calls["provincias"].assert_not_called()
    calls["geocodificar"].assert_not_called()


def test_lote_id_debe_ser_texto_y_altura_ascii(client):
    stack, calls = _entorno_lote()
    with stack:
        id_numerico = _post_lote(client, [dict(_fila(1), id=123)])
        altura_unicode = _post_lote(client, [dict(_fila(2), altura="٧٨١")])

    assert id_numerico.status_code == 400
    assert "filas[0].id" in id_numerico.json()["error"]["campos"]
    assert altura_unicode.status_code == 400
    assert "filas[0].altura" in altura_unicode.json()["error"]["campos"]
    calls["geocodificar"].assert_not_called()


def test_lote_mixto_conserva_orden_ids_y_estados(client):
    from geocodificacion.services.georef import GeorefServiceError

    def geocodificar(calle, numero, ciudad, provincia):
        if calle == "Perú":
            return [_georef_candidato(-27.7775, -64.2650, "PERU 781")]
        if calle == "Libertad":
            return [
                _georef_candidato(-27.7885, -64.2621, "LIBERTAD 630"),
                _georef_candidato(-27.7886, -64.2622, "LIBERTAD 631"),
            ]
        if calle == "SinCalle":
            return []
        raise GeorefServiceError("timeout_or_network")

    filas = [
        _fila(1, calle="Perú"),
        _fila(2, calle="Libertad"),
        _fila(3, calle="SinCalle"),
        _fila(4, calle="Rota"),
    ]
    stack, calls = _entorno_lote(geocodificar=geocodificar)
    with stack:
        res = _post_lote(client, filas)

    assert res.status_code == 200
    body = res.json()["resultados"]
    assert [r["id"] for r in body] == ["fila-1", "fila-2", "fila-3", "fila-4"]
    assert [r["estado"] for r in body] == [
        "encontrada", "ambigua", "sin_resultado", "error",
    ]
    assert calls["geocodificar"].call_count == 4
    assert [c.args[0] for c in calls["geocodificar"].call_args_list] == [
        "Perú", "Libertad", "SinCalle", "Rota",
    ]

    # Candidato exacto: forma pública del contrato + proveedor.
    candidato = body[0]["candidatos"][0]
    assert set(candidato) == {
        "lat", "lng", "nombre", "direccion", "proveedor", "aproximada",
    }
    assert candidato["proveedor"] == "georef"
    assert candidato["aproximada"] is False
    assert candidato["nombre"] is None
    assert candidato["lat"] == -27.7775

    assert len(body[1]["candidatos"]) == 2
    assert all(c["proveedor"] == "georef" for c in body[1]["candidatos"])

    assert body[2]["candidatos"] == []
    assert body[2]["mensaje"] is None

    assert body[3]["candidatos"] == []
    assert body[3]["mensaje"]
    assert "http" not in body[3]["mensaje"].lower()
    assert "Traceback" not in body[3]["mensaje"]


def test_lote_proveedores_y_aproximados(client):
    def nominatim_exact(calle, numero, ciudad, provincia):
        if calle == "Corrientes":
            return [_fallback_candidate(1000, street="Avenida Corrientes")]
        return []

    def here(calle, numero, ciudad, provincia):
        if calle == "Perú":
            return [dict(_here_candidate(interpolada=False), _nombre="Perú 781")]
        if calle == "Belgrano":
            return [dict(_here_candidate(interpolada=True), _nombre="Belgrano 320")]
        return []

    filas = [
        _fila(1, calle="Corrientes", altura="1000"),
        _fila(2, calle="Perú"),
        _fila(3, calle="Belgrano", altura="320"),
    ]
    stack, _ = _entorno_lote(
        geocodificar=[], nominatim_exact=nominatim_exact, here=here
    )
    with stack:
        res = _post_lote(client, filas)

    assert res.status_code == 200
    body = res.json()["resultados"]

    # Nominatim exacto -> encontrada, proveedor nominatim, no aproximada.
    assert body[0]["estado"] == "encontrada"
    cand = body[0]["candidatos"][0]
    assert cand["proveedor"] == "nominatim"
    assert cand["aproximada"] is False
    assert cand["nombre"] is None
    assert cand["direccion"].startswith("Avenida Corrientes 1000")

    # HERE PA/MPA -> exacto, con nombre corto del proveedor.
    assert body[1]["estado"] == "encontrada"
    cand = body[1]["candidatos"][0]
    assert cand["proveedor"] == "here"
    assert cand["aproximada"] is False
    assert cand["nombre"] == "Perú 781"

    # HERE interpolado -> siempre ambigua y marcado aproximado.
    assert body[2]["estado"] == "ambigua"
    cand = body[2]["candidatos"][0]
    assert cand["proveedor"] == "here"
    assert cand["aproximada"] is True


def test_lote_aproximados_priorizan_here_y_no_duplican(client):
    cercanas = [
        _fallback_candidate(780, city="Santiago del Estero", state="Santiago del Estero"),
        _fallback_candidate(782, city="Santiago del Estero", state="Santiago del Estero"),
    ]
    here_interpolada = dict(_here_candidate(interpolada=True), _nombre="Perú 781")
    stack, _ = _entorno_lote(
        geocodificar=[],
        nominatim_exact=[],
        nominatim_nearby=cercanas * 2,
        here=[here_interpolada, here_interpolada],
    )
    with stack:
        res = _post_lote(client, [_fila(1)])

    assert res.status_code == 200
    resultado = res.json()["resultados"][0]
    assert resultado["estado"] == "ambigua"
    assert [c["proveedor"] for c in resultado["candidatos"]] == [
        "here", "nominatim", "nominatim",
    ]
    assert all(c["aproximada"] is True for c in resultado["candidatos"])


def test_lote_limita_cinco_candidatos(client):
    muchos = [_georef_candidato(-27.70 - i / 1000, -64.26) for i in range(7)]
    stack, _ = _entorno_lote(geocodificar=muchos)
    with stack:
        res = _post_lote(client, [_fila(1)])

    assert res.status_code == 200
    resultado = res.json()["resultados"][0]
    assert resultado["estado"] == "ambigua"
    assert len(resultado["candidatos"]) == 5


def test_lote_rechaza_mas_filas_que_el_maximo(client):
    filas = [_fila(i, calle=f"Calle {i}") for i in range(1, 12)]  # 11 > 10
    stack, calls = _entorno_lote(geocodificar=[])
    with stack:
        res = _post_lote(client, filas)

    assert res.status_code == 400
    assert res.json()["error"]["codigo"] == "solicitud_invalida"
    assert "filas" in res.json()["error"]["campos"]
    calls["geocodificar"].assert_not_called()


def test_lote_respeta_maximo_configurable(client, monkeypatch):
    monkeypatch.setattr("django.conf.settings.GEOCODIFICAR_LOTE_MAX", 2)
    filas = [_fila(i, calle=f"Calle {i}") for i in range(1, 4)]  # 3 > 2
    stack, calls = _entorno_lote(geocodificar=[])
    with stack:
        res = _post_lote(client, filas)

    assert res.status_code == 400
    assert "2" in str(res.json()["error"]["campos"]["filas"])
    calls["geocodificar"].assert_not_called()


def test_lote_validacion_rechaza_lote_completo_antes_de_geocodificar(client):
    filas = [
        _fila(1),
        dict(_fila(2), altura="78a"),
        dict(_fila(3), calle=""),
        dict(_fila(4), id="fila-1"),
        dict(_fila(5), calle="x" * 121),
        dict(_fila(6), id="y" * 81),
        dict(_fila(7), altura="1234567"),
        dict(_fila(8), altura="78 1"),
    ]
    stack, calls = _entorno_lote(geocodificar=[])
    with stack:
        res = _post_lote(client, filas)

    assert res.status_code == 400
    cuerpo = res.json()["error"]
    assert cuerpo["codigo"] == "solicitud_invalida"
    campos = cuerpo["campos"]

    assert "filas[1].altura" in campos
    assert "filas[2].calle" in campos
    assert "filas[3].id" in campos
    assert "filas[4].calle" in campos
    assert "filas[5].id" in campos
    assert "filas[6].altura" in campos
    assert "filas[7].altura" in campos

    # El id de la fila viaja en el detalle cuando está disponible.
    assert "fila-2" in campos["filas[1].altura"]
    assert "fila-1" in campos["filas[3].id"]

    # Nada se geocodificó: el lote se rechaza completo.
    calls["geocodificar"].assert_not_called()


def test_lote_provincia_invalida_se_rechaza_antes_de_geocodificar(client):
    stack, calls = _entorno_lote(geocodificar=[])
    with stack:
        res = _post_lote(client, [_fila(1, provincia="Inexistente")])

    assert res.status_code == 400
    assert "filas[0].provincia" in res.json()["error"]["campos"]
    calls["geocodificar"].assert_not_called()


def test_lote_validacion_estructura(client):
    stack, calls = _entorno_lote(geocodificar=[])
    with stack:
        no_lista = client.post(
            "/api/geocodificar-lote/", {"filas": "Perú 781"},
            content_type="application/json",
        )
        vacio = client.post(
            "/api/geocodificar-lote/", {"filas": []},
            content_type="application/json",
        )
        sin_filas = client.post(
            "/api/geocodificar-lote/", {}, content_type="application/json",
        )
        fila_no_objeto = _post_lote(client, ["Perú 781"])
        campo_faltante = _post_lote(client, [{"id": "f1", "calle": "Perú", "altura": "1",
                                             "provincia": "Santiago del Estero"}])

    for res in (no_lista, vacio, sin_filas, fila_no_objeto, campo_faltante):
        assert res.status_code == 400
        assert res.json()["error"]["codigo"] == "solicitud_invalida"

    assert "filas" in no_lista.json()["error"]["campos"]
    assert "filas" in vacio.json()["error"]["campos"]
    assert "filas" in sin_filas.json()["error"]["campos"]
    assert "filas[0]" in fila_no_objeto.json()["error"]["campos"]
    assert "filas[0].ciudad" in campo_faltante.json()["error"]["campos"]
    calls["geocodificar"].assert_not_called()


def test_lote_fallos_parciales_no_abortan_el_lote(client):
    from geocodificacion.services.georef import GeorefServiceError

    def geocodificar(calle, numero, ciudad, provincia):
        if calle == "Rota":
            raise GeorefServiceError("http_error")
        return [_georef_candidato(-27.7775, -64.2650, "PERU 781")]

    filas = [_fila(1, calle="Rota"), _fila(2, calle="Perú"), _fila(3, calle="Perú")]
    stack, calls = _entorno_lote(geocodificar=geocodificar)
    with stack:
        res = _post_lote(client, filas)

    assert res.status_code == 200
    body = res.json()["resultados"]
    assert [r["estado"] for r in body] == ["error", "encontrada", "encontrada"]
    assert body[0]["candidatos"] == []
    assert all(r["candidatos"] for r in body[1:])
    assert calls["geocodificar"].call_count == 3


def test_lote_sin_resultado_con_georef_sin_coordenadas(client):
    provs = [{"nombre": "Santiago del Estero"}]
    payload = {"direcciones": [
        {"nomenclatura": "X", "ubicacion": {"lat": None, "lon": None},
         "provincia": {"nombre": "Santiago del Estero"},
         "localidad_censal": {"nombre": "Santiago del Estero"},
         "departamento": {"nombre": "Capital"}},
    ]}
    responses = [_mock_response({"provincias": provs}), _mock_response(payload)]
    with patch("geocodificacion.services.georef.requests.get", side_effect=responses) as get, patch(
        "geocodificacion.services.nominatim.NominatimClient.search_exact", return_value=[]
    ), patch(
        "geocodificacion.services.nominatim.NominatimClient.search_nearby", return_value=[]
    ), patch(
        "geocodificacion.services.here.HereClient.search_exact", return_value=[]
    ):
        res = _post_lote(client, [_fila(1)])

    assert res.status_code == 200
    resultado = res.json()["resultados"][0]
    assert resultado == {
        "id": "fila-1",
        "estado": "sin_resultado",
        "candidatos": [],
        "mensaje": None,
    }
    # Validación de provincias antes de geocodificar.
    assert get.call_count == 2


def test_lote_fila_error_cuando_falla_nominatim_sin_alternativas(client):
    from geocodificacion.services.nominatim import NominatimServiceError

    stack, _ = _entorno_lote(
        geocodificar=[],
        nominatim_exact_error=NominatimServiceError("timeout_or_network"),
        nominatim_nearby_error=NominatimServiceError("timeout_or_network"),
        here=[],
    )
    with stack:
        res = _post_lote(client, [_fila(1), _fila(2)])

    assert res.status_code == 200
    for resultado in res.json()["resultados"]:
        assert resultado["estado"] == "error"
        assert resultado["candidatos"] == []
        assert "http" not in resultado["mensaje"].lower()
        assert "api" not in resultado["mensaje"].lower()


def test_lote_procesa_secuencialmente(client):
    traza = []

    def geocodificar(calle, numero, ciudad, provincia):
        traza.append(f"in:{calle}")
        traza.append(f"out:{calle}")
        return []

    filas = [_fila(i, calle=f"Calle {i}") for i in range(1, 4)]
    stack, _ = _entorno_lote(geocodificar=geocodificar)
    with stack:
        res = _post_lote(client, filas)

    assert res.status_code == 200
    # Sin intercalado: una fila termina antes de empezar la siguiente.
    assert traza == [
        "in:Calle 1", "out:Calle 1",
        "in:Calle 2", "out:Calle 2",
        "in:Calle 3", "out:Calle 3",
    ]


def test_lote_provincias_caidas_responde_502(client):
    from geocodificacion.services.georef import GeorefServiceError

    stack, calls = _entorno_lote(
        geocodificar=[], provincias_error=GeorefServiceError("timeout_or_network")
    )
    with stack:
        res = _post_lote(client, [_fila(1)])

    assert res.status_code == 502
    assert res.json()["error"]["codigo"] == "servicio_no_disponible"
    calls["geocodificar"].assert_not_called()


def test_lote_metodo_no_permitido(client):
    assert client.get("/api/geocodificar-lote/").status_code == 405


# --- Regresión: el endpoint individual conserva su contrato ---


def test_geocodificar_individual_no_expone_campos_internos(client):
    stack, _ = _entorno_lote(
        geocodificar=[_georef_candidato(-27.7775, -64.2650, "PERU 781")]
    )
    with stack:
        res = client.post("/api/geocodificar/", {
            "calle": "Perú", "numero": "781",
            "ciudad": "Santiago del Estero", "provincia": "Santiago del Estero",
        }, content_type="application/json")

    assert res.status_code == 200
    candidato = res.json()["resultados"][0]
    assert set(candidato) == {
        "lat", "lng", "direccion", "provincia", "localidad", "departamento",
        "aproximada",
    }
    assert candidato["aproximada"] is True


def test_geocodificar_individual_here_no_expone_nombre_interno(client, monkeypatch):
    monkeypatch.setattr("django.conf.settings.HERE_ENABLED", True)
    monkeypatch.setattr("django.conf.settings.HERE_API_KEY", "test-key")
    here = [dict(_here_candidate(interpolada=False), _nombre="Perú 781")]
    stack, _ = _entorno_lote(geocodificar=[], nominatim_exact=[], here=here)
    with stack:
        res = client.post("/api/geocodificar/", {
            "calle": "Perú", "numero": "781",
            "ciudad": "Santiago del Estero", "provincia": "Santiago del Estero",
        }, content_type="application/json")

    assert res.status_code == 200
    candidato = res.json()["resultados"][0]
    assert "_nombre" not in candidato
    assert "_interpolada" not in candidato
    assert candidato["aproximada"] is True


# ---------------------------------------------------------------------------
# Exactitud de candidatos Georef en lote (política de discrepancia mínima)
# ---------------------------------------------------------------------------

def _cand_exactitud(nomenclatura, localidad="Santiago del Estero",
                    provincia="Santiago del Estero", lat=-27.7775, lng=-64.265):
    """Candidato Georef con la forma histórica (sin metadatos internos)."""
    return {
        "lat": lat,
        "lng": lng,
        "direccion": nomenclatura,
        "provincia": provincia,
        "localidad": localidad,
        "departamento": "Capital",
        "aproximada": True,
    }


def _pedido_exactitud(calle="Peru", altura="781", ciudad="Santiago del Estero",
                      provincia="Santiago del Estero"):
    return {
        "id": "fila-1",
        "calle": calle,
        "altura": altura,
        "ciudad": ciudad,
        "provincia": provincia,
    }


def test_exactitud_calle_identica_es_exacta():
    from geocodificacion.services.exactitud import es_candidato_exacto

    candidato = _cand_exactitud(
        "PERU 781, Santiago del Estero, Capital, Santiago del Estero"
    )
    assert es_candidato_exacto(candidato, _pedido_exactitud()) is True


def test_exactitud_normaliza_prefijos_acentos_case_y_puntuacion():
    from geocodificacion.services.exactitud import es_candidato_exacto

    casos = [
        ("Avenida Corrientes", "1000", "AV. CORRIENTES 1000, San Nicolás, Comuna 1"),
        ("Av. Corrientes", "1000", "AVENIDA CORRIENTES 1000"),
        ("Perú", "781", "PERU 781"),
        ("Avenida San Martín", "781", "AV SAN MARTIN 781"),
        ("Calle Libertad", "640", "LIBERTAD 640"),
        ("Avenida 9 de Julio", "1000", "AV. 9 DE JULIO 1000"),
    ]
    for calle, altura, nomenclatura in casos:
        assert es_candidato_exacto(
            _cand_exactitud(nomenclatura),
            _pedido_exactitud(calle=calle, altura=altura),
        ) is True, (calle, nomenclatura)


def test_exactitud_acepta_typo_de_una_letra():
    from geocodificacion.services.exactitud import es_candidato_exacto

    assert es_candidato_exacto(
        _cand_exactitud("LIBERTAD 640"), _pedido_exactitud(calle="Liberta", altura="640")
    ) is True
    assert es_candidato_exacto(
        _cand_exactitud("PERU 781"), _pedido_exactitud(calle="Peruu")
    ) is True


def test_exactitud_rechaza_typo_de_mas_de_una_letra():
    from geocodificacion.services.exactitud import es_candidato_exacto

    assert es_candidato_exacto(
        _cand_exactitud("PERU 781"), _pedido_exactitud(calle="Peruxy")
    ) is False
    # Dos ediciones repartidas en dos tokens también superan el umbral.
    assert es_candidato_exacto(
        _cand_exactitud("SON MARTEN 781"), _pedido_exactitud(calle="San Martin")
    ) is False


def test_exactitud_rechaza_calle_con_token_extra():
    from geocodificacion.services.exactitud import es_candidato_exacto

    # "Bateria Libertad" no se convierte en "Libertad" (ni al revés).
    assert es_candidato_exacto(
        _cand_exactitud("LIBERTAD 640"),
        _pedido_exactitud(calle="Bateria Libertad", altura="640"),
    ) is False
    assert es_candidato_exacto(
        _cand_exactitud("BATERIA LIBERTAD 640"),
        _pedido_exactitud(calle="Libertad", altura="640"),
    ) is False


def test_exactitud_altura_distinta_o_no_verificable_es_aproximada():
    from geocodificacion.services.exactitud import es_candidato_exacto

    assert es_candidato_exacto(
        _cand_exactitud("PERU 780"), _pedido_exactitud(altura="781")
    ) is False
    # Sin altura verificable desde la estructura => no exacto.
    for nomenclatura in (None, "PERU, Santiago del Estero, Capital", "S/N", 1234):
        assert es_candidato_exacto(
            _cand_exactitud(nomenclatura), _pedido_exactitud()
        ) is False, nomenclatura


def test_exactitud_localidad_o_provincia_contradictoria_no_es_exacta():
    from geocodificacion.services.exactitud import es_candidato_exacto

    assert es_candidato_exacto(
        _cand_exactitud("PERU 781", localidad="Buenos Aires"), _pedido_exactitud()
    ) is False
    assert es_candidato_exacto(
        _cand_exactitud("PERU 781", provincia="Buenos Aires"), _pedido_exactitud()
    ) is False
    # Ausentes: no hay contradicción posible.
    assert es_candidato_exacto(
        _cand_exactitud("PERU 781", localidad=None, provincia=None), _pedido_exactitud()
    ) is True


def test_exactitud_tolera_variantes_de_lugar_y_comuna_de_caba():
    from geocodificacion.services.exactitud import es_candidato_exacto

    caba = _pedido_exactitud(
        calle="Avenida Corrientes", altura="1000",
        ciudad="Ciudad Autónoma de Buenos Aires",
        provincia="Ciudad Autónoma de Buenos Aires",
    )
    assert es_candidato_exacto(
        _cand_exactitud(
            "AV CORRIENTES 1000, San Nicolás, Comuna 1",
            localidad="CABA - Comuna 1",
            provincia="Ciudad Autónoma de Buenos Aires",
        ),
        caba,
    ) is True
    assert es_candidato_exacto(
        _cand_exactitud("PERU 781", localidad="Municipio de Santiago del Estero"),
        _pedido_exactitud(),
    ) is True


def test_exactitud_funciona_con_candidato_cacheado_sin_metadatos():
    from geocodificacion.services.exactitud import es_candidato_exacto

    # Forma exacta de una entrada de caché histórica de Georef: sin claves "_".
    candidato = _cand_exactitud("PERU 781, Santiago del Estero, Capital, Santiago del Estero")
    assert set(candidato) == {
        "lat", "lng", "direccion", "provincia", "localidad", "departamento",
        "aproximada",
    }
    assert es_candidato_exacto(candidato, _pedido_exactitud()) is True


def test_exactitud_normalizacion_y_distancia_tokens():
    from geocodificacion.services.exactitud import (
        _distancia, _normalizar, _tokens_calle,
    )

    assert _normalizar("Avenida Ñandú") == "avenida nandu"
    assert _normalizar("AV.  Corrientes, 1000") == "av corrientes 1000"
    assert _tokens_calle("Av. 9 de Julio") == ["9", "de", "julio"]
    assert _distancia("peru", "peruu") == 1
    assert _distancia("peru", "peruxy") == 2
    assert _distancia("peru", "peru") == 0


# --- Integración en el endpoint de lote ---


def test_lote_georef_calle_equivalente_es_encontrada(client):
    stack, _ = _entorno_lote(geocodificar=[_cand_exactitud(
        "PERU 781, Santiago del Estero, Capital, Santiago del Estero"
    )])
    with stack:
        res = _post_lote(client, [_fila(1, calle="Perú", altura="781")])

    resultado = res.json()["resultados"][0]
    assert res.status_code == 200
    assert resultado["estado"] == "encontrada"
    assert resultado["candidatos"][0]["proveedor"] == "georef"
    assert resultado["candidatos"][0]["aproximada"] is False


def test_lote_georef_typo_minimo_es_exacto(client):
    stack, _ = _entorno_lote(geocodificar=[_cand_exactitud(
        "LIBERTAD 640, Santiago del Estero, Capital, Santiago del Estero"
    )])
    with stack:
        res = _post_lote(client, [_fila(1, calle="Liberta", altura="640")])

    resultado = res.json()["resultados"][0]
    assert resultado["estado"] == "encontrada"
    assert resultado["candidatos"][0]["aproximada"] is False


def test_lote_georef_typo_mayor_es_ambigua_y_aproximada(client):
    stack, _ = _entorno_lote(geocodificar=[_cand_exactitud(
        "PERUXY 781, Santiago del Estero, Capital, Santiago del Estero"
    )])
    with stack:
        res = _post_lote(client, [_fila(1, calle="Peru", altura="781")])

    resultado = res.json()["resultados"][0]
    assert resultado["estado"] == "ambigua"
    assert len(resultado["candidatos"]) == 1
    assert resultado["candidatos"][0]["aproximada"] is True


def test_lote_georef_token_extra_en_calle_es_aproximada(client):
    stack, _ = _entorno_lote(geocodificar=[_cand_exactitud(
        "BATERIA LIBERTAD 640, Santiago del Estero, Capital, Santiago del Estero"
    )])
    with stack:
        res = _post_lote(client, [_fila(1, calle="Libertad", altura="640")])

    resultado = res.json()["resultados"][0]
    assert resultado["estado"] == "ambigua"
    assert resultado["candidatos"][0]["aproximada"] is True


def test_lote_georef_altura_distinta_es_aproximada(client):
    stack, _ = _entorno_lote(geocodificar=[_cand_exactitud(
        "PERU 780, Santiago del Estero, Capital, Santiago del Estero"
    )])
    with stack:
        res = _post_lote(client, [_fila(1, calle="Peru", altura="781")])

    resultado = res.json()["resultados"][0]
    assert resultado["estado"] == "ambigua"
    assert resultado["candidatos"][0]["aproximada"] is True


def test_lote_georef_localidad_contradictoria_no_es_exacta(client):
    stack, _ = _entorno_lote(geocodificar=[_cand_exactitud(
        "PERU 781, Buenos Aires, Comuna 1, Buenos Aires", localidad="Buenos Aires"
    )])
    with stack:
        res = _post_lote(client, [_fila(1, calle="Peru", altura="781")])

    resultado = res.json()["resultados"][0]
    # Calle y altura coinciden, pero el territorio contradice: no exacto.
    assert resultado["estado"] == "ambigua"
    assert resultado["candidatos"][0]["aproximada"] is True


def test_lote_georef_sin_nomenclatura_es_aproximada(client):
    stack, _ = _entorno_lote(geocodificar=[_cand_exactitud(None)])
    with stack:
        res = _post_lote(client, [_fila(1)])

    resultado = res.json()["resultados"][0]
    assert resultado["estado"] == "ambigua"
    assert resultado["candidatos"][0]["aproximada"] is True


def test_lote_georef_mezcla_exacto_y_dudoso_conserva_orden(client):
    exacto = _cand_exactitud("PERU 781, Santiago del Estero, Capital, Santiago del Estero")
    dudoso = _cand_exactitud("PERUXY 781, Santiago del Estero, Capital, Santiago del Estero", lat=-27.78)
    stack, _ = _entorno_lote(geocodificar=[exacto, dudoso])
    with stack:
        res = _post_lote(client, [_fila(1, calle="Peru", altura="781")])

    resultado = res.json()["resultados"][0]
    assert resultado["estado"] == "ambigua"
    assert [c["aproximada"] for c in resultado["candidatos"]] == [False, True]
    assert [c["direccion"] for c in resultado["candidatos"]] == [
        exacto["direccion"], dudoso["direccion"],
    ]


def test_lote_here_y_nominatim_conservan_su_politica_de_exactitud(client):
    def nominatim_exact(calle, numero, ciudad, provincia):
        if calle == "Peru":
            return [{
                "lat": -27.7775, "lng": -64.265,
                "direccion": "Otra Calle 999, Santiago del Estero",
                "provincia": "Santiago del Estero",
                "localidad": "Santiago del Estero",
                "departamento": "Capital",
                "aproximada": True,
            }]
        return []

    def here(calle, numero, ciudad, provincia):
        if calle == "Belgrano":
            return [dict(_here_candidate(interpolada=False), _nombre="Belgrano 781")]
        return []

    filas = [_fila(1, calle="Peru", altura="781"), _fila(2, calle="Belgrano", altura="781")]
    stack, _ = _entorno_lote(
        geocodificar=[], nominatim_exact=nominatim_exact, here=here
    )
    with stack:
        res = _post_lote(client, filas)

    body = res.json()["resultados"]
    assert [r["estado"] for r in body] == ["encontrada", "encontrada"]
    assert body[0]["candidatos"][0]["proveedor"] == "nominatim"
    assert body[0]["candidatos"][0]["aproximada"] is False
    assert body[1]["candidatos"][0]["proveedor"] == "here"
    assert body[1]["candidatos"][0]["aproximada"] is False


# --- Guardas: el endpoint individual no cambia ---


def test_individual_georef_no_aplica_politica_de_exactitud(client):
    # Calle con dos ediciones de diferencia: en lote sería ambigua/aproximada.
    stack, _ = _entorno_lote(geocodificar=[_cand_exactitud(
        "PERUXY 781, Santiago del Estero, Capital, Santiago del Estero"
    )])
    with stack:
        res = client.post("/api/geocodificar/", {
            "calle": "Peru", "numero": "781",
            "ciudad": "Santiago del Estero", "provincia": "Santiago del Estero",
        }, content_type="application/json")

    assert res.status_code == 200
    candidato = res.json()["resultados"][0]
    assert set(candidato) == {
        "lat", "lng", "direccion", "provincia", "localidad", "departamento",
        "aproximada",
    }
    assert candidato["aproximada"] is True
    assert all(not clave.startswith("_") for clave in candidato)


def test_individual_georef_cacheado_no_expone_claves_internas(client):
    provs = [{"nombre": "Santiago del Estero"}]
    payload = {"direcciones": [
        {"nomenclatura": "PERU 781, Santiago del Estero, Capital, Santiago del Estero",
         "ubicacion": {"lat": -27.7775, "lon": -64.265},
         "provincia": {"nombre": "Santiago del Estero"},
         "localidad_censal": {"nombre": "Santiago del Estero"},
         "departamento": {"nombre": "Capital"}},
    ]}
    responses = [_mock_response({"provincias": provs}), _mock_response(payload)]
    with patch("geocodificacion.services.georef.requests.get", side_effect=responses):
        res = client.post("/api/geocodificar/", {
            "calle": "Peru", "numero": "781",
            "ciudad": "Santiago del Estero", "provincia": "Santiago del Estero",
        }, content_type="application/json")

    assert res.status_code == 200
    candidato = res.json()["resultados"][0]
    assert set(candidato) == {
        "lat", "lng", "direccion", "provincia", "localidad", "departamento",
        "aproximada",
    }
    assert all(not clave.startswith("_") for clave in candidato)

    # La misma entrada cacheada, leída por el lote, se clasifica como exacta
    # sin necesitar metadatos adicionales (y sin volver a pedir a Georef).
    with patch(
        "geocodificacion.services.georef.requests.get",
        side_effect=AssertionError("el lote debe reutilizar la caché"),
    ), patch(
        "geocodificacion.services.nominatim.NominatimClient.search_exact", return_value=[]
    ), patch(
        "geocodificacion.services.nominatim.NominatimClient.search_nearby", return_value=[]
    ), patch(
        "geocodificacion.services.here.HereClient.search_exact", return_value=[]
    ):
        lote = _post_lote(client, [_fila(1, calle="Peru", altura="781")])
    resultado = lote.json()["resultados"][0]
    assert resultado["estado"] == "encontrada"
    assert resultado["candidatos"][0]["aproximada"] is False
