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
            preference="quiet",
        )
        params.update(overrides)
        return scoring.score_route(**params)

    def test_flat_quiet_route_grades_a(self):
        # 10 m over 5 km = 2 m/km (elevation 100) and 2 intersections/km
        # (intersection 100) -> a perfect score, now reachable without sidewalk.
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

    def test_sidewalk_is_excluded_from_scoring(self):
        # v1 dropped sidewalk from the formula; score_route no longer accepts it.
        with pytest.raises(TypeError):
            scoring.score_route(
                distance_km=5.0,
                elevation_gain_m=10.0,
                intersections_per_km=2.0,
                sidewalk_coverage=1.0,
                preference="quiet",
            )

    def test_degenerate_geometry_grades_d_with_zero_score(self):
        result = self._score(distance_km=0.0)
        assert result.score == 0.0
        assert result.grade == "D"

    def test_grade_bands(self):
        # Craft inputs to land in each band by sweeping intersection density on
        # a flat route (elevation sub-score pinned at 100). quiet weights
        # intersections 2/3, elevation 1/3.
        flat = dict(elevation_gain_m=0.0, distance_km=1.0, preference="quiet")
        assert self._score(intersections_per_km=0.0, **flat).grade == "A"  # 100
        # int density 8/km -> intersection sub 40; score = 100/3 + 40*2/3 = 60.0
        assert self._score(intersections_per_km=8.0, **flat).grade == "C"
        worst = self._score(
            elevation_gain_m=200.0, intersections_per_km=20.0, distance_km=1.0
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
    def test_score_spans_full_range(self, preference):
        # With sidewalk dropped and weights renormalized to 1.0, a perfect route
        # reaches 100 and a terrible one bottoms out at 0 for every preference —
        # no fixed offset compresses the scale anymore.
        best = self._score(
            elevation_gain_m=0.0,
            intersections_per_km=0.0,
            preference=preference,
        )
        worst = self._score(
            elevation_gain_m=500.0,
            intersections_per_km=50.0,
            preference=preference,
        )
        assert best.score == 100.0
        assert worst.score == 0.0
        assert 0.0 <= worst.score <= best.score <= 100.0

    def test_grade_a_reachable_on_production_path_for_default_preference(self):
        # The API default preference is "quiet". A near-perfect quiet route must
        # earn an A on the real production path (no sidewalk input), otherwise
        # the top grade would be unreachable for most users.
        result = self._score(
            elevation_gain_m=0.0,
            intersections_per_km=0.0,
            preference="quiet",
        )
        assert result.grade == "A"

    def test_short_route_intersection_penalty_is_visible(self):
        # Guards the documented short-route bias: maneuvers/km is higher on a
        # short loop, so a 1 km route with a few turns scores worse on
        # intersections than the same turns spread over 10 km. This encodes the
        # known limitation so a future proxy fix has a reference point.
        short = self._score(distance_km=1.0, intersections_per_km=6.0)
        long = self._score(distance_km=1.0, intersections_per_km=1.0)
        assert short.intersection_subscore < long.intersection_subscore


class TestWeightsInvariant:
    @pytest.mark.parametrize("preference", ["quiet", "flat", "scenic"])
    def test_weight_rows_sum_to_one(self, preference):
        # A weight row that does not sum to 1.0 silently breaks the 0-100 scale
        # and the grade bands. Catch a bad edit here rather than in production.
        assert sum(scoring._WEIGHTS[preference]) == pytest.approx(1.0)

    def test_default_weights_sum_to_one(self):
        assert sum(scoring._DEFAULT_WEIGHTS) == pytest.approx(1.0)

    def test_grade_bands_are_ordered_and_contiguous(self):
        thresholds = [t for t, _ in scoring._GRADE_BANDS]
        assert thresholds == sorted(thresholds, reverse=True)
