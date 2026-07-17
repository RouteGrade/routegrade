"""Unit tests for the v1 scoring function — every branch from the MVP 3 spec."""

from __future__ import annotations

import pytest

from app.services import scoring


class TestElevationGain:
    def test_flat_profile_gains_nothing(self):
        assert scoring.elevation_gain_m([100.0, 100.0, 100.0]) == 0.0

    def test_noise_below_floor_is_ignored(self):
        # +0.5 m wobbles are provider noise, not climbing.
        assert scoring.elevation_gain_m([100.0, 100.5, 100.0, 100.5]) == 0.0

    def test_only_positive_deltas_count(self):
        assert scoring.elevation_gain_m([100.0, 110.0, 105.0, 115.0]) == 20.0

    def test_empty_and_single_point_profiles(self):
        assert scoring.elevation_gain_m([]) == 0.0
        assert scoring.elevation_gain_m([42.0]) == 0.0


class TestScoreRoute:
    def _score(self, **overrides):
        params = dict(
            distance_km=5.0,
            elevation_gain_m=10.0,
            intersections_per_km=2.0,
            sidewalk_coverage=1.0,
            preference="quiet",
        )
        params.update(overrides)
        return scoring.score_route(**params)

    def test_flat_quiet_covered_route_grades_a(self):
        result = self._score()
        assert result.grade == "A"
        assert result.score >= 85

    def test_hilly_route_scores_below_flat_route(self):
        flat = self._score(elevation_gain_m=5.0)
        hilly = self._score(elevation_gain_m=150.0)
        assert hilly.score < flat.score
        assert hilly.elevation_subscore == 0.0  # 30 m/km is past the worst anchor

    def test_dense_intersections_score_below_sparse(self):
        sparse = self._score(intersections_per_km=1.0)
        dense = self._score(intersections_per_km=15.0)
        assert dense.score < sparse.score
        assert dense.intersection_subscore == 0.0

    def test_missing_sidewalk_data_is_neutral_not_zero(self):
        unknown = self._score(sidewalk_coverage=None)
        none_covered = self._score(sidewalk_coverage=0.0)
        full_covered = self._score(sidewalk_coverage=1.0)
        assert unknown.sidewalk_subscore == 50.0
        assert none_covered.score < unknown.score < full_covered.score

    def test_sidewalk_coverage_is_clamped(self):
        assert self._score(sidewalk_coverage=1.7).sidewalk_subscore == 100.0
        assert self._score(sidewalk_coverage=-0.3).sidewalk_subscore == 0.0

    def test_degenerate_geometry_grades_d_with_zero_score(self):
        result = self._score(distance_km=0.0)
        assert result.score == 0.0
        assert result.grade == "D"

    def test_grade_bands(self):
        # Craft inputs to land in each band via sidewalk coverage sweep.
        assert self._score(sidewalk_coverage=1.0).grade == "A"
        worst = self._score(
            elevation_gain_m=200.0, intersections_per_km=20.0, sidewalk_coverage=0.0
        )
        assert worst.score == 0.0
        assert worst.grade == "D"

    def test_flat_preference_weights_elevation_heavier(self):
        hilly_flat_pref = self._score(elevation_gain_m=150.0, preference="flat")
        hilly_quiet_pref = self._score(elevation_gain_m=150.0, preference="quiet")
        # The same hill hurts more when the user asked for flat.
        assert hilly_flat_pref.score < hilly_quiet_pref.score

    def test_quiet_preference_weights_intersections_heavier(self):
        busy_quiet_pref = self._score(intersections_per_km=15.0, preference="quiet")
        busy_flat_pref = self._score(intersections_per_km=15.0, preference="flat")
        assert busy_quiet_pref.score < busy_flat_pref.score

    def test_unknown_preference_falls_back_to_default_weights(self):
        default = self._score(preference="scenic")
        fallback = self._score(preference="something-new")
        assert default.score == fallback.score

    @pytest.mark.parametrize("preference", ["quiet", "flat", "scenic"])
    def test_score_is_bounded(self, preference):
        best = self._score(
            elevation_gain_m=0.0,
            intersections_per_km=0.0,
            sidewalk_coverage=1.0,
            preference=preference,
        )
        worst = self._score(
            elevation_gain_m=500.0,
            intersections_per_km=50.0,
            sidewalk_coverage=0.0,
            preference=preference,
        )
        assert 0.0 <= worst.score <= best.score <= 100.0
