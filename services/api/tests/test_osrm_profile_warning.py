"""The OSRM profile no-op warning.

Guards the failure mode that produced RouteGrade's longest-running product bug:
`OSRM_PROFILE=foot` pointed at the public demo server, which serves the driving
graph for every profile and reports no error. Grades were computed from car
routing for weeks with nothing in the config or logs saying so.
"""

from __future__ import annotations

import pytest

from app.main import warn_if_profile_is_a_no_op

DEMO = "https://router.project-osrm.org"
SELF_HOSTED = "https://osrm.routegrade.example.com"


@pytest.mark.parametrize("profile", ["foot", "bicycle", "FOOT", "walking"])
def test_warns_for_any_non_driving_profile_against_the_demo(profile: str) -> None:
    warning = warn_if_profile_is_a_no_op(DEMO, profile)
    assert warning is not None
    # The message has to name the profile and point somewhere useful, or it is
    # just noise in a log nobody acts on.
    assert profile in warning
    assert "deploy/osrm/" in warning


def test_silent_when_the_demo_is_asked_for_what_it_actually_serves() -> None:
    # Driving against the demo is honest: it is what that host has. Warning
    # here would train people to ignore the warning.
    assert warn_if_profile_is_a_no_op(DEMO, "driving") is None
    assert warn_if_profile_is_a_no_op(DEMO, "DRIVING") is None


@pytest.mark.parametrize("profile", ["foot", "driving", "bicycle"])
def test_silent_for_a_self_hosted_host(profile: str) -> None:
    # A self-hosted graph can serve whatever profile it was built with, so we
    # have nothing to say about it.
    assert warn_if_profile_is_a_no_op(SELF_HOSTED, profile) is None


def test_matches_the_demo_host_regardless_of_scheme_or_path() -> None:
    # The check is on the host substring, so http/https and a trailing path
    # both still warn — a misconfiguration shouldn't slip through on a detail.
    assert warn_if_profile_is_a_no_op("http://router.project-osrm.org", "foot")
    assert warn_if_profile_is_a_no_op("https://router.project-osrm.org/", "foot")
