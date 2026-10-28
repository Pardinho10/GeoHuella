from unittest.mock import patch, MagicMock

import pytest
from django.core.cache import cache
from django.test import Client


@pytest.fixture(autouse=True)
def _clear_cache(monkeypatch):
    monkeypatch.setattr("geocodificacion.services.nominatim.RATE_LIMIT_SECONDS", 0.0)
    monkeypatch.setattr("django.conf.settings.HERE_ENABLED", False)
    monkeypatch.setattr("django.conf.settings.HERE_API_KEY", "")
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def client():
    return Client()


def test_salud_ok(client):
    res = client.get("/api/salud/")
    assert res.status_code == 200
    assert res.json() == {"estado": "ok"}


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
