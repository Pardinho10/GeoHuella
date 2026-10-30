"""Criterio de exactitud para candidatos de Georef en `/api/geocodificar-lote/`.

Sólo se usa desde el endpoint de lote. El endpoint individual no consulta este
módulo: sigue devolviendo los candidatos con su semántica histórica
(`aproximada: true`).

Política conservadora: un candidato Georef se clasifica **exacto** únicamente si

(a) la altura devuelta es exactamente la pedida;
(b) la localidad y la provincia devueltas —cuando están presentes— no
    contradicen la solicitud (se toleran variantes como ``municipio de X``,
    ``CABA - Comuna 1`` y el alias CABA/Buenos Aires);
(c) la calle, normalizada (Unicode/acentos, ``casefold``, puntuación/espacios y
    prefijos genéricos de vía), coincide token a token o difiere por **como
    máximo una edición de carácter en total**, con la misma cantidad de tokens.
    Esto último evita aceptar otra calle por una palabra de más
    (``Bateria Libertad`` no se convierte en ``Libertad``).

Si no se puede verificar la calle o la altura (por ejemplo, candidatos cacheados
sin ``direccion`` o con una nomenclatura no parseable) el candidato **no** se
marca exacto: se entrega como aproximado, exigiendo selección explícita.

No se agregan metadatos internos a los candidatos de Georef: la clasificación
se calcula al vuelo a partir de ``direccion`` (la ``nomenclatura`` de Georef) y
de los campos territoriales ya públicos. Por eso las entradas de caché viejas
—sin metadatos— funcionan igual y no hay claves internas que filtrar en
`/api/geocodificar/`.
"""

import functools
import re
import unicodedata

# Prefijos genéricos de vía que no aportan al nombre de la calle.
PREFIJOS_VIA = frozenset({
    "calle", "avenida", "av", "boulevard", "bulevar", "pasaje", "camino",
    "ruta", "rp", "rn", "autopista", "colectora",
})

# Alias equivalentes de la Ciudad Autónoma de Buenos Aires.
ALIAS_CABA = frozenset({
    "ciudad autonoma de buenos aires", "ciudad de buenos aires",
    "caba", "capital federal",
})

# Georef informa la localidad censal como "CABA - Comuna 1".
SUFIJO_COMUNA = re.compile(r"\s+comuna\s+\d+$")

# Primera parte de la nomenclatura: "CALLE ALTURA".
NOMENCLATURA = re.compile(r"^(?P<calle>.+?)\s+(?P<altura>\d+)$")

PREFIJOS_LUGAR = ("municipio de ", "ciudad de ", "partido de ", "departamento ")


def _normalizar(valor):
    """Minúsculas, sin diacríticos, sin puntuación y con espacios colapsados."""
    if not isinstance(valor, str):
        return ""
    texto = unicodedata.normalize("NFKD", valor)
    texto = "".join(ch for ch in texto if not unicodedata.combining(ch))
    texto = texto.casefold()
    texto = re.sub(r"[^a-z0-9]+", " ", texto)
    return " ".join(texto.split())


@functools.lru_cache(maxsize=1024)
def _distancia(a, b):
    """Distancia de Levenshtein entre dos tokens."""
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    previa = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        actual = [i]
        for j, cb in enumerate(b, 1):
            actual.append(min(
                previa[j] + 1,            # borrado
                actual[j - 1] + 1,        # inserción
                previa[j - 1] + (ca != cb),  # sustitución
            ))
        previa = actual
    return previa[-1]


def _variantes_lugar(valor):
    """Variantes tolerables de una localidad o provincia."""
    normalizado = _normalizar(valor)
    if not normalizado:
        return set()
    variantes = {normalizado, SUFIJO_COMUNA.sub("", normalizado)}
    variantes.discard("")
    # "caba" / "caba comuna 1" también son equivalentes a Buenos Aires.
    if variantes & ALIAS_CABA:
        variantes.add("buenos aires")
    for prefijo in PREFIJOS_LUGAR:
        if normalizado.startswith(prefijo):
            variantes.add(normalizado[len(prefijo):])
    variantes.discard("")
    return variantes


def _lugar_compatible(devuelto, pedido):
    """True si el lugar devuelto no contradice el pedido.

    Ausente en cualquiera de los dos lados ⇒ no hay contradicción posible.
    """
    if not devuelto or not pedido:
        return True
    variantes_devuelto = _variantes_lugar(devuelto)
    variantes_pedido = _variantes_lugar(pedido)
    if not variantes_devuelto or not variantes_pedido:
        return True
    return bool(variantes_devuelto & variantes_pedido)


def _tokens_calle(valor):
    return [tok for tok in _normalizar(valor).split() if tok not in PREFIJOS_VIA]


def _calles_compatibles(pedida, devuelta):
    """Misma cantidad de tokens y a lo sumo 1 edición de carácter en total."""
    tokens_pedida = _tokens_calle(pedida)
    tokens_devuelta = _tokens_calle(devuelta)
    if not tokens_pedida or not tokens_devuelta:
        return False
    if len(tokens_pedida) != len(tokens_devuelta):
        return False
    return sum(_distancia(a, b) for a, b in zip(tokens_pedida, tokens_devuelta)) <= 1


def _alturas_iguales(devuelta, pedida):
    try:
        return int(str(devuelta).strip()) == int(str(pedida).strip())
    except (TypeError, ValueError):
        return False


def _parsear_nomenclatura(nomenclatura):
    """Extrae ``(calle, altura)`` de la ``nomenclatura`` de Georef.

    Formato real: ``"AV CORRIENTES 1000, San Nicolás, Comuna 1, CABA"``.
    Devuelve ``None`` si no se puede verificar la altura desde la estructura.
    """
    if not isinstance(nomenclatura, str):
        return None
    primera = nomenclatura.split(",")[0].strip()
    if not primera:
        return None
    coincidencia = NOMENCLATURA.match(primera)
    if coincidencia is None:
        return None
    calle = coincidencia.group("calle").strip(" ,.")
    if not calle:
        return None
    return calle, coincidencia.group("altura")


def es_candidato_exacto(candidato, pedido):
    """Aplica la política (a), (b) y (c) a un candidato de Georef.

    ``pedido`` es la fila validada (``calle``, ``altura``, ``ciudad``,
    ``provincia``). Ante cualquier duda devuelve ``False`` (aproximado).
    """
    if not isinstance(candidato, dict) or not isinstance(pedido, dict):
        return False

    parseado = _parsear_nomenclatura(candidato.get("direccion"))
    if parseado is None:
        return False
    calle_devuelta, altura_devuelta = parseado

    if not _alturas_iguales(altura_devuelta, pedido.get("altura")):
        return False
    if not _calles_compatibles(pedido.get("calle"), calle_devuelta):
        return False
    if not _lugar_compatible(candidato.get("localidad"), pedido.get("ciudad")):
        return False
    if not _lugar_compatible(candidato.get("provincia"), pedido.get("provincia")):
        return False
    return True
