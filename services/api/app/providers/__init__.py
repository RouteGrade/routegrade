"""Outbound provider clients: geocoding, routing, elevation.

Each provider is a small class with an explicit protocol so the planner can be
tested against stubs and providers can be swapped via configuration (e.g.
Nominatim -> Mapbox) without touching orchestration code.
"""
